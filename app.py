"""Cardiac Nexus — ECG explainable-prediction demo.

Loads the trained baseline model from nexus-ai-engine, runs inference on an
uploaded 12-lead ECG, and shows an Integrated Gradients attribution overlay
so the prediction comes with a visual reason, not just a probability.
"""

import matplotlib.pyplot as plt
import numpy as np
import streamlit as st
import torch
from captum.attr import IntegratedGradients

import theme
from model import (
    DATASET_NAME,
    DATASET_RECORDS,
    LEAD_NAMES,
    NUM_LEADS,
    SAMPLE_RATE_HZ,
    SIGNAL_LENGTH,
    SIGNAL_SECONDS,
    CheckpointUnavailable,
    ProbabilityWrapper,
    load_model,
)
from preprocess import SignalShapeError, load_ecg_csv, synthetic_demo_signal

st.set_page_config(
    page_title="Cardiac Nexus",
    page_icon="🫀",
    layout="centered",
)

theme.inject()

# Loaded before any copy is rendered so the headline figures below can be read
# off the checkpoint itself. @st.cache_resource makes this near-free on rerun.
try:
    model, checkpoint_metrics = load_model()
except CheckpointUnavailable as exc:
    st.error(str(exc))
    st.stop()

prob_model = ProbabilityWrapper(model).eval()
integrated_gradients = IntegratedGradients(prob_model)

st.markdown(
    """
    <div class="hero-wrap reveal">
        <span class="hero-line">Explainable</span><br/>
        <span class="hero-line">heart screening.</span>
    </div>
    <p class="subtitle reveal">Deep learning with a visible reason — not a black box.</p>
    """,
    unsafe_allow_html=True,
)

st.markdown(
    """
    <div class="disclaimer reveal">
    <strong>Research tool, not a diagnosis.</strong> This model was trained on the public
    PTB-XL dataset for research evaluation only. It is not a substitute for clinical
    judgment and must not be used as a standalone basis for any medical decision.
    </div>
    """,
    unsafe_allow_html=True,
)

st.markdown(
    """
    <p class="statement reveal">
    A prediction without a reason isn't useful to a clinician.
    So every result here comes with one.
    </p>
    """,
    unsafe_allow_html=True,
)

# Headline figures are read off the checkpoint that is actually being served,
# never typed in. A hand-written number here would silently become a false claim
# the moment the checkpoint is retrained -- which is how this section previously
# came to advertise 21,801 PTB-XL recordings for a 21,799-record dataset.
headline_stats = []
if "AUROC" in checkpoint_metrics:
    headline_stats.append((f"{checkpoint_metrics['AUROC']:.2f}", "TEST AUROC"))
if "Sensitivity" in checkpoint_metrics:
    headline_stats.append((f"{checkpoint_metrics['Sensitivity']:.0%}", "SENSITIVITY"))
headline_stats += [
    (f"{DATASET_RECORDS:,}", f"{DATASET_NAME.split()[0]} RECORDINGS"),
    (str(NUM_LEADS), "ECG LEADS EXPLAINED"),
]
theme.stat_band(headline_stats)

st.markdown(
    """
    <div class="quote-card reveal">
    <strong>Integrated Gradients</strong> attributes every prediction back to the exact
    millisecond and lead that drove it — so the output is a picture you can check
    against real ECG morphology, not just a number to trust blindly.
    </div>
    <div class="quote-card reveal">
    Trained and validated on <strong>PhysioNet's PTB-XL</strong>, the largest publicly
    available 12-lead ECG dataset, using its official patient-wise folds to avoid
    train/test leakage.
    </div>
    """,
    unsafe_allow_html=True,
)

with st.expander("About this model"):
    st.write(
        f"1D convolutional neural network trained on {DATASET_NAME} "
        f"({NUM_LEADS}-lead ECG, {SAMPLE_RATE_HZ} Hz, {SIGNAL_SECONDS}-second recordings) "
        "to detect signs consistent with myocardial infarction (MI)."
    )
    if checkpoint_metrics:
        cols = st.columns(3)
        metric_items = list(checkpoint_metrics.items())[:3]
        for col, (name, value) in zip(cols, metric_items):
            col.metric(name.replace("_", " ").title(), f"{value:.3f}" if isinstance(value, float) else value)
    st.caption(
        "Full results, checkpoint, and methodology: "
        "[nexus-ai-engine/results](https://github.com/Cardiac-Nexus-Lab/nexus-ai-engine/tree/main/results)"
    )

st.divider()

st.markdown('<h2 class="section-num reveal">1. Provide an ECG</h2>', unsafe_allow_html=True)
source = st.radio(
    "Signal source",
    ["Upload a CSV", "Try a synthetic demo signal"],
    horizontal=True,
    label_visibility="collapsed",
)

signal = None
if source == "Upload a CSV":
    st.caption(
        f"{NUM_LEADS}-lead, {SIGNAL_SECONDS}-second, {SAMPLE_RATE_HZ} Hz recording as a CSV "
        f"— either {SIGNAL_LENGTH} rows x {NUM_LEADS} columns "
        f"(leads {', '.join(LEAD_NAMES)}) or {NUM_LEADS} rows x {SIGNAL_LENGTH} columns."
    )
    uploaded = st.file_uploader("ECG CSV", type=["csv"], label_visibility="collapsed")
    if uploaded is not None:
        try:
            signal = load_ecg_csv(uploaded)
        except SignalShapeError as exc:
            st.error(str(exc))
else:
    st.caption(
        f"A synthetically generated signal shaped like a {NUM_LEADS}-lead ECG, for "
        "exercising the app end-to-end without real patient data. Not physiologically "
        "meaningful."
    )
    # The generated signal is parked in session state so it survives the reruns
    # triggered by later widgets; without that, the result would vanish as soon
    # as anything else on the page was touched.
    if st.button("Generate demo signal"):
        st.session_state["demo_signal"] = synthetic_demo_signal(
            seed=np.random.randint(0, 10_000)
        )
    signal = st.session_state.get("demo_signal")

if signal is not None:
    st.markdown('<h2 class="section-num reveal">2. Prediction</h2>', unsafe_allow_html=True)

    # Captum sets requires_grad on its own interpolated path tensors, so the
    # caller does not need to mark the input -- verified to give bit-identical
    # attributions either way.
    input_tensor = torch.tensor(signal, dtype=torch.float32).unsqueeze(0)

    with torch.no_grad():
        probability = torch.sigmoid(model(input_tensor)).item()

    col1, col2 = st.columns(2)
    with col1:
        theme.result_card("Predicted P(MI)", f"{probability:.0%}")
    with col2:
        risk_label = "Elevated pattern" if probability >= 0.5 else "Low pattern"
        theme.result_card("Screening signal", risk_label, value_size="1.6rem")

    st.markdown('<h2 class="section-num reveal">3. Why — Integrated Gradients attribution</h2>', unsafe_allow_html=True)
    st.caption(
        "Red shading = pushed the prediction toward MI. Blue = pushed away from it. "
        "This shows what the model attended to, not a verified clinical finding."
    )

    with st.spinner("Computing attribution..."):
        baseline = torch.zeros_like(input_tensor)
        attribution, delta = integrated_gradients.attribute(
            input_tensor, baselines=baseline, n_steps=64, return_convergence_delta=True
        )
    attribution = attribution.squeeze(0).detach().numpy()

    fig, axes = plt.subplots(NUM_LEADS, 1, figsize=(9, 13), sharex=True)
    time_axis = np.arange(signal.shape[1]) / SAMPLE_RATE_HZ
    max_abs_attr = np.abs(attribution).max() + 1e-8

    for ax, name, lead, lead_attr in zip(axes, LEAD_NAMES, signal, attribution):
        ax.plot(time_axis, lead, color="black", linewidth=0.7)
        # Attribution is normalised to the strongest value across all leads, so
        # panels stay comparable, then scaled to the lead's own amplitude so the
        # shading reads against that trace rather than swamping it.
        norm_attr = lead_attr / max_abs_attr
        shading = norm_attr * (lead.std() * 3)
        ax.fill_between(time_axis, 0, shading, where=norm_attr >= 0,
                        color=theme.ACCENT, alpha=0.45, linewidth=0)
        ax.fill_between(time_axis, 0, shading, where=norm_attr < 0,
                        color=theme.NEGATIVE, alpha=0.4, linewidth=0)
        ax.set_ylabel(name, rotation=0, ha="right", va="center", fontsize=9)
        ax.set_yticks([])
        for spine in ("top", "right"):
            ax.spines[spine].set_visible(False)
    axes[-1].set_xlabel("Time (s)")
    fig.tight_layout()

    try:
        st.pyplot(fig, width="stretch")
    finally:
        # Streamlit reruns this script on every interaction. Each run builds a
        # fresh 12-panel figure, and matplotlib's global registry holds on to
        # every one of them unless it is closed explicitly.
        plt.close(fig)

    st.caption(f"Attribution convergence delta: {delta.item():.4f} (closer to 0 is more reliable).")

st.divider()
st.caption(
    "Cardiac Nexus Lab · [nexus-ai-engine](https://github.com/Cardiac-Nexus-Lab/nexus-ai-engine) · "
    "[nexus-research-docs](https://github.com/Cardiac-Nexus-Lab/nexus-research-docs)"
)
