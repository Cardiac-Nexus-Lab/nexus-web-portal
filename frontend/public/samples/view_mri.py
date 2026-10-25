import nibabel as nib
import matplotlib.pyplot as plt

img = nib.load("mri_patient106_ed.nii.gz")
data = img.get_fdata()

plt.imshow(data[:, :, data.shape[2] // 2], cmap="gray")
plt.show()