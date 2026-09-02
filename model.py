"""Model definition and checkpoint loading for the Cardiac Nexus ECG demo.

The trained weights live in the nexus-ai-engine repository (results/checkpoints/),
not duplicated here — this module fetches them from GitHub at runtime and caches
the result, keeping model artifacts in one place.
"""

from pathlib import Path
from urllib.request import urlretrieve

import streamlit as st
import torch
from torch import nn

CHECKPOINT_URL = (
    "https://raw.githubusercontent.com/Cardiac-Nexus-Lab/nexus-ai-engine/main/"
    "results/checkpoints/cardio_nexus_ecg_mi_baseline.pt"
)
LEAD_NAMES = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
NUM_LEADS = 12
SIGNAL_LENGTH = 1000  # 10 seconds at 100 Hz


class ECG1DCNN(nn.Module):
    """Same architecture as notebooks/01_first_ecg_model.ipynb in nexus-ai-engine."""

    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv1d(12, 32, kernel_size=7, padding=3),
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


@st.cache_resource(show_spinner="Loading trained model...")
def load_model():
    cache_dir = Path.home() / ".cache" / "cardiac-nexus"
    cache_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = cache_dir / "cardio_nexus_ecg_mi_baseline.pt"

    if not checkpoint_path.exists():
        urlretrieve(CHECKPOINT_URL, checkpoint_path)

    # The checkpoint's metrics dict was saved with numpy scalars, so weights_only=True
    # needs that type explicitly allowlisted (the checkpoint is our own trusted artifact).
    import numpy

    with torch.serialization.safe_globals(
        [numpy._core.multiarray.scalar, numpy.dtype, numpy.dtypes.Float64DType]
    ):
        checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    model = ECG1DCNN()
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    return model, checkpoint.get("metrics", {})
