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

from model import LEAD_NAMES, ProbabilityWrapper, load_model
from preprocess import SignalShapeError, load_ecg_csv, synthetic_demo_signal

st.set_page_config(
    page_title="Cardiac Nexus",
    page_icon="🫀",
    layout="centered",
)

# --- Bold, high-contrast brand styling: dark header bar, chunky rounded-sans
# headline treatment, one confident accent color, generous whitespace. ---
ACCENT = "#FF4C3B"

st.markdown(
    f"""
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap');

    html, body, [class*="css"] {{
        font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont,
                     "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }}
    .block-container {{
        max-width: 780px;
        padding-top: 0 !important;
        padding-bottom: 4rem;
    }}
    #MainMenu, header[data-testid="stHeader"] {{
        background: transparent;
    }}

    .brand-bar {{
        background: #0b0b0c;
        margin: 0 calc(-50vw + 50%) 2.5rem;
        padding: 1.1rem 1.5rem;
        display: flex;
        align-items: center;
        gap: 0.6rem;
    }}
    .brand-mark {{
        width: 28px; height: 28px; border-radius: 8px;
        background: {ACCENT};
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 1rem;
    }}
    .brand-name {{
        color: #ffffff;
        font-weight: 800;
        font-size: 1.15rem;
        letter-spacing: -0.01em;
    }}

    .hero-line {{
        display: inline-block;
        background: {ACCENT};
        color: #ffffff;
        font-weight: 800;
        font-size: clamp(2.1rem, 6vw, 3rem);
        line-height: 1.15;
        letter-spacing: -0.02em;
        padding: 0.05em 0.28em;
        border-radius: 10px;
        margin-bottom: 0.3rem;
    }}
    .hero-wrap {{ margin-bottom: 0.75rem; }}
    .subtitle {{
        color: #4b4b52;
        font-size: 1.05rem;
        font-weight: 500;
        margin-bottom: 2rem;
    }}
    h2, h3 {{
        font-weight: 800 !important;
        letter-spacing: -0.01em;
    }}
    .disclaimer {{
        border-radius: 14px;
        background: #fff3f1;
        border: 2px solid {ACCENT}33;
        padding: 1rem 1.2rem;
        font-size: 0.92rem;
        line-height: 1.5;
        margin-bottom: 1.75rem;
    }}
    .result-card {{
        border-radius: 16px;
        background: #ffffff;
        border: 2px solid #0b0b0c;
        padding: 1.5rem 1.75rem;
        margin: 1.25rem 0;
    }}
    .result-value {{
        font-size: 2.4rem;
        font-weight: 800;
        letter-spacing: -0.02em;
    }}
    .result-label {{
        color: #4b4b52;
        font-size: 0.8rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
    }}
    div.stButton > button {{
        border-radius: 10px;
        border: 2px solid #0b0b0c;
        font-weight: 700;
    }}
    div.stButton > button:hover {{
        border-color: {ACCENT};
        color: {ACCENT};
    }}

    /* Scroll-triggered reveal, in the spirit of eurekalabs.io's fade/slide-up
       sections: elements start slightly lower and transparent, then settle
       into place as they enter the viewport. */
    .reveal {{
        opacity: 0;
        transform: translateY(28px);
        transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1),
                    transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
        will-change: opacity, transform;
    }}
    .reveal.visible {{
        opacity: 1;
        transform: translateY(0);
    }}
    .section-num {{
        font-weight: 800;
        font-size: 1.6rem;
        letter-spacing: -0.01em;
        margin: 0.4rem 0 0.6rem;
    }}

    /* Big bold black statement, like the "Senior nearshore talent..." block. */
    .statement {{
        font-weight: 800;
        font-size: clamp(1.9rem, 5.5vw, 2.7rem);
        line-height: 1.18;
        letter-spacing: -0.02em;
        color: #0b0b0c;
        margin: 2.5rem 0 2rem;
    }}

    /* Full-bleed dark stat section, like the "86 NPS" block. */
    .stat-section {{
        background: #0b0b0c;
        margin: 2.5rem calc(-50vw + 50%) 2.5rem;
        padding: 3rem 1.5rem;
    }}
    .stat-grid {{
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 1.5rem;
        max-width: 780px;
        margin: 0 auto;
    }}
    .stat-number {{
        color: {ACCENT};
        font-weight: 800;
        font-size: clamp(2.2rem, 7vw, 3.2rem);
        letter-spacing: -0.02em;
        line-height: 1;
    }}
    .stat-caption {{
        color: #c9c9cf;
        font-size: 0.85rem;
        font-weight: 600;
        margin-top: 0.4rem;
    }}

    /* Quote cards, like the floating testimonial callouts. */
    .quote-card {{
        background: #f5f5f7;
        border-radius: 16px;
        padding: 1.4rem 1.6rem;
        font-size: 0.98rem;
        line-height: 1.5;
        color: #1d1d1f;
        margin-bottom: 1rem;
    }}
    .quote-card strong {{ color: {ACCENT}; }}
    </style>

    <div class="brand-bar">
        <span class="brand-mark">🫀</span>
        <span class="brand-name">cardiac nexus</span>
    </div>
    """,
    unsafe_allow_html=True,
)

# A <script> tag injected via st.markdown's innerHTML never executes (browsers
# don't run scripts inserted that way) -- components.v1.html renders into a
# same-origin iframe, so it can reach into window.parent.document instead.
st.components.v1.html(
    """
    <script>
    (function() {
        function attach() {
            const doc = window.parent ? window.parent.document : document;
            const els = doc.querySelectorAll('.reveal:not([data-observed])');
            if (!els.length) return;
            const io = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('visible');
                        io.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.12 });
            els.forEach((el) => {
                el.setAttribute('data-observed', '1');
                io.observe(el);
            });
        }
        attach();
        setInterval(attach, 400);
    })();
    </script>
    """,
    height=0,
)

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

st.markdown(
    """
    <div class="stat-section reveal">
        <div class="stat-grid">
            <div>
                <div class="stat-number">0.92</div>
                <div class="stat-caption">TEST AUROC</div>
            </div>
            <div>
                <div class="stat-number">86%</div>
                <div class="stat-caption">SENSITIVITY</div>
            </div>
            <div>
                <div class="stat-number">21,801</div>
                <div class="stat-caption">PTB-XL RECORDINGS</div>
            </div>
            <div>
                <div class="stat-number">12</div>
                <div class="stat-caption">ECG LEADS EXPLAINED</div>
            </div>
        </div>
    </div>
    """,
    unsafe_allow_html=True,
)

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

model, checkpoint_metrics = load_model()
prob_model = ProbabilityWrapper(model).eval()
integrated_gradients = IntegratedGradients(prob_model)

with st.expander("About this model"):
    st.write(
        "1D convolutional neural network trained on PTB-XL (12-lead ECG, 100 Hz, "
        "10-second recordings) to detect signs consistent with myocardial infarction (MI)."
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
        "12-lead, 10-second, 100 Hz recording as a CSV — either 1000 rows x 12 columns "
        "(leads I, II, III, aVR, aVL, aVF, V1-V6) or 12 rows x 1000 columns."
    )
    uploaded = st.file_uploader("ECG CSV", type=["csv"], label_visibility="collapsed")
    if uploaded is not None:
        try:
            signal = load_ecg_csv(uploaded)
        except SignalShapeError as exc:
            st.error(str(exc))
else:
    st.caption(
        "A synthetically generated signal shaped like a 12-lead ECG, for exercising the "
        "app end-to-end without real patient data. Not physiologically meaningful."
    )
    if st.button("Generate demo signal"):
        signal = synthetic_demo_signal(seed=np.random.randint(0, 10_000))
        st.session_state["demo_signal"] = signal
    signal = st.session_state.get("demo_signal")

if signal is not None:
    st.markdown('<h2 class="section-num reveal">2. Prediction</h2>', unsafe_allow_html=True)

    input_tensor = torch.tensor(signal, dtype=torch.float32).unsqueeze(0)
    input_tensor.requires_grad_()

    with torch.no_grad():
        probability = torch.sigmoid(model(input_tensor.detach())).item()

    col1, col2 = st.columns(2)
    with col1:
        st.markdown(
            f"""
            <div class="result-card reveal">
                <div class="result-label">Predicted P(MI)</div>
                <div class="result-value">{probability:.0%}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with col2:
        risk_label = "Elevated pattern" if probability >= 0.5 else "Low pattern"
        st.markdown(
            f"""
            <div class="result-card reveal">
                <div class="result-label">Screening signal</div>
                <div class="result-value" style="font-size:1.6rem;">{risk_label}</div>
            </div>
            """,
            unsafe_allow_html=True,
        )

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

    fig, axes = plt.subplots(12, 1, figsize=(9, 13), sharex=True)
    time_axis = np.arange(signal.shape[1]) / 100.0
    max_abs_attr = np.abs(attribution).max() + 1e-8

    for i, name in enumerate(LEAD_NAMES):
        ax = axes[i]
        ax.plot(time_axis, signal[i], color="black", linewidth=0.7)
        norm_attr = attribution[i] / max_abs_attr
        scale = signal[i].std() * 3
        ax.fill_between(time_axis, 0, norm_attr * scale, where=norm_attr >= 0, color=ACCENT, alpha=0.45, linewidth=0)
        ax.fill_between(time_axis, 0, norm_attr * scale, where=norm_attr < 0, color="#1f6fd1", alpha=0.4, linewidth=0)
        ax.set_ylabel(name, rotation=0, ha="right", va="center", fontsize=9)
        ax.set_yticks([])
        for spine in ("top", "right"):
            ax.spines[spine].set_visible(False)
    axes[-1].set_xlabel("Time (s)")
    plt.tight_layout()
    st.pyplot(fig, use_container_width=True)

    st.caption(f"Attribution convergence delta: {delta.item():.4f} (closer to 0 is more reliable).")

st.divider()
st.caption(
    "Cardiac Nexus Lab · [nexus-ai-engine](https://github.com/Cardiac-Nexus-Lab/nexus-ai-engine) · "
    "[nexus-research-docs](https://github.com/Cardiac-Nexus-Lab/nexus-research-docs)"
)
