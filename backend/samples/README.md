# Sample inputs

Held-out test cases that none of the models were trained on, chosen as clear
examples for demonstrating the web app. They are not a measure of accuracy; the
held-out test results in `nexus-ai-engine` are.

| File | Source | Expected result |
| --- | --- | --- |
| `ecg_mi_ptbxl_514.csv` | PTB-XL record 514, test fold 10 | Myocardial infarction, about 95% |
| `ecg_norm_ptbxl_9.csv` | PTB-XL record 9, test fold 10 | Normal ECG, about 96% |
| `ecg_printout_cd_ptbxl_65.png` | PTB-XL record 65, rendered as a 12x1 printout | Conduction disturbance, about 83% |
| `mri_patient106_ed.nii.gz`, `mri_patient106_es.nii.gz` | ACDC test patient 106 (not in this repository) | LV ejection fraction about 9%, dilated cardiomyopathy |

PTB-XL (Wagner et al., *Scientific Data* 2020) is licensed CC BY 4.0.

## MRI samples

ACDC data may not be redistributed, so the MRI files are not committed. After
fetching ACDC in `nexus-ai-engine` (`python -c "from cardiac_nexus import mri_data; mri_data.fetch_acdc()"`
from its `src` directory, or any run of `scripts/train_mri.py`), copy them here:

```bash
cp ../../../nexus-ai-engine/data/acdc/test/patient106/patient106_sax_ed.nii.gz mri_patient106_ed.nii.gz
cp ../../../nexus-ai-engine/data/acdc/test/patient106/patient106_sax_es.nii.gz mri_patient106_es.nii.gz
```

Use height 181 cm and weight 91 kg for this patient to get the diagnosis.
Cite ACDC as Bernard et al., *IEEE Transactions on Medical Imaging* 37(11), 2018.
