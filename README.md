# Cardiac Nexus — web portal

The Cardiac Nexus web application: upload a 12-lead ECG and a cardiac MRI, enter
a short health profile, and get an explainable multimodal analysis with a
downloadable PDF report.

> **Research prototype.** Built as a final-year engineering project at SJC
> Institute of Technology. Not a medical device, not validated for clinical use,
> and never to be used to make decisions about anyone's health.

## What it does

| Input | Model | Output |
| --- | --- | --- |
| **ECG**, 12-lead CSV | xresnet1d18 classifier, calibrated | Probability of five diagnostic findings, Integrated Gradients heatmap |
| **ECG**, photo or scan of a 12x1 printout | Trace digitizer, then the classifier | As above, with image-quality warnings |
| **MRI**, two short-axis NIfTI volumes (end-diastole, end-systole) | 2.5D U-Net segmentation | Heart outline, chamber volumes, ejection fraction, muscle mass |
| **MRI** + height and weight | Logistic regression on heart measurements | Five-way diagnosis with the measurements that drove it |
| **Clinical values** | Guideline ranges (ACC/AHA 2017, NCEP ATP III) | Flags; not a trained model |

Held-out test results for every model, and how they were measured, are in
[nexus-ai-engine](https://github.com/Cardiac-Nexus-Lab/nexus-ai-engine) and
[nexus-research-docs](https://github.com/Cardiac-Nexus-Lab/nexus-research-docs).

**There is no trained fusion model.** No public dataset pairs ECG, MRI and health
records for the same patients. The summary "attention level" combines the three
analyses with explicit, listed thresholds, and the app says so wherever it
appears.

## How it fits together

```mermaid
flowchart LR
  U[Browser] -->|React + Vite, port 5173| F[frontend]
  F -->|/api, proxied| B[backend: FastAPI, port 8000]
  B --> A[cardiac_ai.py]
  A -->|loads models and code| E[(nexus-ai-engine)]
  B --> D[(SQLite or PostgreSQL)]
  B --> P[report_pdf.py: A4 PDF]
  F -->|sign-in| FB[Firebase Authentication]
  B -->|verifies ID tokens| FB
```

```text
nexus-web-portal/
├── frontend/                React single-page app
│   ├── src/main.jsx         landing page, sign-in routing, team page route
│   └── src/components/      Dashboard, AuthPage, ExplodedHeart, FusionCard,
│                            TeamPage, AnalysisResults (results, report, history)
└── backend/                 FastAPI service
    ├── main.py              API, database models, Firebase token verification
    ├── cardiac_ai.py        model inference: ECG, MRI, clinical checks, summary
    ├── report_pdf.py        A4 PDF report with logo, page numbers and notice
    ├── assets/              logos used in the PDF
    ├── samples/             held-out test inputs for trying the app
    └── run.sh               start the backend (macOS / Linux)
```

## Setting it up

Clone both repositories **side by side**. The backend loads the trained models
and the `cardiac_nexus` code from `nexus-ai-engine`:

```text
some-folder/
├── nexus-ai-engine/
└── nexus-web-portal/
```

```bash
git clone https://github.com/Cardiac-Nexus-Lab/nexus-ai-engine.git
git clone https://github.com/Cardiac-Nexus-Lab/nexus-web-portal.git
```

Requirements: **Python 3.11** and **Node.js 20 or later**.

### Backend

macOS / Linux:

```bash
cd nexus-web-portal/backend
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env        # then set FIREBASE_PROJECT_ID
./run.sh
```

Windows (Command Prompt):

```bat
cd nexus-web-portal\backend
py -3.11 -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
.venv\Scripts\python -m uvicorn main:app --port 8000 --reload
```

The copied `.env` uses a local SQLite file, which needs no setup; `run.sh` also
reloads automatically when code changes. To use PostgreSQL instead, set
`DATABASE_URL=postgresql://user:password@localhost:5432/cardiac_nexus`.

### Frontend

```bash
cd nexus-web-portal/frontend
npm install
cp .env.example .env        # then fill in the Firebase web config
npm run dev
```

Open <http://localhost:5173>. The dev server forwards `/api` to the backend on
port 8000.

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_FIREBASE_*` | `frontend/.env` | Firebase web app config, from the Firebase console |
| `FIREBASE_PROJECT_ID` | `backend/.env` | Project whose sign-in tokens the backend accepts |
| `DATABASE_URL` | `backend/.env` or shell | SQLite or PostgreSQL connection string |
| `CARDIAC_NEXUS_ENGINE` | `backend/.env` | Optional path to `nexus-ai-engine`; defaults to the folder next to this repository |
| `REPORT_SITE_URL` | `backend/.env` | Optional; printed in the PDF header once the site is online |

`.env` files hold credentials and are never committed.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service check |
| `POST` | `/api/auth/sync` | Verify a Firebase ID token and create or update the user |
| `GET` | `/api/auth/me` | Current user |
| `PUT` | `/api/auth/profile` | Update name, role and institution |
| `POST` | `/api/analyze` | Run the models on uploaded ECG and MRI files and the health profile |
| `GET` | `/api/analyses` | The signed-in user's past analyses |
| `GET` | `/api/analyses/{id}` | One past analysis in full |
| `POST` | `/api/report.pdf` | Render an analysis result as an A4 PDF |

## Trying it

`backend/samples/` has held-out PTB-XL ECGs and instructions for adding an ACDC
MRI pair (ACDC may not be redistributed). With the MI ECG, the patient 106 MRI
pair and height 181 cm, weight 91 kg, expect myocardial infarction around 95%,
ejection fraction around 9% and dilated cardiomyopathy.

## Input checks

The models have no "this is not an ECG / MRI" answer, so uploads are checked first and
rejected with an explanation:

- **ECG:** leads III, aVR, aVL and aVF must follow from leads I and II (Einthoven's
  law), which holds in every real recording whatever the diagnosis. All 2,158 PTB-XL
  test recordings pass; random numbers, photos and logos do not. Images must also have
  a clearly readable trace, and the 12 leads must not be copies of each other.
- **MRI:** some slice must show a left ventricle of plausible size ringed by
  myocardium. All 100 ACDC test volumes pass; unrelated photos, logos and ECG
  printouts do not. Damaged NIfTI or DICOM files get a clear message.

The thresholds are listed, with the data they came from, at the top of the checks in
`backend/cardiac_ai.py`.

## Known limitations

- The Patients page still shows placeholder rows.
- ECG CSVs are assumed to span 10 seconds; the digitizer works on flat, front-on
  scans of 12x1 printouts, not angled photos.
- MRI diagnosis was trained on 100 patients from one hospital (ACDC) and tested
  on 50; its 95% interval is 79%–96%.
- The summary uses rules, not a trained fusion model.

## Team

Cardiac Nexus, SJC Institute of Technology, Department of CSE.
Project guide: Dr. Shrihari M R. Team: Sahana N S, Samhitha P, Vishnu R, Yashas M.
