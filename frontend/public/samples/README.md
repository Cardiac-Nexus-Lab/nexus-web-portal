# Cardiac Nexus — Sample Inputs & Test Dataset

Held-out test cases from **PTB-XL (test fold 10)** and the **ACDC MICCAI Challenge (held-out test set)** that none of the models were trained on. These samples are designed for demonstrating, validating, and testing the end-to-end multimodal Cardiac Nexus research pipeline.

---

## 1. 12-Lead ECG Digital Signals (CSV)

Standard clinical 12-lead recordings (`I`, `II`, `III`, `aVR`, `aVL`, `aVF`, `V1`, `V2`, `V3`, `V4`, `V5`, `V6`) resampled to 1,000 time steps (10 seconds at 100 Hz):

| File | Source | Diagnostic Class | Patient Demographics | Expected Model Output |
| :--- | :--- | :--- | :--- | :--- |
| **`ecg_norm_ptbxl_9.csv`** | PTB-XL record 9 (test fold 10) | **NORM** | 55yo Female | **Normal ECG** (~96%) |
| **`ecg_norm_ptbxl_93.csv`** | PTB-XL record 93 (test fold 10) | **NORM** | 47yo Male | **Normal ECG** (~98%) |
| **`ecg_mi_ptbxl_514.csv`** | PTB-XL record 514 (test fold 10) | **MI** | 61yo Female | **Myocardial Infarction** (~95%), prominent ST elevation |
| **`ecg_mi_ptbxl_430.csv`** | PTB-XL record 430 (test fold 10) | **MI** | 62yo Male | **Myocardial Infarction** (~71%), anterior leads involvement |
| **`ecg_sttc_ptbxl_318.csv`** | PTB-XL record 318 (test fold 10) | **STTC** | 56yo Male | **ST/T-wave Change** (~91%), inferolateral repolarization |
| **`ecg_sttc_ptbxl_499.csv`** | PTB-XL record 499 (test fold 10) | **STTC** | 60yo Male | **ST/T-wave Change** (~83%), non-specific repolarization |
| **`ecg_cd_ptbxl_65.csv`** | PTB-XL record 65 (test fold 10) | **CD** | 62yo Male | **Conduction Disturbance** (~88%), incomplete RBBB |
| **`ecg_cd_ptbxl_180.csv`** | PTB-XL record 180 (test fold 10) | **CD** | 81yo Female | **Conduction Disturbance** (~95%), high-grade bundle block |
| **`ecg_hyp_ptbxl_7876.csv`** | PTB-XL record 7876 (test fold 10) | **HYP** | 66yo Female | **Hypertrophy / LVH** (~80%), voltage criteria with strain |

---

## 2. 12x1 Scanned ECG Printout Images (PNG)

High-resolution, clinically standard 12x1 ECG paper printouts (25 mm/s, 10 mm/mV, 1 mm pink/red grid, 1 mV calibration pulse, and lead annotations) for testing the automated vision digitizer:

| File | Source Record | Superclass | Description |
| :--- | :--- | :--- | :--- |
| **`ecg_printout_norm_ptbxl_9.png`** | PTB-XL record 9 | **NORM** | Clean baseline normal 12-lead rhythm on standard pink grid |
| **`ecg_printout_mi_ptbxl_514.png`** | PTB-XL record 514 | **MI** | Acute STEMI pattern with elevated ST segments |
| **`ecg_printout_sttc_ptbxl_318.png`** | PTB-XL record 318 | **STTC** | T-wave inversion & ST segment depression printout |
| **`ecg_printout_cd_ptbxl_65.png`** | PTB-XL record 65 | **CD** | RBBB QRS widening pattern printout |

---

## 3. Cardiac MRI Short-Axis Volumes (NIfTI Pair: ED + ES)

Each case contains 3D NIfTI short-axis volumes covering the left ventricle, right ventricle, and myocardium at end-diastole (ED) and end-systole (ES). Both files must be uploaded together for automated ejection fraction calculation and volume-indexed diagnosis:

| Case Files | Source | Height & Weight | Primary Diagnosis | Key Hemodynamic Measurements |
| :--- | :--- | :--- | :--- | :--- |
| **`mri_patient130_ed.nii.gz`**<br>`mri_patient130_es.nii.gz` | ACDC test patient 130 | **185 cm, 95 kg** | **Normal (NOR)** (~97%) | **LV EF: 64.0%**, RV EF: 60.1%, normal chamber volumes |
| **`mri_patient128_ed.nii.gz`**<br>`mri_patient128_es.nii.gz` | ACDC test patient 128 | **170 cm, 74 kg** | **Normal (NOR)** (~94%) | **LV EF: 61.1%**, RV EF: 58.7%, normal myocardial mass |
| **`mri_patient106_ed.nii.gz`**<br>`mri_patient106_es.nii.gz` | ACDC test patient 106 | **181 cm, 91 kg** | **Dilated Cardiomyopathy (DCM)** | **LV EF: ~9%**, severely dilated cavity (LV EDV > 340 mL) |
| **`mri_patient103_ed.nii.gz`**<br>`mri_patient103_es.nii.gz` | ACDC test patient 103 | **175 cm, 107 kg** | **Previous MI (MINF)** (~90%) | **LV EF: 29.6%**, regional systolic wall motion defect |
| **`mri_patient104_ed.nii.gz`**<br>`mri_patient104_es.nii.gz` | ACDC test patient 104 | **180 cm, 74 kg** | **Hypertrophic Cardiomyopathy (HCM)** (~99%) | **LV EF: 79.4%**, hyperdynamic, severe septal thickening |
| **`mri_patient109_ed.nii.gz`**<br>`mri_patient109_es.nii.gz` | ACDC test patient 109 | **180 cm, 60 kg** | **Abnormal RV (RV)** (~99%) | **RV EF: 31.1%**, dilated right ventricular cavity |

---

## 4. Multimodal Patient Profiles & Clinical EHR Scenarios

Pre-configured clinical test scenarios linking EHR risk factors, ECG findings, and MRI measurements:

- **`sample_patient_profiles.json`**: Complete structured JSON profiles matching clinical guidelines.
- **`clinical_test_profiles.csv`**: Tabular dataset with quick-entry values.

### Recommended Multimodal Test Combinations:

1. **Scenario 1: Healthy Control / Low Risk**
   - **Patient**: Sarah Miller, 47yo Female (BP: 118, Chol: 178, Max HR: 164, Angina: None, H: 170cm, W: 64kg)
   - **ECG**: `ecg_norm_ptbxl_93.csv` (or `ecg_printout_norm_ptbxl_9.png`)
   - **MRI**: `mri_patient128_ed.nii.gz` + `mri_patient128_es.nii.gz`
   - **Result**: Low cardiovascular risk, normal LV/RV function, clean ECG.

2. **Scenario 2: Acute Coronary Syndrome / Prior STEMI (High Risk)**
   - **Patient**: Robert Jenkins, 62yo Male (BP: 168, Chol: 265, Max HR: 138, Angina: Typical, H: 175cm, W: 88kg)
   - **ECG**: `ecg_mi_ptbxl_514.csv` (or `ecg_printout_mi_ptbxl_514.png`)
   - **MRI**: `mri_patient103_ed.nii.gz` + `mri_patient103_es.nii.gz`
   - **Result**: High risk, MI detected on ECG, prior infarct with reduced ejection fraction (29.6%) on MRI.

3. **Scenario 3: Severe Ischemic Dilated Cardiomyopathy / Heart Failure**
   - **Patient**: David Wallace, 58yo Male (BP: 135, Chol: 210, Max HR: 115, Angina: Yes, H: 181cm, W: 91kg)
   - **ECG**: `ecg_cd_ptbxl_65.csv` (or `ecg_printout_cd_ptbxl_65.png`)
   - **MRI**: `mri_patient106_ed.nii.gz` + `mri_patient106_es.nii.gz`
   - **Result**: High risk, intraventricular delay (CD), critical LV EF (< 10%).

4. **Scenario 4: Hypertrophic Cardiomyopathy (HCM)**
   - **Patient**: Alexander Hayes, 42yo Male (BP: 142, Chol: 195, Max HR: 172, Angina: Atypical, H: 180cm, W: 74kg)
   - **ECG**: `ecg_hyp_ptbxl_7876.csv`
   - **MRI**: `mri_patient104_ed.nii.gz` + `mri_patient104_es.nii.gz`
   - **Result**: Severe hypertrophy (HYP) on ECG, HCM with hyperdynamic EF (79.4%) on MRI.

5. **Scenario 5: Right Ventricular Strain / Cor Pulmonale**
   - **Patient**: Elena Rostova, 52yo Female (BP: 128, Chol: 185, Max HR: 130, Angina: No, H: 180cm, W: 60kg)
   - **ECG**: `ecg_sttc_ptbxl_318.csv` (or `ecg_printout_sttc_ptbxl_318.png`)
   - **MRI**: `mri_patient109_ed.nii.gz` + `mri_patient109_es.nii.gz`
   - **Result**: STTC repolarization strain on ECG, depressed RV ejection fraction (31.1%) and RV dilation on MRI.

---

## Citations & Licensing

- **PTB-XL**: Wagner et al., *Scientific Data* 7, 154 (2020). PhysioNet open dataset under Creative Commons Attribution 4.0 International (CC BY 4.0).
- **ACDC Challenge**: Bernard et al., *IEEE Transactions on Medical Imaging* 37(11): 2514-2525 (2018). MICCAI challenge dataset.
