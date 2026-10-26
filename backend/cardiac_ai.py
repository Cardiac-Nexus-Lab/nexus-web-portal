"""Real model inference for the Cardiac Nexus web backend.

Every number returned here comes from a trained, tested model in nexus-ai-engine
or from a published clinical reference range. Nothing is hard-coded to look like
a model output.

    ECG       12-lead CSV, or an image of a 12x1 printout read by the digitizer
              -> calibrated probabilities for five diagnostic superclasses
              -> Integrated Gradients attribution for the leading finding
    MRI       short-axis NIfTI volume(s), or a single DICOM / image slice
              -> left ventricle, right ventricle and myocardium segmentation
              -> volumes and ejection fraction when both ED and ES are given
              -> diagnosis from measurements when height and weight are given
    Clinical  entered values checked against guideline reference ranges
    Fusion    a deep learning network over all three: the ECG classifier's
              embedding, the MRI segmenter's image features and measurements,
              and a network over the health-record fields, joined by attention
              layers and a learned gate -> probability of heart disease, each
              modality's weight and effect, explained in plain sentences

No public dataset pairs ECG, MRI and health records for the same patients, so the
fusion network is trained and tested on virtual patients (an ECG, an MRI and a
health record of different people with the same diagnosis), and every result says
so. The attention level still comes from explicit thresholds.
"""

from __future__ import annotations

import base64
import io
import json
import os
import sys
import tempfile
from functools import lru_cache
from pathlib import Path

import numpy as np

# nexus-ai-engine is expected next to nexus-web-portal unless CARDIAC_NEXUS_ENGINE says otherwise.
ENGINE = Path(os.getenv("CARDIAC_NEXUS_ENGINE",
                        str(Path(__file__).resolve().parents[2] / "nexus-ai-engine"))).expanduser()
if str(ENGINE / "src") not in sys.path:
    sys.path.insert(0, str(ENGINE / "src"))

import cv2  # noqa: E402
import matplotlib  # noqa: E402

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402
import torch  # noqa: E402

from cardiac_nexus import ehr as ehr_model  # noqa: E402
from cardiac_nexus.data import LEAD_NAMES, SUPERCLASSES  # noqa: E402
from cardiac_nexus.ecg_image.pipeline import digitize_page, load_localizer  # noqa: E402
from cardiac_nexus.explain import attribute  # noqa: E402
from cardiac_nexus import fusion as fusion_model  # noqa: E402
from cardiac_nexus.mri_data import IMAGE_SIZE, STRUCTURES, _fit, structure_volumes_ml  # noqa: E402
from cardiac_nexus.mri_diagnosis import explain_patient, measurement_features, pooled_features  # noqa: E402
from cardiac_nexus.mri_models import MRISegmenter  # noqa: E402
from cardiac_nexus.training import build_model  # noqa: E402

DEVICE = torch.device("cpu")  # a web server handles many small requests; CPU is predictable
ECG_SAMPLES = 1000  # 10 s at 100 Hz, the classifier's input length

CLASS_LABELS = {
    "NORM": "Normal ECG",
    "MI": "Myocardial infarction",
    "STTC": "ST/T-wave change",
    "CD": "Conduction disturbance",
    "HYP": "Hypertrophy",
}
DIAGNOSIS_LABELS = {
    "NOR": "Normal",
    "MINF": "Previous myocardial infarction",
    "DCM": "Dilated cardiomyopathy",
    "HCM": "Hypertrophic cardiomyopathy",
    "RV": "Abnormal right ventricle",
}
MODEL_EVIDENCE = {
    "ecg": "Tested on 2,158 unseen PTB-XL recordings: macro AUROC 0.911, calibrated (mean ECE 0.015).",
    "ecg_image": "Digitizer recovers the waveform at 0.94 correlation from flat scans; angled photos are unreliable.",
    "mri": ("Tested on 346 unseen patients from three cohorts and several scanner vendors: left ventricle Dice "
            "0.937-0.954, ejection fraction error 3-4 points against experts; 5.7 points against clinicians on "
            "439 external Kaggle patients."),
    "diagnosis": "43 of 50 unseen ACDC patients diagnosed correctly from the model's outlines (95% interval 74%-93%).",
}


class InputError(ValueError):
    """The upload could not be interpreted; the message is shown to the user."""


# ----------------------------------------------------------------------------
# Models, loaded once
# ----------------------------------------------------------------------------

@lru_cache(maxsize=1)
def models() -> dict:
    torch.set_num_threads(max(1, (os.cpu_count() or 2) // 2))
    import json

    import joblib

    results = ENGINE / "results"
    safe = [np._core.multiarray.scalar, np.dtype, np.dtypes.Float64DType, np.dtypes.Int64DType]
    with torch.serialization.safe_globals(safe):
        ecg_checkpoint = torch.load(results / "local_xresnet18_full" / "ecg_multilabel.pt",
                                    map_location=DEVICE, weights_only=True)
    ecg = build_model(ecg_checkpoint["architecture"], len(ecg_checkpoint["classes"]))
    ecg.load_state_dict(ecg_checkpoint["model_state_dict"])
    ecg.eval()

    report = json.loads((results / "local_xresnet18_full" / "evaluation_report.json").read_text())
    calibration = report["vector_scaling"]

    # The pooled model (ACDC, M&Ms and M&Ms-2) generalises far better to other scanners than the ACDC-only
    # one; older engine checkouts only have the latter.
    mri_path = results / "mri_segmentation_pooled" / "mri_segmenter.pt"
    if not mri_path.exists():
        mri_path = results / "mri_segmentation" / "mri_segmenter.pt"
    mri_checkpoint = torch.load(mri_path, map_location=DEVICE, weights_only=True)
    segmenter = MRISegmenter(in_channels=mri_checkpoint["in_channels"], num_classes=mri_checkpoint["num_classes"],
                             widths=tuple(mri_checkpoint["widths"]))
    segmenter.load_state_dict(mri_checkpoint["model_state_dict"])
    segmenter.eval()

    return {
        "ecg": ecg,
        "ecg_classes": ecg_checkpoint["classes"],
        "calibration_scale": np.asarray(calibration["scales"], dtype=np.float32),
        "calibration_bias": np.asarray(calibration["biases"], dtype=np.float32),
        "localizer": load_localizer(results / "digitizer" / "trace_localizer.pt", DEVICE),
        "segmenter": segmenter,
        # Our own artefact, saved by scripts/diagnose_mri.py; never load joblib from elsewhere.
        "diagnosis": joblib.load(results / "mri_diagnosis" / "diagnosis_model.joblib"),
        # The ECG + MRI + health-record fusion network, from nexus-ai-engine's scripts/train_fusion.py.
        "fusion": _load_fusion(results / "fusion_dl", {"ecg": results / "local_xresnet18_full" / "ecg_multilabel.pt",
                                                       "mri": mri_path}),
    }


def _load_fusion(folder: Path, branches: dict[str, Path]) -> dict | None:
    """The fusion network, its calibration and encoding statistics, and its test report; None if not trained yet.

    The network reads the ECG and MRI models' internal features, so it is only valid on the exact model files
    it was built on. If either has changed (a retrained branch), it is not used, and the result says so,
    until scripts/rebuild_fusion.py has rebuilt it."""
    if not (folder / "fusion_model.pt").exists():
        return None
    model, checkpoint = fusion_model.load_fusion(folder / "fusion_model.pt", DEVICE)
    built_on = checkpoint.get("branch_checkpoints")
    changed = [name for name, path in branches.items()
               if not built_on or fusion_model.file_fingerprint(path) != built_on[name]["sha256"]]
    if changed:
        names = " and ".join({"ecg": "ECG", "mri": "MRI"}[c] for c in changed)
        return {"unavailable": f"The {names} model has changed since the fusion network was built on it, so the "
                               f"combined result is left out until the fusion network is rebuilt."}
    report = json.loads((folder / "fusion_report.json").read_text())
    return {"model": model, "checkpoint": checkpoint, "report": report}


def _png(fig) -> str:
    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", dpi=100, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


# ----------------------------------------------------------------------------
# ECG
# ----------------------------------------------------------------------------

IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".bmp", ".webp")
TABLE_SUFFIXES = (".csv", ".txt")

# Checks that an upload is an ECG at all. The classifier has no "not an ECG" answer, so without
# them a logo or random numbers get a confident diagnosis. Thresholds were set by scoring the
# 2,158 PTB-XL test recordings, 40 rendered printouts and 60 unrelated images and photos.
LIMB_LEAD_MIN_TABLE = 0.9    # every real recording scored 1.00; random numbers 0.00
LIMB_LEAD_MIN_IMAGE = 0.6    # flat printouts scored 0.87 or more; unrelated images 0.47 or less
LOW_CONFIDENCE_MAX_IMAGE = 0.3  # printouts had at most 22% of the trace read with low confidence
COPIED_LEADS_MAX = 0.5       # real recordings had at most 9% of lead pairs near-identical


def limb_lead_consistency(signal: np.ndarray, printed: np.ndarray | None = None) -> float | None:
    """How well leads III, aVR, aVL and aVF follow from leads I and II (mean R^2).

    Einthoven's and Goldberger's laws make those four leads linear combinations of I and II
    in any real recording, whatever the patient's condition. Unrelated data has no reason to
    obey them. R^2 with an intercept is unchanged by per-lead standardization.

    With `printed` (a page that printed only part of each lead), a lead is scored only on
    the samples where it and leads I and II were all printed, and skipped when that is under
    a second: on a 3x4 page aVR, aVL and aVF run at 2.5-5 s, when lead I is not on the page.
    Returns None when no lead can be scored.
    """
    printed = np.ones(signal.shape, bool) if printed is None else printed
    scores = []
    for lead in (2, 3, 4, 5):
        together = printed[0] & printed[1] & printed[lead]
        if together.sum() < 100:
            continue
        basis = np.stack([signal[0, together], signal[1, together], np.ones(together.sum())], axis=1)
        target = signal[lead, together]
        coef, *_ = np.linalg.lstsq(basis, target, rcond=None)
        residual = ((target - basis @ coef) ** 2).sum()
        scores.append(1.0 - residual / (((target - target.mean()) ** 2).sum() + 1e-9))
    return float(np.mean(scores)) if scores else None


def copied_lead_share(signal: np.ndarray, printed: np.ndarray | None = None) -> float:
    """Share of lead pairs that are near-identical, as when every row of a blank page reads the same.

    With `printed`, each lead's printed samples are compared, trimmed to the shortest, since
    leads a page prints at different times are still alike if every row read the same."""
    if printed is not None:
        parts = [signal[lead, printed[lead]] for lead in range(signal.shape[0])]
        length = min(len(part) for part in parts)
        signal = np.stack([part[:length] for part in parts])
    with np.errstate(invalid="ignore", divide="ignore"):
        correlation = np.nan_to_num(np.corrcoef(signal))
    upper = np.triu_indices(signal.shape[0], 1)
    return float(np.mean(np.abs(correlation[upper]) > 0.99))


def check_is_ecg(signal: np.ndarray, from_image: bool, low_confidence: float = 0.0,
                 printed: np.ndarray | None = None) -> None:
    """Raise InputError when the signal cannot be a 12-lead ECG.

    `printed` marks the samples a printout actually showed; the rest is fill and is not checked."""
    what = "image" if from_image else "file"
    hint = ("Upload a flat, front-on scan of a 12x1 ECG printout." if from_image
            else "Upload a 12-lead ECG with the leads in the standard order I, II, III, aVR, aVL, aVF, V1-V6.")
    if from_image and low_confidence > LOW_CONFIDENCE_MAX_IMAGE:
        raise InputError(f"This {what} does not look like an ECG printout: no clear trace was found in "
                         f"{low_confidence:.0%} of it. {hint}")
    if copied_lead_share(signal, printed) > COPIED_LEADS_MAX:
        raise InputError(f"This {what} does not look like an ECG: most of its 12 leads are identical. {hint}")
    consistency = limb_lead_consistency(signal, printed)
    if consistency is None:
        raise InputError(f"This {what} does not show leads I and II alongside the other limb leads, so it cannot "
                         f"be checked as a 12-lead ECG. {hint}")
    if consistency < (LIMB_LEAD_MIN_IMAGE if from_image else LIMB_LEAD_MIN_TABLE):
        raise InputError(f"This {what} does not look like a 12-lead ECG: leads III, aVR, aVL and aVF do not "
                         f"follow from leads I and II as they must in a real recording (Einthoven's law; "
                         f"consistency {consistency:.2f}). {hint}")


def _lead_key(name: str) -> str:
    return str(name).strip().upper().replace("LEAD", "").replace("_", "").replace(" ", "")


# Column names that hold time or a sample counter rather than a lead.
TIME_KEYS = {"TIME", "T", "MS", "SECONDS", "SEC", "TIMEMS", "TIMES", "TIME(MS)", "TIME(S)"}
INDEX_KEYS = {"SAMPLE", "INDEX", "N"}
ECG_SECONDS = 10.0
MIN_SECONDS = 9.5          # shorter recordings are refused: stretching them would change heart rate
MAX_MISSING_SHARE = 0.2    # a lead with more gaps than this is refused rather than filled in


def _is_number(value) -> bool:
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def _looks_headerless(columns) -> bool:
    """True when pandas took the first row of numbers as column names.

    pandas renames repeated names ('0.1', '0.1.1'), so a trailing '.N' is ignored.
    """
    names = [str(c) for c in columns]
    numeric = sum(_is_number(n) or _is_number(n.rsplit(".", 1)[0]) for n in names)
    return numeric >= 0.8 * len(names)


def _sampling_rate(times: pd.Series, column: str) -> float | None:
    """Sampling rate from a time column, in seconds or milliseconds."""
    t = pd.to_numeric(times, errors="coerce").to_numpy(dtype=float)
    steps = np.diff(t[np.isfinite(t)])
    step = float(np.median(steps)) if len(steps) else 0.0
    if step <= 0:
        return None
    in_ms = "MS" in _lead_key(column) or step >= 0.5   # 0.5 s between samples is not an ECG
    return (1000.0 if in_ms else 1.0) / step


def _resample(signal: np.ndarray, length: int) -> np.ndarray:
    """Anti-aliased resampling of every lead to `length` samples."""
    from fractions import Fraction
    from scipy.signal import resample_poly

    if signal.shape[1] == length:
        return signal
    ratio = Fraction(length, signal.shape[1]).limit_denominator(1000)
    out = resample_poly(signal, ratio.numerator, ratio.denominator, axis=1, padtype="line")
    if out.shape[1] >= length:
        return out[:, :length]
    return np.pad(out, ((0, 0), (0, length - out.shape[1])), mode="edge")


def read_ecg_table(data: bytes) -> tuple[np.ndarray, list[str]]:
    """Parse a CSV or TXT recording into [12, samples]."""
    notes = []
    text = data.decode("utf-8-sig", errors="replace")  # -sig drops the byte-order mark Excel writes
    try:
        frame = pd.read_csv(io.StringIO(text), sep=None, engine="python")
    except Exception as error:
        raise InputError(f"Could not read the ECG file as a table: {error}") from error

    # A file with no header row has numbers where the column names would be.
    headerless = _looks_headerless(frame.columns)
    if headerless:
        frame = pd.read_csv(io.StringIO(text), sep=None, engine="python", header=None)
        # Leads stored as rows with the lead name first: "I,0.12,0.15,...".
        first = frame.iloc[:, 0]
        if frame.shape[0] < frame.shape[1] and not any(_is_number(v) for v in first):
            frame = frame.set_index(0).T.reset_index(drop=True)
            notes.append("Leads were stored as rows; read them as rows.")

    time_column = next((c for c in frame.columns if _lead_key(c) in TIME_KEYS), None)
    fs = _sampling_rate(frame[time_column], str(time_column)) if time_column is not None else None
    frame = frame.drop(columns=[c for c in frame.columns if _lead_key(c) in TIME_KEYS | INDEX_KEYS])
    frame = frame.apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan)
    frame = frame.dropna(axis=1, how="all").dropna(axis=0, how="all")

    # Twelve rows of many values means leads are stored as rows.
    if frame.shape[0] == 12 and frame.shape[1] > 12:
        frame = frame.T.reset_index(drop=True)
        notes.append("Leads were stored as rows; read them as rows.")

    wanted = [_lead_key(n) for n in LEAD_NAMES]
    available = {_lead_key(c): c for c in frame.columns}
    if all(w in available for w in wanted):
        frame = frame[[available[w] for w in wanted]]
    elif frame.shape[1] >= 12:
        frame = frame.iloc[:, :12]
        notes.append("Lead names were not found, so columns were assumed to be in the standard order "
                     "I, II, III, aVR, aVL, aVF, V1-V6.")
    else:
        raise InputError(f"The ECG file needs 12 lead columns; found {frame.shape[1]} numeric columns. "
                         f"Use a comma, semicolon or tab between values and a full stop as the decimal mark.")

    # Gaps are filled along each lead rather than cutting the row out of every lead,
    # which would splice the recording together and shift the leads in time.
    missing = frame.isna().mean()
    if (missing > MAX_MISSING_SHARE).any():
        bad = ", ".join(LEAD_NAMES[i] for i, m in enumerate(missing) if m > MAX_MISSING_SHARE)
        raise InputError(f"Lead(s) {bad} are more than {MAX_MISSING_SHARE:.0%} empty or unreadable.")
    if missing.any():
        count = int(frame.isna().sum().sum())
        frame = frame.interpolate(limit_direction="both")
        notes.append(f"{count} missing or unreadable value(s) were filled in from their neighbours.")

    signal = frame.to_numpy(dtype=np.float64).T
    if signal.shape[1] < 100:
        raise InputError(f"The ECG recording is too short ({signal.shape[1]} samples); at least 100 are needed.")
    if fs is not None:
        seconds = signal.shape[1] / fs
        if seconds < MIN_SECONDS:
            raise InputError(f"The recording is {seconds:.1f} s long ({signal.shape[1]} samples at {fs:g} Hz, "
                             f"from its time column). The model reads 10 s; a shorter recording would have to be "
                             f"stretched, which changes the heart rate it sees.")
        if seconds > ECG_SECONDS + 0.5 / fs:
            signal = signal[:, : int(round(ECG_SECONDS * fs))]
            notes.append(f"The recording is {seconds:.0f} s long; its first 10 s were analysed.")
        if abs(fs - ECG_SAMPLES / ECG_SECONDS) > 0.5:
            notes.append(f"Resampled from {fs:g} Hz (read from the time column) to the model's 100 Hz.")
    elif signal.shape[1] != ECG_SAMPLES:
        notes.append(f"The file has no time column, so its {signal.shape[1]} samples were assumed to span "
                     f"10 s ({signal.shape[1] / ECG_SECONDS:g} Hz) and resampled to 100 Hz. If the recording is "
                     f"not 10 s long, add a time column, or heart rate and intervals will be read wrongly.")
    signal = _resample(signal, ECG_SAMPLES)

    flat = [LEAD_NAMES[i] for i, lead in enumerate(signal) if lead.std() < 1e-6]
    if flat:
        notes.append(f"Flat lead(s) {', '.join(flat)}: possibly disconnected; results may be less reliable.")
    signal = signal.astype(np.float32)
    # Per-lead standardization, exactly as in training.
    signal = (signal - signal.mean(axis=1, keepdims=True)) / (signal.std(axis=1, keepdims=True) + 1e-6)
    return signal.astype(np.float32), notes

def _ecg_figure(signal: np.ndarray, values: np.ndarray, title: str) -> str:
    """Twelve leads, with red shading where the evidence supports the finding."""
    scale = np.abs(values).max() or 1.0
    t = np.arange(signal.shape[1]) / 100.0
    fig, axes = plt.subplots(12, 1, figsize=(10, 9.5), sharex=True)
    for lead, axis in enumerate(axes):
        axis.plot(t, signal[lead], color="#102d42", linewidth=0.8)
        positive = np.clip(values[lead], 0, None) / scale
        negative = np.clip(values[lead], None, 0) / scale
        axis.fill_between(t, 0, positive * 3, color="#d1495b", alpha=0.55, linewidth=0)
        axis.fill_between(t, 0, negative * 3, color="#1f6fd1", alpha=0.35, linewidth=0)
        axis.set_ylabel(LEAD_NAMES[lead], rotation=0, labelpad=16, fontsize=8)
        axis.set_yticks([])
        for spine in ("top", "right", "left"):
            axis.spines[spine].set_visible(False)
    axes[-1].set_xlabel("seconds")
    fig.suptitle(title, fontsize=10)
    fig.tight_layout()
    return _png(fig)


def analyze_ecg(filename: str, data: bytes) -> dict:
    m = models()
    notes: list[str] = []
    lower = filename.lower()
    if lower.endswith(".pdf"):
        raise InputError("PDF ECGs are not supported yet. Upload the ECG as a CSV or TXT of the 12 leads, "
                         "or as a PNG or JPG scan of a 12x1 printout.")
    if not lower.endswith(IMAGE_SUFFIXES + TABLE_SUFFIXES):
        raise InputError(f"{filename} is not a supported ECG file. Upload a CSV or TXT of the 12 leads, "
                         f"or a PNG or JPG scan of a 12x1 printout.")
    if lower.endswith(IMAGE_SUFFIXES):
        image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise InputError("The ECG image could not be opened.")
        digitized = digitize_page(image, m["localizer"], DEVICE)
        signal = digitized.signal[:, :ECG_SAMPLES].astype(np.float32)
        check_is_ecg(signal, from_image=True, low_confidence=float((digitized.confidence < 0.15).mean()))
        source = {"type": "image", "evidence": MODEL_EVIDENCE["ecg_image"]}
        notes += digitized.warnings
        notes.append("Read from an image: works best on a flat, front-on scan of a 12x1 printout.")
    else:
        signal, table_notes = read_ecg_table(data)
        check_is_ecg(signal, from_image=False)
        notes += table_notes
        source = {"type": "signal"}

    with torch.no_grad():
        logits = m["ecg"](torch.from_numpy(signal)[None].to(DEVICE))[0].numpy()
    probabilities = 1.0 / (1.0 + np.exp(-(logits * m["calibration_scale"] + m["calibration_bias"])))
    classes = list(m["ecg_classes"])
    findings = [{"code": c, "label": CLASS_LABELS[c], "probability": round(float(p), 4)}
                for c, p in zip(classes, probabilities)]

    abnormal = [i for i, c in enumerate(classes) if c != "NORM"]
    top_abnormal = max(abnormal, key=lambda i: probabilities[i])
    if probabilities[top_abnormal] >= 0.5:
        target = top_abnormal
    else:
        target = int(np.argmax(probabilities))

    explanation = attribute(m["ecg"], signal, target, DEVICE, steps=32)
    with torch.no_grad():
        embedding = m["ecg"].encoder(torch.from_numpy(signal)[None].to(DEVICE))[0].numpy()
    lead_share = np.clip(explanation.values, 0, None).sum(axis=1)
    lead_share = lead_share / (lead_share.sum() or 1.0)
    order = np.argsort(lead_share)[::-1][:3]
    top_label = CLASS_LABELS[classes[target]]

    return {
        "source": source,
        "findings": findings,
        "explained_class": {"code": classes[target], "label": top_label,
                            "probability": round(float(probabilities[target]), 4)},
        "attribution_image": _ecg_figure(
            signal, explanation.values,
            f"Integrated Gradients for '{top_label}' (red supports it, blue argues against)"),
        "leads_most_relied_on": [{"lead": LEAD_NAMES[i], "share": round(float(lead_share[i]), 3)} for i in order],
        "notes": notes,
        "_fusion_input": embedding,
        "evidence": MODEL_EVIDENCE["ecg"],
    }


# ----------------------------------------------------------------------------
# MRI
# ----------------------------------------------------------------------------

NIFTI_SUFFIXES = (".nii", ".nii.gz")


def _resample_inplane(volume: np.ndarray, spacing_xy: tuple[float, float], order: int) -> np.ndarray:
    """[slices, x, y] to 1 mm in-plane, the resolution the segmenter was trained at."""
    from scipy import ndimage

    factors = (1.0, spacing_xy[0], spacing_xy[1])
    if np.allclose(factors[1:], 1.0, atol=0.02):
        return volume
    return ndimage.zoom(volume, factors, order=order)


def _load_nifti(filename: str, data: bytes) -> dict:
    import nibabel as nib

    suffix = ".nii.gz" if filename.lower().endswith(".gz") else ".nii"
    # Written and closed before reading: Windows cannot reopen a file that is still open,
    # which is what NamedTemporaryFile would need.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as folder:
        path = Path(folder) / f"upload{suffix}"
        path.write_bytes(data)
        try:
            image = nib.load(str(path))
            array = np.asarray(image.dataobj, dtype=np.float32)
            zooms = tuple(float(z) for z in image.header.get_zooms()[:3])
        except Exception as error:
            raise InputError(f"{filename} could not be read as a NIfTI file; it may be damaged or "
                             f"not a NIfTI file at all.") from error
        del image  # release the file so the folder can be removed on Windows
    if array.ndim == 4:
        raise InputError(f"{filename} is a 4D cine series. Upload the end-diastole and end-systole "
                         f"frames as two separate 3D files.")
    if array.ndim == 2:
        array = array[:, :, None]
        zooms = (zooms[0], zooms[1], 10.0)
    volume = np.transpose(array, (2, 0, 1))
    volume = _resample_inplane(volume, zooms[:2], order=1)
    return {"name": filename, "volume": _fit(volume), "spacing": (1.0, 1.0, zooms[2]), "exact_spacing": True}


def _load_dicom(filename: str, data: bytes) -> dict:
    """Reads single-slice, multi-frame, or volume DICOM and Siemens .ima files."""
    import pydicom

    try:
        dataset = pydicom.dcmread(io.BytesIO(data))
        pixels = dataset.pixel_array.astype(np.float32)
    except Exception as error:
        raise InputError(f"{filename} could not be read as a DICOM image; it may be damaged or "
                         f"hold no pixel data.") from error

    spacing = [float(v) for v in getattr(dataset, "PixelSpacing", [0.0, 0.0])]
    slice_thickness = float(getattr(dataset, "SliceThickness", 10.0))

    if pixels.ndim == 2:
        if spacing[0] > 0 and spacing[1] > 0:
            pixels = _resample_inplane(pixels[None], (spacing[0], spacing[1]), order=1)[0]
            exact = True
        else:
            factor = IMAGE_SIZE / max(pixels.shape)
            pixels = cv2.resize(pixels, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
            exact = False
        return {"name": filename, "volume": _fit(pixels[None]), "spacing": (1.0, 1.0, slice_thickness), "exact_spacing": exact}

    elif pixels.ndim == 3:
        volume = pixels
        if spacing[0] > 0 and spacing[1] > 0:
            volume = _resample_inplane(volume, (spacing[0], spacing[1]), order=1)
            exact = True
        else:
            factor = IMAGE_SIZE / max(volume.shape[1], volume.shape[2])
            volume = np.stack([cv2.resize(s, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA) for s in volume])
            exact = False
        return {"name": filename, "volume": _fit(volume), "spacing": (1.0, 1.0, slice_thickness), "exact_spacing": exact}

    elif pixels.ndim == 4:
        # Cine series: extract first frame (end-diastole)
        volume = pixels[0]
        if spacing[0] > 0 and spacing[1] > 0:
            volume = _resample_inplane(volume, (spacing[0], spacing[1]), order=1)
            exact = True
        else:
            exact = False
        return {"name": filename, "volume": _fit(volume), "spacing": (1.0, 1.0, slice_thickness), "exact_spacing": exact}

    raise InputError(f"{filename} has unsupported dimensions ({pixels.ndim}D).")


def _load_nrrd(filename: str, data: bytes) -> dict:
    """Reads Nearly Raw Raster Data (.nrrd) volumes."""
    try:
        sep = data.find(b"\n\n")
        if sep == -1:
            sep = data.find(b"\r\n\r\n")
            header_str = data[:sep].decode("latin1")
            data_bytes = data[sep + 4:]
        else:
            header_str = data[:sep].decode("latin1")
            data_bytes = data[sep + 2:]

        header = {}
        for line in header_str.splitlines():
            line = line.strip()
            if ":" in line:
                k, v = line.split(":", 1)
                header[k.strip().lower()] = v.strip()

        type_str = header.get("type", "short").lower()
        dtype_map = {
            "short": np.int16, "int16": np.int16, "uint16": np.uint16,
            "int": np.int32, "int32": np.int32, "float": np.float32,
            "double": np.float64, "uchar": np.uint8, "uint8": np.uint8
        }
        dtype = dtype_map.get(type_str, np.float32)
        sizes = [int(s) for s in header.get("sizes", "0 0 0").split()]
        spacings = [float(s) for s in header.get("spacings", "1 1 10").split()]

        if header.get("encoding", "").lower() == "gzip":
            import gzip
            data_bytes = gzip.decompress(data_bytes)

        arr = np.frombuffer(data_bytes, dtype=dtype).astype(np.float32)
        if len(sizes) == 3:
            arr = arr.reshape(sizes[::-1])  # [z, y, x]
            spacing = (spacings[0] if len(spacings) > 0 else 1.0,
                       spacings[1] if len(spacings) > 1 else 1.0,
                       spacings[2] if len(spacings) > 2 else 10.0)
        else:
            arr = arr.reshape(sizes[::-1])[None]
            spacing = (1.0, 1.0, 10.0)

        volume = _resample_inplane(arr, spacing[:2], order=1)
        return {"name": filename, "volume": _fit(volume), "spacing": (1.0, 1.0, spacing[2]), "exact_spacing": True}
    except Exception as error:
        raise InputError(f"{filename} could not be read as an NRRD volume: {error}") from error


def _load_metaimage(filename: str, data: bytes) -> dict:
    """Reads MetaImage (.mha / .mhd) medical images."""
    try:
        sep = data.find(b"\n\n")
        if sep == -1:
            sep = data.find(b"\r\n\r\n")
            header_str = data[:sep].decode("latin1")
            data_bytes = data[sep + 4:]
        else:
            header_str = data[:sep].decode("latin1")
            data_bytes = data[sep + 2:]

        tags = {}
        for line in header_str.splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                tags[k.strip().lower()] = v.strip()

        dim_size = [int(x) for x in tags.get("dimsize", "0 0 0").split()]
        spacing = [float(x) for x in tags.get("elementspacing", "1 1 10").split()]
        type_str = tags.get("elementtype", "MET_SHORT")
        dtype = np.int16 if "SHORT" in type_str else (np.float32 if "FLOAT" in type_str else np.uint8)

        arr = np.frombuffer(data_bytes, dtype=dtype).astype(np.float32)
        if len(dim_size) == 3:
            arr = arr.reshape(dim_size[::-1])
        else:
            arr = arr.reshape(dim_size[::-1])[None]

        volume = _resample_inplane(arr, (spacing[0], spacing[1]), order=1)
        return {"name": filename, "volume": _fit(volume), "spacing": (1.0, 1.0, spacing[2] if len(spacing) > 2 else 10.0), "exact_spacing": True}
    except Exception as error:
        raise InputError(f"{filename} could not be read as a MetaImage: {error}") from error


def _load_tiff(filename: str, data: bytes) -> dict:
    """Reads single-slice or multi-page volume TIFF files."""
    from PIL import Image, ImageSequence
    try:
        tif = Image.open(io.BytesIO(data))
        frames = [np.array(page).astype(np.float32) for page in ImageSequence.Iterator(tif)]
        if not frames:
            raise InputError(f"{filename} contains no readable TIFF frames.")
        
        volume = np.stack(frames)
        if volume.shape[1] != IMAGE_SIZE or volume.shape[2] != IMAGE_SIZE:
            factor = IMAGE_SIZE / max(volume.shape[1], volume.shape[2])
            volume = np.stack([cv2.resize(s, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA) for s in volume])

        return {"name": filename, "volume": _fit(volume), "spacing": (1.0, 1.0, 10.0), "exact_spacing": False}
    except Exception as error:
        raise InputError(f"{filename} could not be opened as a TIFF image: {error}") from error


def _load_zip_archive(filename: str, data: bytes) -> dict:
    """Extracts a ZIP archive containing DICOM or image slice files into a volume."""
    import zipfile
    try:
        with zipfile.ZipFile(io.BytesIO(data), 'r') as zf:
            file_list = sorted([name for name in zf.namelist() if not name.startswith("__MACOSX") and not name.endswith("/")])
            if not file_list:
                raise InputError(f"{filename} contains no files.")
            
            slices = []
            for item_name in file_list:
                sub_bytes = zf.read(item_name)
                lower_sub = item_name.lower()
                if lower_sub.endswith((".dcm", ".ima")):
                    loaded_sub = _load_dicom(item_name, sub_bytes)
                    slices.append(loaded_sub["volume"][0])
                elif lower_sub.endswith((".png", ".jpg", ".jpeg", ".bmp", ".webp")):
                    img = cv2.imdecode(np.frombuffer(sub_bytes, np.uint8), cv2.IMREAD_GRAYSCALE)
                    if img is not None:
                        factor = IMAGE_SIZE / max(img.shape)
                        img = cv2.resize(img.astype(np.float32), None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
                        slices.append(img)
            
            if not slices:
                raise InputError(f"No valid DICOM or image slices found in {filename}.")
            
            volume = np.stack(slices)
            return {"name": filename, "volume": _fit(volume), "spacing": (1.0, 1.0, 10.0), "exact_spacing": False}
    except Exception as error:
        raise InputError(f"Failed to read ZIP archive {filename}: {error}") from error


def _load_slice(filename: str, data: bytes) -> dict:
    lower = filename.lower()
    if lower.endswith((".dcm", ".ima", ".dicom")):
        return _load_dicom(filename, data)
    elif lower.endswith(".nrrd"):
        return _load_nrrd(filename, data)
    elif lower.endswith((".mha", ".mhd")):
        return _load_metaimage(filename, data)
    elif lower.endswith((".tif", ".tiff")):
        return _load_tiff(filename, data)
    elif lower.endswith(".zip"):
        return _load_zip_archive(filename, data)
    else:
        pixels = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
        if pixels is None:
            raise InputError(f"{filename} could not be opened as an image.")
        pixels = pixels.astype(np.float32)
        factor = IMAGE_SIZE / max(pixels.shape)
        pixels = cv2.resize(pixels, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
        return {"name": filename, "volume": _fit(pixels[None]), "spacing": (1.0, 1.0, 10.0), "exact_spacing": False}


def _normalize(volume: np.ndarray) -> np.ndarray:
    low, high = np.percentile(volume, (0.5, 99.5))
    clipped = np.clip(volume, low, high)
    return ((clipped - clipped.mean()) / (clipped.std() + 1e-6)).astype(np.float32)


SEGMENT_BATCH = 16


@torch.no_grad()
def _mri_figure(panels: list[tuple[str, np.ndarray, np.ndarray]]) -> str:
    colours = {1: "#e4572e", 2: "#29335c", 3: "#17bebb"}
    fig, axes = plt.subplots(1, len(panels), figsize=(4.2 * len(panels), 4.4))
    axes = np.atleast_1d(axes)
    for axis, (title, image, mask) in zip(axes, panels):
        axis.imshow(image, cmap="gray")
        for label, colour in colours.items():
            if (mask == label).any():
                axis.contour(mask == label, levels=[0.5], colors=colour, linewidths=1.4)
        axis.set_title(title, fontsize=10)
        axis.axis("off")
    fig.tight_layout()
    fig.suptitle("Model outline: red right ventricle, dark blue myocardium, teal left ventricle", fontsize=9, y=1.03)
    return _png(fig)


# A short-axis left ventricle is a cavity ringed by myocardium. With the pooled model, all 692 test
# volumes of ACDC, M&Ms and M&Ms-2 met both limits. None of 29 unrelated photos, logos and printouts
# did with the earlier ACDC-only model; that rejection has not been re-run on the pooled model.
LV_MIN_PIXELS = 200       # at 1 mm per pixel, 2 cm^2; real mid-ventricle slices were 530 or more
MYO_RING_MIN_SHARE = 0.5  # share of the band around the cavity segmented as myocardium


def looks_like_heart(mask: np.ndarray) -> bool:
    """True if some slice has a left ventricle of plausible size wrapped in myocardium."""
    kernel = np.ones((5, 5), np.uint8)
    for labels in mask:
        cavity = (labels == 3).astype(np.uint8)
        if cavity.sum() < LV_MIN_PIXELS:
            continue
        band = cv2.dilate(cavity, kernel) - cavity
        if (labels[band > 0] == 2).mean() >= MYO_RING_MIN_SHARE:
            return True
    return False


def _middle_slice(mask: np.ndarray) -> int:
    areas = (mask == 3).sum(axis=(1, 2))
    return int(np.argmax(areas)) if areas.any() else len(mask) // 2


def _ef_category(ef: float) -> str:
    # ESC 2021 heart failure guideline bands for left ventricular ejection fraction.
    if ef >= 50:
        return "normal"
    if ef > 40:
        return "mildly reduced"
    return "reduced"


# An ejection fraction below this means the two frames are the same phase or the same file,
# not a living heart.
MIN_PLAUSIBLE_EF = 3.0
HEIGHT_RANGE_CM = (100.0, 250.0)
WEIGHT_RANGE_KG = (25.0, 300.0)


def check_body_size(height_cm: float | None, weight_kg: float | None) -> None:
    """Refuse heights and weights in the wrong units; they would change the diagnosis silently."""
    if height_cm is not None and not HEIGHT_RANGE_CM[0] <= height_cm <= HEIGHT_RANGE_CM[1]:
        raise InputError(f"Height {height_cm:g} is outside {HEIGHT_RANGE_CM[0]:g}-{HEIGHT_RANGE_CM[1]:g} cm. "
                         f"Enter height in centimetres, for example 172 rather than 1.72.")
    if weight_kg is not None and not WEIGHT_RANGE_KG[0] <= weight_kg <= WEIGHT_RANGE_KG[1]:
        raise InputError(f"Weight {weight_kg:g} is outside {WEIGHT_RANGE_KG[0]:g}-{WEIGHT_RANGE_KG[1]:g} kg. "
                         f"Enter weight in kilograms.")


def analyze_mri(files: list[tuple[str, bytes]], height_cm: float | None, weight_kg: float | None) -> dict:
    notes: list[str] = []
    if len(files) > 2:
        raise InputError("Upload at most two MRI files: the end-diastole and end-systole frames.")
    check_body_size(height_cm, weight_kg)
    loaded = []
    for name, data in files:
        lower = name.lower()
        if lower.endswith(NIFTI_SUFFIXES):
            loaded.append(_load_nifti(name, data))
        elif lower.endswith((".dcm", ".ima", ".dicom", ".nrrd", ".mha", ".mhd", ".tif", ".tiff", ".zip") + IMAGE_SUFFIXES):
            loaded.append(_load_slice(name, data))
        else:
            raise InputError(f"{name}: Supported MRI formats are NIfTI (.nii / .nii.gz), DICOM / Siemens (.dcm / .ima), "
                             f"NRRD (.nrrd), MetaImage (.mha / .mhd), TIFF (.tif / .tiff), ZIP archives (.zip), or image slices (.png / .jpg / .bmp / .webp).")

    for item in loaded:
        item["mask"], item["pooled"] = fusion_model.mri_volume_features(
            models()["segmenter"], fusion_model.normalize_volume(item["volume"]), DEVICE, batch=SEGMENT_BATCH)
        item["ml"] = structure_volumes_ml(item["mask"], item["spacing"])
        # Photos, logos and ECG printouts would otherwise reach the summary as an MRI with nothing
        # wrong; the segmenter even marks small "ventricles" in some of them.
        if not looks_like_heart(item["mask"]):
            raise InputError(f"No heart was found in {item['name']}. Upload a short-axis cardiac MRI: two "
                             f"NIfTI volumes (end-diastole and end-systole), or a DICOM or image slice.")

    volumetric = [item for item in loaded if item["volume"].shape[0] > 1]
    result: dict = {"evidence": MODEL_EVIDENCE["mri"], "notes": notes}

    if len(volumetric) == 2:
        first, second = volumetric
        if first["volume"].shape == second["volume"].shape and np.array_equal(first["volume"], second["volume"]):
            raise InputError("The two MRI files hold the same images. Upload the end-diastole and the "
                             "end-systole frame of one scan.")
        if first["volume"].shape[0] != second["volume"].shape[0] or first["spacing"] != second["spacing"]:
            raise InputError("The two MRI volumes have a different number of slices or slice spacing, so they "
                             "are not two frames of the same scan. Upload the end-diastole and end-systole "
                             "frames from one short-axis cine series.")
        ed, es = sorted(volumetric, key=lambda item: item["ml"]["LV"], reverse=True)
        notes.append(f"{ed['name']} was taken as end-diastole and {es['name']} as end-systole, "
                     f"because its left ventricle is larger.")
        lv_ef = 100.0 * (1.0 - es["ml"]["LV"] / ed["ml"]["LV"])  # looks_like_heart guarantees an LV
        if lv_ef < MIN_PLAUSIBLE_EF:
            raise InputError(f"The two volumes give an ejection fraction of {lv_ef:.1f}%: their left ventricles "
                             f"are almost the same size. Check that one file is end-diastole and the other "
                             f"end-systole of the same scan.")
        result["mode"] = "volume_pair"
        result["measurements"] = {
            "lv_end_diastolic_ml": round(ed["ml"]["LV"], 1),
            "lv_end_systolic_ml": round(es["ml"]["LV"], 1),
            "lv_ejection_fraction": round(lv_ef, 1),
            "lv_ejection_fraction_category": _ef_category(lv_ef),
            "rv_end_diastolic_ml": round(ed["ml"]["RV"], 1),
            "myocardial_mass_g": round(ed["ml"]["MYO"] * 1.05, 1),
        }
        fused = models().get("fusion")
        if fused is not None and "model" in fused and ed["exact_spacing"] and es["exact_spacing"]:
            result["_fusion_input"] = fusion_model.mri_vector(
                ed["pooled"], es["pooled"], pooled_features(ed["mask"], es["mask"], ed["spacing"]),
                fused["checkpoint"]["mri_stats"])
            result["_fusion_frames"] = 2
        if ed["ml"]["RV"] > 0:
            result["measurements"]["rv_ejection_fraction"] = round(100.0 * (1.0 - es["ml"]["RV"] / ed["ml"]["RV"]), 1)
        else:
            notes.append("The right ventricle was not found at end-diastole, so RV ejection fraction is not given.")
        ed_slice, es_slice = _middle_slice(ed["mask"]), _middle_slice(es["mask"])
        result["segmentation_image"] = _mri_figure([
            ("End-diastole (heart full)", ed["volume"][ed_slice], ed["mask"][ed_slice]),
            ("End-systole (heart squeezed)", es["volume"][es_slice], es["mask"][es_slice]),
        ])

        # ZIP, TIFF and image stacks carry no pixel size, so their volumes are on a guessed scale. EF is a
        # ratio and survives that; the diagnosis compares absolute sizes with body size and does not.
        exact = ed["exact_spacing"] and es["exact_spacing"]
        if not exact:
            notes.append("Pixel and slice size were not in the files, so volumes and heart mass are approximate "
                         "and no diagnosis is given; ejection fraction is still valid. Upload NIfTI or DICOM "
                         "files for exact sizes.")
        elif height_cm and weight_kg:
            bundle = models()["diagnosis"]
            features = measurement_features(ed["mask"], es["mask"], ed["spacing"], height_cm / 100.0, weight_kg)
            row = pd.Series(features)
            probabilities = bundle["model"].predict_proba(pd.DataFrame([features])[bundle["features"]])[0]
            ranked = sorted(zip(bundle["classes"], probabilities), key=lambda pair: pair[1], reverse=True)
            result["diagnosis"] = {
                "probabilities": [{"code": c, "label": DIAGNOSIS_LABELS[c], "probability": round(float(p), 4)}
                                  for c, p in ranked],
                "because": explain_patient(row, bundle["normal_reference_ranges"]),
                "evidence": MODEL_EVIDENCE["diagnosis"],
            }
        else:
            notes.append("Enter height and weight to get a diagnosis: the model uses heart size relative to body size.")
    else:
        item = volumetric[0] if volumetric else loaded[0]
        if len(loaded) > 1:
            skipped = next(other["name"] for other in loaded if other is not item)
            notes.append(f"Only {item['name']} was analysed; {skipped} was not used. Ejection fraction needs "
                         f"two short-axis NIfTI volumes (end-diastole and end-systole).")
        index = _middle_slice(item["mask"])
        result["mode"] = "volume" if item["volume"].shape[0] > 1 else "slice"
        areas = {name: int((item["mask"][index] == label).sum()) for label, name in STRUCTURES.items()}
        result["measurements"] = {"slice_area_px": areas}
        if result["mode"] == "volume":
            result["measurements"].update({f"{k.lower()}_volume_ml": round(v, 1) for k, v in item["ml"].items()})
            fused = models().get("fusion")
            if fused is not None and "model" in fused and item["exact_spacing"]:
                result["_fusion_input"] = fusion_model.mri_vector(
                    item["pooled"], None, fusion_model.single_frame_measurements(item["mask"], item["spacing"]),
                    fused["checkpoint"]["mri_stats"])
                result["_fusion_frames"] = 1
            notes.append("One volume gives chamber sizes only. Upload both end-diastole and end-systole "
                         "volumes to measure ejection fraction.")
        else:
            notes.append("A single slice gives the outline only. Ejection fraction and diagnosis need "
                         "two short-axis volumes (NIfTI).")
        if not item["exact_spacing"]:
            notes.append("Pixel size was unknown, so the image was rescaled; the outline is approximate.")
        result["segmentation_image"] = _mri_figure([(item["name"], item["volume"][index], item["mask"][index])])

    return result


# ----------------------------------------------------------------------------
# Clinical values against reference ranges
# ----------------------------------------------------------------------------

AGE_RANGE = (1, 119)


def assess_clinical(age: int, gender: str, blood_pressure: int | None, cholesterol: int | None,
                    max_heart_rate: int | None, chest_pain: str | None, exercise_angina: str | None) -> dict:
    """Guideline checks on the values that were entered; a value left blank is not checked."""
    if not AGE_RANGE[0] <= age <= AGE_RANGE[1]:
        raise InputError(f"Age {age} is outside {AGE_RANGE[0]}-{AGE_RANGE[1]} years.")
    flags = []
    not_entered = []

    def flag(level: str, item: str, text: str):
        flags.append({"level": level, "item": item, "text": text})

    # ACC/AHA 2017 blood pressure categories (systolic).
    if blood_pressure is None:
        not_entered.append("blood pressure")
    elif blood_pressure >= 180:
        flag("high", "Blood pressure", f"{blood_pressure} mm Hg is in the hypertensive crisis range (180 or above).")
    elif blood_pressure >= 140:
        flag("moderate", "Blood pressure", f"{blood_pressure} mm Hg is stage 2 hypertension (140 or above).")
    elif blood_pressure >= 130:
        flag("moderate", "Blood pressure", f"{blood_pressure} mm Hg is stage 1 hypertension (130-139).")
    elif blood_pressure >= 120:
        flag("info", "Blood pressure", f"{blood_pressure} mm Hg is elevated (120-129).")
    else:
        flag("ok", "Blood pressure", f"{blood_pressure} mm Hg is in the normal range.")

    # NCEP ATP III total cholesterol bands.
    if cholesterol is None:
        not_entered.append("cholesterol")
    elif cholesterol >= 240:
        flag("moderate", "Cholesterol", f"{cholesterol} mg/dL is high (240 or above).")
    elif cholesterol >= 200:
        flag("info", "Cholesterol", f"{cholesterol} mg/dL is borderline high (200-239).")
    else:
        flag("ok", "Cholesterol", f"{cholesterol} mg/dL is desirable (below 200).")

    if chest_pain is None and exercise_angina is None:
        not_entered.append("symptoms")
    typical = (chest_pain or "").strip().lower() == "typical angina"
    exertional = (exercise_angina or "").strip().lower() == "yes"
    if typical and exertional:
        flag("high", "Symptoms", "Typical angina brought on by exercise is a classic sign of coronary artery "
                                 "disease and needs medical assessment.")
    elif typical or exertional:
        flag("moderate", "Symptoms", "Chest pain of this kind should be assessed by a doctor.")

    risk_age = 45 if gender.strip().lower() == "male" else 55
    if age >= risk_age:
        flag("info", "Age", f"Age {age} is itself a cardiovascular risk factor ({risk_age} or over).")

    predicted_max = 220 - age
    if max_heart_rate is None:
        not_entered.append("maximum heart rate")
    else:
        flag("info", "Maximum heart rate",
             f"{max_heart_rate} bpm is {100 * max_heart_rate / predicted_max:.0f}% of the age-predicted maximum "
             f"({predicted_max} bpm). Only meaningful if measured during an exercise test.")
    if not_entered:
        flag("info", "Not entered", f"No {', '.join(not_entered)} given, so {'it was' if len(not_entered) == 1 else 'they were'} not checked.")

    return {
        "flags": flags,
        "method": "Checked against published guideline ranges (ACC/AHA 2017 blood pressure, NCEP ATP III "
                  "cholesterol).",
        "_fusion_input": ehr_model.form_row(age, gender, blood_pressure, cholesterol, max_heart_rate,
                                            chest_pain, exercise_angina).iloc[0].to_dict(),
    }


# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------

def _percent(p: float) -> str:
    """A probability as text; the model is not precise enough to state 0% or 100%."""
    return "above 99%" if p > 0.99 else "below 1%" if p < 0.01 else f"{p:.0%}"


def _ecg_phrase(ecg: dict) -> str:
    abnormal = [f for f in ecg["findings"] if f["code"] != "NORM" and f["probability"] >= 0.5]
    if not abnormal:
        return "no clear abnormality"
    top = max(abnormal, key=lambda f: f["probability"])
    return f"{top['label'].lower()}, {top['probability']:.0%}"


def _mri_phrase(mri: dict) -> str | None:
    if "diagnosis" in mri:
        top = mri["diagnosis"]["probabilities"][0]
        return f"most like {top['label'].lower()}"
    ef = mri.get("measurements", {}).get("lv_ejection_fraction")
    return f"left ventricular ejection fraction {ef:.0f}%" if ef is not None else None


def fuse(ecg: dict, mri: dict, clinical: dict) -> dict | None:
    """The fusion network's result for this patient, with its explanation in words."""
    fused = models().get("fusion")
    if fused is None or "model" not in fused:
        return None
    checkpoint, report = fused["checkpoint"], fused["report"]
    form = clinical.get("_fusion_input") or {}
    row = {k: (None if v is None or (isinstance(v, float) and np.isnan(v)) else v) for k, v in form.items()}
    vector, blank = fusion_model.encode_clinical(row, checkpoint["clinical_stats"])
    inputs = fusion_model.FusionInputs(ecg=ecg.get("_fusion_input"), mri=mri.get("_fusion_input"), clinical=vector)
    result = fusion_model.predict(fused["model"], inputs, checkpoint["calibration"], checkpoint["clinical_stats"], blank)
    findings = {"ecg": _ecg_phrase(ecg)}
    if _mri_phrase(mri):
        findings["mri"] = _mri_phrase(mri)
    p = result["probability"]
    test = report["test"]["ecg+mri+clinical"]
    names = fusion_model.MODALITY_NAMES
    return {
        "target": "heart disease",
        "probability": round(p, 4),
        "level": "high" if p >= 0.7 else "moderate" if p >= 0.4 else "low",
        "modalities": [
            {"key": key, "name": names[key][0].upper() + names[key][1:], "used": key in result["modalities"],
             "finding": findings.get(key),
             **{k: round(v, 4) for k, v in result["modalities"].get(key, {}).items()}}
            for key in fusion_model.MODALITIES],
        "clinical_fields": [{"name": f["name"], "points": round(f["points"], 1)}
                            for f in result.get("clinical_fields", [])],
        "explanation": {"patient": fusion_model.explain_in_words(result, findings, "patient"),
                        "clinician": fusion_model.explain_in_words(result, findings, "clinician")},
        "mri_note": {2: None,
                     1: "The MRI was used as one frame: its image features, chamber volumes and muscle mass count, "
                        "but ejection fraction needs both the end-diastole and end-systole frames.",
                     None: "The MRI was not used by the combined model: it needs a 3D short-axis volume (NIfTI, or "
                           "DICOM with slice spacing), so that sizes are in millimetres; a single 2D slice or a "
                           "plain image is outlined but not measured."}[mri.get("_fusion_frames")],
        "method": ("A deep learning fusion network. Each modality has its own trained network: the ECG "
                   "classifier's embedding of the recording, the MRI segmenter's deepest image features with the "
                   "measurements of its outlines, and a small network over the health-record fields. Two "
                   "attention layers let the three inform each other, a learned gate weighs them, and one output "
                   "gives the probability of heart disease. The effect of each modality is how much the result "
                   "moves when that modality is left out; the health-record values are explained with Integrated "
                   "Gradients."),
        "evidence": (f"Trained on {report['virtual_patients']['train_per_epoch']:,} new virtual patients per epoch "
                     f"and tested on {report['virtual_patients']['test']:,}: each joins an ECG (PTB-XL), a cardiac "
                     f"MRI (ACDC, M&Ms, M&Ms-2) and a health record (UCI Heart Disease) of different people with the "
                     f"same diagnosis, from patients none of the models trained on. AUROC with all three "
                     f"{test['auroc']['estimate']:.3f} (95% CI {test['auroc']['low']:.3f}-{test['auroc']['high']:.3f}), "
                     f"F1 {test['f1']:.3f}. No public dataset has all three for the same people, so this measures "
                     f"how well the network combines the evidence, not how it performs on real patients."),
    }


def summarize(ecg: dict, mri: dict, clinical: dict) -> dict:
    reasons = []

    def add(level: str, modality: str, text: str):
        reasons.append({"level": level, "modality": modality, "text": text})

    for finding in ecg["findings"]:
        if finding["code"] == "NORM":
            continue
        p = finding["probability"]
        if finding["code"] == "MI" and p >= 0.7:
            add("high", "ECG", f"{finding['label']} is likely ({p:.0%}).")
        elif p >= 0.5:
            add("moderate", "ECG", f"{finding['label']} is more likely than not ({p:.0%}).")

    measurements = mri.get("measurements", {})
    if "lv_ejection_fraction" in measurements:
        ef = measurements["lv_ejection_fraction"]
        if ef <= 40:
            add("high", "MRI", f"Left ventricular ejection fraction is reduced ({ef:.0f}%).")
        elif ef < 50:
            add("moderate", "MRI", f"Left ventricular ejection fraction is mildly reduced ({ef:.0f}%).")
    if "diagnosis" in mri:
        top = mri["diagnosis"]["probabilities"][0]
        if top["code"] != "NOR" and top["probability"] >= 0.5:
            add("moderate", "MRI", f"Heart measurements most resemble {top['label'].lower()} ({top['probability']:.0%}).")

    for item in clinical["flags"]:
        if item["level"] in ("high", "moderate"):
            add(item["level"], "Clinical", f"{item['item']}: {item['text']}")

    fusion = fuse(ecg, mri, clinical)
    for part in (ecg, mri, clinical):
        part.pop("_fusion_input", None)  # model inputs, not part of the response
        part.pop("_fusion_frames", None)
    unavailable = (models().get("fusion") or {}).get("unavailable")
    if unavailable:
        add("info", "All three", unavailable)
    if fusion is not None:
        p = fusion["probability"]
        if p >= 0.7:
            add("high", "All three", f"The combined model puts the chance of heart disease at {_percent(p)}.")
        elif p >= 0.4:
            add("moderate", "All three", f"The combined model puts the chance of heart disease at {_percent(p)}.")

    levels = {r["level"] for r in reasons}
    attention = "High" if "high" in levels else "Moderate" if "moderate" in levels else "Low"
    if not reasons:
        reasons.append({"level": "ok", "modality": "All",
                        "text": "No finding crossed the thresholds used for this summary."})
    return {
        "attention": attention,
        "reasons": reasons,
        "fusion": fusion,
        "method": "Each modality is analysed by its own trained deep learning model, and a fusion network combines "
                  "the three into one probability of heart disease, explained in words. The attention level comes "
                  "from the explicit thresholds listed here.",
    }


DISCLAIMER = ("Research prototype built for a final-year engineering project. Not a medical device. "
              "Results must not be used to make decisions about anyone's health; see a doctor.")
