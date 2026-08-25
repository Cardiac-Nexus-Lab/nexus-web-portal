"""ECG signal loading and preprocessing utilities, matching nexus-ai-engine's notebooks."""

import numpy as np
import pandas as pd

from model import LEAD_NAMES, NUM_LEADS, SIGNAL_LENGTH


class SignalShapeError(ValueError):
    pass


def load_ecg_csv(uploaded_file) -> np.ndarray:
    """Parse an uploaded CSV into a [12, 1000] float32 array.

    Accepts a CSV with either:
    - 12 columns (one per lead, in I, II, III, aVR, aVL, aVF, V1-V6 order) and 1000 rows, or
    - 1000 columns and 12 rows (leads as rows).
    """
    df = pd.read_csv(uploaded_file, header=None)
    values = df.to_numpy(dtype=np.float32)

    if values.shape == (SIGNAL_LENGTH, NUM_LEADS):
        signal = values.T
    elif values.shape == (NUM_LEADS, SIGNAL_LENGTH):
        signal = values
    else:
        raise SignalShapeError(
            f"Expected a {SIGNAL_LENGTH}x{NUM_LEADS} or {NUM_LEADS}x{SIGNAL_LENGTH} CSV "
            f"(10 seconds at 100 Hz, 12 leads), got shape {values.shape}."
        )

    return standardize(signal)


def standardize(signal: np.ndarray) -> np.ndarray:
    mean = signal.mean(axis=1, keepdims=True)
    std = signal.std(axis=1, keepdims=True) + 1e-6
    return (signal - mean) / std


def synthetic_demo_signal(seed: int = 0) -> np.ndarray:
    """A synthetic 12-lead-shaped signal for demoing the app without real data.

    Not physiologically meaningful -- for UI/pipeline testing only.
    """
    rng = np.random.default_rng(seed)
    t = np.linspace(0, 10, SIGNAL_LENGTH, endpoint=False)
    heart_rate_hz = 1.1
    base = np.sin(2 * np.pi * heart_rate_hz * t) ** 5
    signal = np.stack(
        [base * (0.5 + 0.1 * i) + rng.normal(0, 0.05, SIGNAL_LENGTH) for i in range(NUM_LEADS)]
    ).astype(np.float32)
    return standardize(signal)
