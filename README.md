# Cardiac Nexus — Web Portal

Streamlit application for the Cardiac Nexus project: upload a 12-lead ECG, get a prediction from the trained deep learning model, and see an Integrated Gradients attribution overlay showing why the model made that call.

This is the demo/interface layer. Model training, evaluation, and research artifacts live in [nexus-ai-engine](https://github.com/Cardiac-Nexus-Lab/nexus-ai-engine); this app fetches the trained checkpoint from that repository at runtime rather than duplicating it here.

> Research tool, not a diagnosis. Trained on the public PTB-XL dataset for research evaluation only. Not a substitute for clinical judgment.

## Running locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

Then open the local URL Streamlit prints (typically `http://localhost:8501`).

## How it works

1. **`model.py`** — defines the same 1D CNN architecture used in `nexus-ai-engine`'s training notebooks, and downloads the trained checkpoint from that repo's `results/checkpoints/` directory on first run (cached locally afterward).
2. **`preprocess.py`** — parses an uploaded ECG CSV into the `[12, 1000]` tensor shape the model expects, with the same per-lead standardization used during training. Also provides a synthetic demo signal so the app can be exercised without real ECG data.
3. **`app.py`** — the Streamlit UI: upload or generate a signal, run inference, run Captum's Integrated Gradients, and render the waveform with a red/blue attribution overlay.

## CSV format

A 12-lead, 10-second, 100 Hz recording as a CSV, either:
- 1000 rows x 12 columns (leads in order: I, II, III, aVR, aVL, aVF, V1–V6), or
- 12 rows x 1000 columns.

## Deployment

This app has no heavy serverless constraints to work around (unlike a Vercel/Next.js split) — it runs as a single Python process and can be deployed directly to [Streamlit Community Cloud](https://streamlit.io/cloud), a small VPS, or a Hugging Face Space.

## Related repositories

- [nexus-ai-engine](https://github.com/Cardiac-Nexus-Lab/nexus-ai-engine) — model training, evaluation, and results
- [nexus-research-docs](https://github.com/Cardiac-Nexus-Lab/nexus-research-docs) — research documentation and planning
