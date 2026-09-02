"""Model definition and checkpoint loading for the Cardiac Nexus ECG demo.

The trained weights live in the nexus-ai-engine repository (results/checkpoints/),
not duplicated here — this module fetches them from GitHub at runtime and caches
the result, keeping model artifacts in one place.
"""

import os
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlretrieve

import streamlit as st
import torch
from torch import nn

CHECKPOINT_URL = (
    "https://raw.githubusercontent.com/Cardiac-Nexus-Lab/nexus-ai-engine/main/"
    "results/checkpoints/cardio_nexus_ecg_mi_baseline.pt"
)
CHECKPOINT_NAME = "cardio_nexus_ecg_mi_baseline.pt"

LEAD_NAMES = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
NUM_LEADS = 12
SAMPLE_RATE_HZ = 100
SIGNAL_SECONDS = 10
SIGNAL_LENGTH = SAMPLE_RATE_HZ * SIGNAL_SECONDS  # 1000

# Dataset provenance, stated once so the UI can cite it without hardcoding a
# figure of its own. PTB-XL v1.0.3 contains 21,799 records; see the experiment
# record in nexus-research-docs/experiments/001_ecg_mi_baseline.md.
DATASET_NAME = "PTB-XL v1.0.3"
DATASET_RECORDS = 21_799


class CheckpointUnavailable(RuntimeError):
    """Raised when the trained weights could not be fetched or read."""


class ECG1DCNN(nn.Module):
    """Same architecture as notebooks/01_first_ecg_model.ipynb in nexus-ai-engine."""

    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv1d(NUM_LEADS, 32, kernel_size=7, padding=3),
            nn.BatchNorm1d(32),
            nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(32, 64, kernel_size=7, padding=3),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(64, 128, kernel_size=5, padding=2),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.AdaptiveAvgPool1d(1),
        )
        self.classifier = nn.Linear(128, 1)

    def forward(self, x):
        return self.classifier(self.features(x).squeeze(-1)).squeeze(-1)


class ProbabilityWrapper(nn.Module):
    """Wraps the model so Captum attributes the predicted probability, not the raw logit."""

    def __init__(self, base_model):
        super().__init__()
        self.base_model = base_model

    def forward(self, x):
        return torch.sigmoid(self.base_model(x)).unsqueeze(-1)


def _download_checkpoint(destination: Path) -> None:
    """Fetch the checkpoint, publishing it into place only once fully written.

    Downloading straight to `destination` risks caching a truncated file if the
    connection drops mid-transfer, and since the cache is only tested for
    existence that corrupt file would be reused on every later run. Writing to a
    sibling temp path and renaming makes the cache entry all-or-nothing.
    """
    partial = destination.with_suffix(destination.suffix + ".partial")
    try:
        urlretrieve(CHECKPOINT_URL, partial)
        os.replace(partial, destination)
    except (URLError, OSError) as exc:
        partial.unlink(missing_ok=True)
        raise CheckpointUnavailable(
            f"Could not download the trained checkpoint from {CHECKPOINT_URL} ({exc})."
        ) from exc


@st.cache_resource(show_spinner="Loading trained model...")
def load_model():
    """Return (model, metrics), raising CheckpointUnavailable if weights can't be had."""
    cache_dir = Path.home() / ".cache" / "cardiac-nexus"
    cache_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = cache_dir / CHECKPOINT_NAME

    if not checkpoint_path.exists():
        _download_checkpoint(checkpoint_path)

    # The checkpoint's metrics dict was saved with numpy scalars, so weights_only=True
    # needs that type explicitly allowlisted (the checkpoint is our own trusted artifact).
    import numpy

    try:
        with torch.serialization.safe_globals(
            [numpy._core.multiarray.scalar, numpy.dtype, numpy.dtypes.Float64DType]
        ):
            checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
        model = ECG1DCNN()
        model.load_state_dict(checkpoint["model_state_dict"])
    except Exception as exc:
        # A cached file that will not load is worse than no cache at all: drop it
        # so the next run re-fetches instead of failing identically forever.
        checkpoint_path.unlink(missing_ok=True)
        raise CheckpointUnavailable(
            f"The cached checkpoint could not be read and has been discarded ({exc}). "
            "Reload the page to download it again."
        ) from exc

    model.eval()
    return model, checkpoint.get("metrics", {})
