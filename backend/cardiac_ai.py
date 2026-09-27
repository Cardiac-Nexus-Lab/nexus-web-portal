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

There is no trained fusion model yet: no public dataset pairs ECG, MRI and
health records for the same patients. The summary therefore combines the three
with explicit rules, and says so in its output.
"""

from __future__ import annotations

import base64
import io
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

from cardiac_nexus.data import LEAD_NAMES, SUPERCLASSES  # noqa: E402
from cardiac_nexus.ecg_image.pipeline import digitize_page, load_localizer  # noqa: E402
from cardiac_nexus.explain import attribute  # noqa: E402
from cardiac_nexus.mri_data import IMAGE_SIZE, STRUCTURES, _fit, structure_volumes_ml  # noqa: E402
from cardiac_nexus.mri_diagnosis import explain_patient, measurement_features  # noqa: E402
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
# Held-out test results, reported alongside predictions so users can weigh them.
MODEL_EVIDENCE = {
    "ecg": "Tested on 2,158 unseen PTB-XL recordings: macro AUROC 0.911, calibrated (mean ECE 0.015).",
    "ecg_image": "Digitizer recovers the waveform at 0.94 correlation from flat scans; angled photos are unreliable.",
    "mri": "Tested on 50 unseen ACDC patients: left ventricle Dice 0.956, ejection fraction r 0.991 against experts.",
    "diagnosis": "45 of 50 unseen ACDC patients diagnosed correctly (95% interval 79%-96%).",
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

    mri_checkpoint = torch.load(results / "mri_segmentation" / "mri_segmenter.pt",
                                map_location=DEVICE, weights_only=True)
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
    }


def _png(fig) -> str:
    buffer = io.BytesIO()
    fig.savefig(buffer, format="png", dpi=100, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


# ----------------------------------------------------------------------------
# ECG
# ----------------------------------------------------------------------------

IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg")

# Checks that an upload is an ECG at all. The classifier has no "not an ECG" answer, so without
# them a logo or random numbers get a confident diagnosis. Thresholds were set by scoring the
# 2,158 PTB-XL test recordings, 40 rendered printouts and 60 unrelated images and photos.
LIMB_LEAD_MIN_TABLE = 0.9    # every real recording scored 1.00; random numbers 0.00
LIMB_LEAD_MIN_IMAGE = 0.6    # flat printouts scored 0.87 or more; unrelated images 0.47 or less
LOW_CONFIDENCE_MAX_IMAGE = 0.3  # printouts had at most 22% of the trace read with low confidence
COPIED_LEADS_MAX = 0.5       # real recordings had at most 9% of lead pairs near-identical


def limb_lead_consistency(signal: np.ndarray) -> float:
    """How well leads III, aVR, aVL and aVF follow from leads I and II (mean R^2).

    Einthoven's and Goldberger's laws make those four leads linear combinations of I and II
    in any real recording, whatever the patient's condition. Unrelated data has no reason to
    obey them. R^2 with an intercept is unchanged by per-lead standardization.
    """
    basis = np.stack([signal[0], signal[1], np.ones(signal.shape[1])], axis=1)
    scores = []
    for lead in (2, 3, 4, 5):
        target = signal[lead]
        coef, *_ = np.linalg.lstsq(basis, target, rcond=None)
        residual = ((target - basis @ coef) ** 2).sum()
        scores.append(1.0 - residual / (((target - target.mean()) ** 2).sum() + 1e-9))
    return float(np.mean(scores))


def copied_lead_share(signal: np.ndarray) -> float:
    """Share of lead pairs that are near-identical, as when every row of a blank page reads the same."""
    with np.errstate(invalid="ignore", divide="ignore"):
        correlation = np.nan_to_num(np.corrcoef(signal))
    upper = np.triu_indices(signal.shape[0], 1)
    return float(np.mean(np.abs(correlation[upper]) > 0.99))


def check_is_ecg(signal: np.ndarray, from_image: bool, low_confidence: float = 0.0) -> None:
    """Raise InputError when the signal cannot be a 12-lead ECG."""
    what = "image" if from_image else "file"
    hint = ("Upload a flat, front-on scan of a 12x1 ECG printout." if from_image
            else "Upload a 12-lead ECG with the leads in the standard order I, II, III, aVR, aVL, aVF, V1-V6.")
    if from_image and low_confidence > LOW_CONFIDENCE_MAX_IMAGE:
        raise InputError(f"This {what} does not look like an ECG printout: no clear trace was found in "
                         f"{low_confidence:.0%} of it. {hint}")
    if copied_lead_share(signal) > COPIED_LEADS_MAX:
        raise InputError(f"This {what} does not look like an ECG: most of its 12 leads are identical. {hint}")
    consistency = limb_lead_consistency(signal)
    if consistency < (LIMB_LEAD_MIN_IMAGE if from_image else LIMB_LEAD_MIN_TABLE):
        raise InputError(f"This {what} does not look like a 12-lead ECG: leads III, aVR, aVL and aVF do not "
                         f"follow from leads I and II as they must in a real recording (Einthoven's law; "
                         f"consistency {consistency:.2f}). {hint}")


def _lead_key(name: str) -> str:
    return str(name).strip().upper().replace("LEAD", "").replace("_", "").replace(" ", "")


def read_ecg_table(data: bytes) -> tuple[np.ndarray, list[str]]:
    """Parse a CSV or TXT recording into [12, samples]."""
    notes = []
    text = data.decode("utf-8", errors="replace")
    try:
        frame = pd.read_csv(io.StringIO(text), sep=None, engine="python")
    except Exception as error:
        raise InputError(f"Could not read the ECG file as a table: {error}") from error

    def is_number(value) -> bool:
        try:
            float(value)
            return True
        except (TypeError, ValueError):
            return False

    # A file with no header row has numbers where the column names would be.
    if all(is_number(c) for c in frame.columns):
        frame = pd.read_csv(io.StringIO(text), sep=None, engine="python", header=None)

    frame = frame.drop(columns=[c for c in frame.columns
                                if _lead_key(c) in {"TIME", "T", "SAMPLE", "INDEX", "MS", "SECONDS"}])
    frame = frame.apply(pd.to_numeric, errors="coerce").dropna(axis=1, how="all").dropna(axis=0, how="any")

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
        raise InputError(f"The ECG file needs 12 lead columns; found {frame.shape[1]} numeric columns.")

    signal = frame.to_numpy(dtype=np.float32).T
    if signal.shape[1] < 100:
        raise InputError(f"The ECG recording is too short ({signal.shape[1]} samples); at least 100 are needed.")
    if signal.shape[1] != ECG_SAMPLES:
        notes.append(f"Resampled from {signal.shape[1]} to {ECG_SAMPLES} samples, assuming the recording "
                     f"spans 10 seconds as the model was trained on.")
        source = np.linspace(0, 1, signal.shape[1])
        target = np.linspace(0, 1, ECG_SAMPLES)
        signal = np.stack([np.interp(target, source, lead) for lead in signal]).astype(np.float32)

    flat = [LEAD_NAMES[i] for i, lead in enumerate(signal) if lead.std() < 1e-6]
    if flat:
        notes.append(f"Flat lead(s) {', '.join(flat)}: possibly disconnected; results may be less reliable.")
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
    if filename.lower().endswith(IMAGE_SUFFIXES):
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
    with tempfile.NamedTemporaryFile(suffix=suffix) as handle:
        handle.write(data)
        handle.flush()
        try:
            image = nib.load(handle.name)
            array = np.asarray(image.dataobj, dtype=np.float32)
            zooms = tuple(float(z) for z in image.header.get_zooms()[:3])
        except Exception as error:
            raise InputError(f"{filename} could not be read as a NIfTI file; it may be damaged or "
                             f"not a NIfTI file at all.") from error
    if array.ndim == 4:
        raise InputError(f"{filename} is a 4D cine series. Upload the end-diastole and end-systole "
                         f"frames as two separate 3D files.")
    if array.ndim == 2:
        array = array[:, :, None]
        zooms = (zooms[0], zooms[1], 10.0)
    volume = np.transpose(array, (2, 0, 1))
    volume = _resample_inplane(volume, zooms[:2], order=1)
    return {"name": filename, "volume": _fit(volume), "spacing": (1.0, 1.0, zooms[2]), "exact_spacing": True}


def _load_slice(filename: str, data: bytes) -> dict:
    lower = filename.lower()
    if lower.endswith(".dcm"):
        import pydicom

        try:
            dataset = pydicom.dcmread(io.BytesIO(data))
            pixels = dataset.pixel_array.astype(np.float32)
        except Exception as error:
            raise InputError(f"{filename} could not be read as a DICOM image; it may be damaged or "
                             f"hold no pixel data.") from error
        if pixels.ndim != 2:
            raise InputError(f"{filename} holds more than one frame; upload a single short-axis slice.")
        spacing = [float(v) for v in getattr(dataset, "PixelSpacing", [0, 0])]
        if spacing[0] > 0:
            pixels = _resample_inplane(pixels[None], (spacing[0], spacing[1]), order=1)[0]
            exact = True
        else:
            exact = False
    else:
        pixels = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
        if pixels is None:
            raise InputError(f"{filename} could not be opened as an image.")
        pixels = pixels.astype(np.float32)
        exact = False
    if not exact:
        # Unknown pixel size: scale the longest side to the training field of view.
        factor = IMAGE_SIZE / max(pixels.shape)
        pixels = cv2.resize(pixels, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
    return {"name": filename, "volume": _fit(pixels[None]), "spacing": (1.0, 1.0, 10.0), "exact_spacing": exact}


def _normalize(volume: np.ndarray) -> np.ndarray:
    low, high = np.percentile(volume, (0.5, 99.5))
    clipped = np.clip(volume, low, high)
    return ((clipped - clipped.mean()) / (clipped.std() + 1e-6)).astype(np.float32)


@torch.no_grad()
def _segment(volume: np.ndarray) -> np.ndarray:
    """Each slice with its neighbours as channels (2.5D), as in training."""
    image = _normalize(volume)
    n = len(image)
    stacks = np.stack([np.stack([image[max(i - 1, 0)], image[i], image[min(i + 1, n - 1)]]) for i in range(n)])
    logits = models()["segmenter"](torch.from_numpy(stacks).to(DEVICE))
    return logits.argmax(dim=1).numpy().astype(np.uint8)


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


# A short-axis left ventricle is a cavity ringed by myocardium. Every one of the 100 ACDC test
# volumes met both limits; none of 29 unrelated photos, logos and printouts did.
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


def analyze_mri(files: list[tuple[str, bytes]], height_cm: float | None, weight_kg: float | None) -> dict:
    notes: list[str] = []
    loaded = []
    for name, data in files:
        lower = name.lower()
        if lower.endswith(NIFTI_SUFFIXES):
            loaded.append(_load_nifti(name, data))
        elif lower.endswith((".dcm",) + IMAGE_SUFFIXES):
            loaded.append(_load_slice(name, data))
        else:
            raise InputError(f"{name}: MRI must be NIfTI (.nii / .nii.gz), DICOM (.dcm) or an image (.png / .jpg).")
    if len(loaded) > 2:
        raise InputError("Upload at most two MRI files: the end-diastole and end-systole frames.")

    for item in loaded:
        item["mask"] = _segment(item["volume"])
        item["ml"] = structure_volumes_ml(item["mask"], item["spacing"])
        # Photos, logos and ECG printouts would otherwise reach the summary as an MRI with nothing
        # wrong; the segmenter even marks small "ventricles" in some of them.
        if not looks_like_heart(item["mask"]):
            raise InputError(f"No heart was found in {item['name']}. Upload a short-axis cardiac MRI: two "
                             f"NIfTI volumes (end-diastole and end-systole), or a DICOM or image slice.")

    volumetric = [item for item in loaded if item["volume"].shape[0] > 1]
    result: dict = {"evidence": MODEL_EVIDENCE["mri"], "notes": notes}

    if len(volumetric) == 2:
        ed, es = sorted(volumetric, key=lambda item: item["ml"]["LV"], reverse=True)
        notes.append(f"{ed['name']} was taken as end-diastole and {es['name']} as end-systole, "
                     f"because its left ventricle is larger.")
        lv_ef = 100.0 * (1.0 - es["ml"]["LV"] / ed["ml"]["LV"]) if ed["ml"]["LV"] > 0 else float("nan")
        rv_ef = 100.0 * (1.0 - es["ml"]["RV"] / ed["ml"]["RV"]) if ed["ml"]["RV"] > 0 else float("nan")
        result["mode"] = "volume_pair"
        result["measurements"] = {
            "lv_end_diastolic_ml": round(ed["ml"]["LV"], 1),
            "lv_end_systolic_ml": round(es["ml"]["LV"], 1),
            "lv_ejection_fraction": round(lv_ef, 1),
            "lv_ejection_fraction_category": _ef_category(lv_ef),
            "rv_end_diastolic_ml": round(ed["ml"]["RV"], 1),
            "rv_ejection_fraction": round(rv_ef, 1),
            "myocardial_mass_g": round(ed["ml"]["MYO"] * 1.05, 1),
        }
        ed_slice, es_slice = _middle_slice(ed["mask"]), _middle_slice(es["mask"])
        result["segmentation_image"] = _mri_figure([
            ("End-diastole (heart full)", ed["volume"][ed_slice], ed["mask"][ed_slice]),
            ("End-systole (heart squeezed)", es["volume"][es_slice], es["mask"][es_slice]),
        ])

        if height_cm and weight_kg and height_cm > 0 and weight_kg > 0:
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
        item = loaded[0]
        index = _middle_slice(item["mask"])
        result["mode"] = "volume" if item["volume"].shape[0] > 1 else "slice"
        areas = {name: int((item["mask"][index] == label).sum()) for label, name in STRUCTURES.items()}
        result["measurements"] = {"slice_area_px": areas}
        if result["mode"] == "volume":
            result["measurements"].update({f"{k.lower()}_volume_ml": round(v, 1) for k, v in item["ml"].items()})
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

def assess_clinical(age: int, gender: str, blood_pressure: int, cholesterol: int, max_heart_rate: int,
                    chest_pain: str, exercise_angina: str) -> dict:
    flags = []

    def flag(level: str, item: str, text: str):
        flags.append({"level": level, "item": item, "text": text})

    # ACC/AHA 2017 blood pressure categories (systolic).
    if blood_pressure >= 180:
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
    if cholesterol >= 240:
        flag("moderate", "Cholesterol", f"{cholesterol} mg/dL is high (240 or above).")
    elif cholesterol >= 200:
        flag("info", "Cholesterol", f"{cholesterol} mg/dL is borderline high (200-239).")
    else:
        flag("ok", "Cholesterol", f"{cholesterol} mg/dL is desirable (below 200).")

    typical = chest_pain.strip().lower() == "typical angina"
    exertional = exercise_angina.strip().lower() == "yes"
    if typical and exertional:
        flag("high", "Symptoms", "Typical angina brought on by exercise is a classic sign of coronary artery "
                                 "disease and needs medical assessment.")
    elif typical or exertional:
        flag("moderate", "Symptoms", "Chest pain of this kind should be assessed by a doctor.")

    risk_age = 45 if gender.strip().lower() == "male" else 55
    if age >= risk_age:
        flag("info", "Age", f"Age {age} is itself a cardiovascular risk factor ({risk_age} or over).")

    predicted_max = 220 - age
    flag("info", "Maximum heart rate",
         f"{max_heart_rate} bpm is {100 * max_heart_rate / predicted_max:.0f}% of the age-predicted maximum "
         f"({predicted_max} bpm). Only meaningful if measured during an exercise test.")

    return {
        "flags": flags,
        "method": "Checked against published guideline ranges (ACC/AHA 2017 blood pressure, NCEP ATP III "
                  "cholesterol). This is not a trained model.",
    }


# ----------------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------------

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

    levels = {r["level"] for r in reasons}
    attention = "High" if "high" in levels else "Moderate" if "moderate" in levels else "Low"
    if not reasons:
        reasons.append({"level": "ok", "modality": "All",
                        "text": "No finding crossed the thresholds used for this summary."})
    return {
        "attention": attention,
        "reasons": reasons,
        "method": "Each modality is analysed by its own trained model. No trained fusion model exists yet, "
                  "because no public dataset pairs ECG, MRI and health records for the same patients, so this "
                  "summary combines the results with the explicit thresholds listed here.",
    }


DISCLAIMER = ("Research prototype built for a final-year engineering project. Not a medical device. "
              "Results must not be used to make decisions about anyone's health; see a doctor.")
