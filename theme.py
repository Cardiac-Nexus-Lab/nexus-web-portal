"""Presentation layer for the Cardiac Nexus portal.

Separated from app.py so that file reads as pipeline logic -- load, predict,
explain -- instead of being buried under a few hundred lines of CSS. Nothing
here knows about the model; nothing in app.py writes raw HTML.
"""

import streamlit as st

# One accent, used by both the injected CSS and the matplotlib attribution
# overlay. .streamlit/config.toml is kept in sync with this so Streamlit's own
# widgets (radio, uploader, spinner) don't render in a different color.
ACCENT = "#FF4C3B"
NEGATIVE = "#1f6fd1"  # attribution pushing away from the positive class
INK = "#0b0b0c"
MUTED = "#4b4b52"

_CSS = f"""
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
    background: {INK};
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
    color: {MUTED};
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
    border: 2px solid {INK};
    padding: 1.5rem 1.75rem;
    margin: 1.25rem 0;
}}
.result-value {{
    font-size: 2.4rem;
    font-weight: 800;
    letter-spacing: -0.02em;
}}
.result-label {{
    color: {MUTED};
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}}
div.stButton > button {{
    border-radius: 10px;
    border: 2px solid {INK};
    font-weight: 700;
}}
div.stButton > button:hover {{
    border-color: {ACCENT};
    color: {ACCENT};
}}

/* Scroll-triggered reveal: elements start slightly lower and transparent,
   then settle into place as they enter the viewport. */
/* Default is fully visible, so a browser without scroll-driven animation
   support (Firefox, currently) simply shows the page. The previous
   JavaScript version failed the other way: if the observer never ran, every
   section stayed at opacity 0 and the page looked blank. */
.reveal {{ opacity: 1; }}

@supports (animation-timeline: view()) {{
    .reveal {{
        opacity: 0;
        transform: translateY(28px);
        animation: reveal-in linear forwards;
        animation-timeline: view();
        animation-range: entry 0% cover 28%;
        will-change: opacity, transform;
    }}
    @keyframes reveal-in {{
        to {{ opacity: 1; transform: translateY(0); }}
    }}
}}

@media (prefers-reduced-motion: reduce) {{
    .reveal {{ opacity: 1; transform: none; animation: none; }}
}}

.section-num {{
    font-weight: 800;
    font-size: 1.6rem;
    letter-spacing: -0.01em;
    margin: 0.4rem 0 0.6rem;
}}
.statement {{
    font-weight: 800;
    font-size: clamp(1.9rem, 5.5vw, 2.7rem);
    line-height: 1.18;
    letter-spacing: -0.02em;
    color: {INK};
    margin: 2.5rem 0 2rem;
}}
.stat-section {{
    background: {INK};
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
"""

_BRAND_BAR = f"""
<div class="brand-bar">
    <span class="brand-mark">&#129728;</span>
    <span class="brand-name">cardiac nexus</span>
</div>
"""

def inject() -> None:
    """Install the stylesheet and brand bar.

    The scroll reveal used to need a JavaScript IntersectionObserver smuggled in
    through a components.v1.html iframe, because a <script> injected via
    st.markdown never executes. CSS `animation-timeline: view()` expresses the
    same effect declaratively, so the iframe, the observer, and a now-deprecated
    Streamlit API all go away.
    """
    st.markdown(_CSS + _BRAND_BAR, unsafe_allow_html=True)


def block(html: str) -> None:
    """Render a revealing block of markup."""
    st.markdown(html, unsafe_allow_html=True)


def stat_band(stats: list[tuple[str, str]]) -> None:
    """Full-bleed dark band of headline figures.

    `stats` is a list of (value, caption) pairs. Callers pass values derived
    from the checkpoint rather than literals, so the band cannot drift out of
    step with the model actually being served.
    """
    cells = "".join(
        f'<div><div class="stat-number">{value}</div>'
        f'<div class="stat-caption">{caption}</div></div>'
        for value, caption in stats
    )
    block(f'<div class="stat-section reveal"><div class="stat-grid">{cells}</div></div>')


def result_card(label: str, value: str, value_size: str | None = None) -> None:
    """A bordered card showing one prediction figure."""
    style = f' style="font-size:{value_size};"' if value_size else ""
    block(
        f'<div class="result-card reveal">'
        f'<div class="result-label">{label}</div>'
        f'<div class="result-value"{style}>{value}</div>'
        f"</div>"
    )
