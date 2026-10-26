# Cardiac Nexus — Dataset & Evaluation Defense Guide

*A complete reference guide for project evaluations, viva examinations, and research presentations.*

---

## 1. Quick Answer Table for Reviewers

When asked: *"Where is your raw data, where is the cleaned data, where are the train/test splits, and where are the test results?"*

| Stage | Modality | Exact Workspace Path | Key Facts to State |
| :--- | :--- | :--- | :--- |
| **Raw Data** | **ECG** | [`data/ecg/raw/ptb-xl-a-large-publicly-available-electrocardiography-dataset-1.0.3/`](file:///d:/MainProject/MajorProject/data/ecg/raw/ptb-xl-a-large-publicly-available-electrocardiography-dataset-1.0.3/) | 21,799 raw clinical 12-lead ECG records from PhysioNet. |
| | **MRI** | [`data/mri/raw/ACDC/database/`](file:///d:/MainProject/MajorProject/data/mri/raw/ACDC/database/) | 150 patients (100 training, 50 held-out testing) from the MICCAI ACDC Challenge. |
| | **EHR** | [`data/ehr/raw/`](file:///d:/MainProject/MajorProject/data/ehr/raw/) | Framingham, CardioTrain, and UCI Heart Disease clinical databases. |
| **Cleaned & Processed** | **ECG** | [`nexus-ai-engine/src/cardiac_nexus/data.py`](file:///d:/MainProject/MajorProject/nexus-ai-engine/src/cardiac_nexus/data.py) | Signals standardized to 10s at 100 Hz (1,000 samples × 12 leads), per-lead z-score normalization, Einthoven consistency check, 71 SCP diagnostic codes aggregated into 5 superclasses (`NORM`, `MI`, `STTC`, `CD`, `HYP`). |
| | **MRI** | [`nexus-ai-engine/scratch_train_features.csv`](file:///d:/MainProject/MajorProject/nexus-ai-engine/scratch_train_features.csv)<br>[`nexus-ai-engine/scratch_test_features.csv`](file:///d:/MainProject/MajorProject/nexus-ai-engine/scratch_test_features.csv) | In-plane isotropic resampling (1.0 mm), 216×216 central crop/padding, isolated end-diastole (ED) and end-systole (ES) masks, indexed to Body Surface Area (BSA). |
| **Train / Test Splits** | **ECG** | `strat_fold` column in [`ptbxl_database.csv`](file:///d:/MainProject/MajorProject/data/ecg/raw/ptb-xl-a-large-publicly-available-electrocardiography-dataset-1.0.3/ptbxl_database.csv) | **Folds 1–8**: Training (17,441 records)<br>**Fold 9**: Validation & Vector-scaling calibration (2,183 records)<br>**Fold 10**: Strictly held-out test split (2,198 records). |
| | **MRI** | [`data/mri/acdc_train_patients.csv`](file:///d:/MainProject/MajorProject/data/mri/acdc_train_patients.csv)<br>[`data/mri/acdc_test_patients.csv`](file:///d:/MainProject/MajorProject/data/mri/acdc_test_patients.csv) | **Training**: `patient001`–`patient100` (100 patients)<br>**Held-Out Testing**: `patient101`–`patient150` (50 unseen patients). |
| **Trained Models** | **ECG** | [`nexus-ai-engine/results/local_xresnet18_full/ecg_multilabel.pt`](file:///d:/MainProject/MajorProject/nexus-ai-engine/results/local_xresnet18_full/ecg_multilabel.pt) | Deep 1D XResNet-18 neural network with temperature-scaled vector calibration. |
| | **MRI** | [`nexus-ai-engine/results/mri_segmentation/mri_segmenter.pt`](file:///d:/MainProject/MajorProject/nexus-ai-engine/results/mri_segmentation/mri_segmenter.pt)<br>[`nexus-ai-engine/results/mri_diagnosis/diagnosis_model.joblib`](file:///d:/MainProject/MajorProject/nexus-ai-engine/results/mri_diagnosis/diagnosis_model.joblib) | Multi-structure anatomical CNN segmenter (LV, RV, Myocardium) & physiological measurement classifier. |
| **Test Results & Reports** | **ECG** | [`nexus-ai-engine/results/local_xresnet18_full/evaluation_report.json`](file:///d:/MainProject/MajorProject/nexus-ai-engine/results/local_xresnet18_full/evaluation_report.json) | Tested on 2,198 unseen test records: **Macro AUROC: 0.911**, **Expected Calibration Error (ECE): 0.015**. |
| | **MRI** | [`nexus-ai-engine/results/mri_segmentation/test_evaluation.json`](file:///d:/MainProject/MajorProject/nexus-ai-engine/results/mri_segmentation/test_evaluation.json)<br>[`nexus-ai-engine/results/mri_diagnosis/diagnosis_report.json`](file:///d:/MainProject/MajorProject/nexus-ai-engine/results/mri_diagnosis/diagnosis_report.json) | Tested on 50 unseen test patients: **LV Dice: 0.956**, **EF Pearson $r = 0.991$**, **Diagnosis Accuracy: 96.0% (48/50)**. |
| **Live Showcase Samples** | **All** | [`nexus-web-portal/backend/samples/`](file:///d:/MainProject/MajorProject/nexus-web-portal/backend/samples/) | Curated held-out test records (9 ECG signals, 4 printouts, 6 MRI pairs, 5 clinical profiles). |

---

## 2. Question-by-Question Viva Defense Script

### Q1: *"Where is the raw dataset located, and why did you choose it?"*
> **Answer**:
> *"All raw datasets are located under [`data/`](file:///d:/MainProject/MajorProject/data/).*
> * *For **ECG**, we selected the **PhysioNet PTB-XL** benchmark in [`data/ecg/raw/`](file:///d:/MainProject/MajorProject/data/ecg/raw/), containing 21,799 clinical 12-lead recordings annotated by cardiologist consensus.*
> * *For **Cardiac MRI**, we used the **ACDC dataset** in [`data/mri/raw/ACDC/`](file:///d:/MainProject/MajorProject/data/mri/raw/ACDC/), consisting of 150 cine-MRI exams spanning 5 clinical pathologies (Normal, Infarction, DCM, HCM, and RV abnormalities).*
> * *For **Tabular Health Records**, we integrated **Framingham, CardioTrain, and UCI** in [`data/ehr/raw/`](file:///d:/MainProject/MajorProject/data/ehr/raw/) to model epidemiological risk factors."*

---

### Q2: *"How did you clean, normalize, and preprocess the data?"*
> **Answer**:
> *"Our preprocessing pipelines are implemented in [`nexus-ai-engine/src/cardiac_nexus/`](file:///d:/MainProject/MajorProject/nexus-ai-engine/src/cardiac_nexus/).*
> * *In [`data.py`](file:///d:/MainProject/MajorProject/nexus-ai-engine/src/cardiac_nexus/data.py), each raw ECG is resampled to 100 Hz, standardized to 1,000 samples (10 seconds), and lead-normalized using z-scores ($(\mu=0, \sigma=1)$). We also run Einthoven consistency checks on limb leads.*
> * *In [`mri_data.py`](file:///d:/MainProject/MajorProject/nexus-ai-engine/src/cardiac_nexus/mri_data.py), MRI volumes are resampled to isotropic 1.0 mm in-plane resolution and standardized to 216×216 central frames. End-diastole and end-systole frames are segmented to calculate hemodynamic parameters (LVEDV, LVESV, EF, and Myocardial Mass) indexed to Body Surface Area (BSA).*
> * *Processed feature matrices used for cross-validation and benchmarking are preserved in [`scratch_train_features.csv`](file:///d:/MainProject/MajorProject/nexus-ai-engine/scratch_train_features.csv) and [`scratch_test_features.csv`](file:///d:/MainProject/MajorProject/nexus-ai-engine/scratch_test_features.csv)."*

---

### Q3: *"How did you split the data to ensure zero data leakage?"*
> **Answer**:
> *"We strictly adhered to the benchmark separation standards:*
> * *In PTB-XL, we respected the official stratified 10-fold split (`strat_fold`). We trained only on **folds 1–8**, used **fold 9** for validation and vector-scaling temperature calibration, and completely held out **fold 10 (2,198 recordings)** for final testing.*
> * *In ACDC, the official training split (`patient001`–`patient100`) was used for 5-fold cross-validation, while the official test partition (`patient101`–`patient150`) in [`testing/`](file:///d:/MainProject/MajorProject/data/mri/raw/ACDC/database/testing/) remained untouched until the final evaluation."*

---

### Q4: *"Where are the trained model weights saved?"*
> **Answer**:
> *"Trained model weights and state dictionaries are stored inside [`nexus-ai-engine/results/`](file:///d:/MainProject/MajorProject/nexus-ai-engine/results/):*
> * *ECG 1D XResNet-18: [`local_xresnet18_full/ecg_multilabel.pt`](file:///d:/MainProject/MajorProject/nexus-ai-engine/results/local_xresnet18_full/ecg_multilabel.pt)*
> * *Cardiac MRI Segmenter: [`mri_segmentation/mri_segmenter.pt`](file:///d:/MainProject/MajorProject/nexus-ai-engine/results/mri_segmentation/mri_segmenter.pt)*
> * *Physiological Diagnosis Model: [`mri_diagnosis/diagnosis_model.joblib`](file:///d:/MainProject/MajorProject/nexus-ai-engine/results/mri_diagnosis/diagnosis_model.joblib)*
> * *ECG Printout Trace Localizer: [`digitizer/trace_localizer.pt`](file:///d:/MainProject/MajorProject/nexus-ai-engine/results/digitizer/trace_localizer.pt)"*

---

### Q5: *"What are your held-out test results and clinical metrics?"*
> **Answer**:
> *"The complete evaluation reports are serialized in JSON:*
> * *In [`evaluation_report.json`](file:///d:/MainProject/MajorProject/nexus-ai-engine/results/local_xresnet18_full/evaluation_report.json), our 1D XResNet achieved **0.911 Macro AUROC** on 2,198 unseen recordings with an Expected Calibration Error (ECE) of **0.015**.*
> * *In [`test_evaluation.json`](file:///d:/MainProject/MajorProject/nexus-ai-engine/results/mri_segmentation/test_evaluation.json), our anatomical segmenter achieved a Left Ventricle **Dice score of 0.956** and an **EF correlation of $r = 0.991$** against expert annotations.*
> * *In [`diagnosis_report.json`](file:///d:/MainProject/MajorProject/nexus-ai-engine/results/mri_diagnosis/diagnosis_report.json), the physiological measurement classifier achieved **96.0% accuracy (48/50 patients correct)** across all 5 clinical categories."*

---

## 3. Live 15-Second Terminal Proof

To run a live demonstration verifying all held-out test files, models, and predictions across ECG, MRI, and EHR:

```powershell
& "nexus-web-portal\backend\.venv\Scripts\python.exe" "C:\Users\sahan\.gemini\antigravity-ide\brain\93ffcacd-71a4-4bf1-9d26-edf8cf6957e7\scratch\validate_all_samples.py"
```

This script:
1. Loads all 9 held-out test ECG CSVs and evaluates them against the trained neural network.
2. Runs the trace localizer and digitizer on the 4 scanned ECG printout images.
3. Segments the MRI volume pairs and computes ejection fraction and indexed chamber volumes.
4. Generates late-fusion risk predictions and clinical summaries for all 5 multimodal patient profiles.
