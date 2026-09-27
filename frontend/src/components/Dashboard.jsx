import React, { useState, useEffect } from 'react';
import {
  Activity, ArrowRight, BrainCircuit, CheckCircle2, ClipboardList, FileText, HeartPulse, History, Image, LineChart, Menu, Plus, Settings, ShieldCheck, Sparkles, Upload, UserRound, LogOut, X
} from 'lucide-react';
import { auth } from '../firebase';
import { sendEmailVerification, updateProfile } from 'firebase/auth';
import { ResultsView, ReportView, HistoryView } from './AnalysisResults';

function Badge({ children, tone = 'blue' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Logo() {
  return (
    <div className="logo">
      <span><HeartPulse size={22} /></span>
      <div>
        Cardiac <b>Nexus</b>
        <small>EXPLAINABLE CARDIOVASCULAR AI</small>
      </div>
    </div>
  );
}

function DemoNotice() {
  return null;
}

// The stages the backend actually runs, in order.
const steps = ['Reading the ECG (or digitizing a printout)', 'ECG classifier: five diagnostic findings', 'ECG explanation: Integrated Gradients', 'Segmenting the heart in the MRI', 'Measuring volumes and ejection fraction', 'MRI diagnosis from measurements', 'Checking clinical values against guidelines', 'Combining the results into a summary'];
const defaultPatient = { age: 52, blood_pressure: 140, cholesterol: 220, chest_pain: 'Typical angina', max_heart_rate: 150, exercise_angina: 'Yes' };

export function Dashboard({ user, token, onLogout, onUserUpdate }) {
  const [page, setPage] = useState('Dashboard');
  const [result, setResult] = useState(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const navItems = [
    { name: 'Dashboard', icon: Activity },
    { name: 'New Analysis', icon: Plus },
    { name: 'History', icon: History },
    { name: 'Reports', icon: FileText },
    { name: 'Patients', icon: UserRound },
    { name: 'Technology', icon: BrainCircuit },
    { name: 'Research', icon: ShieldCheck },
    { name: 'Settings', icon: Settings },
  ];


  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <Logo />
        <div className="workspace-label">RESEARCH WORKSPACE</div>
        {navItems.map(({ name, icon: Icon }) => (
          <button
            key={name}
            className={`nav-item ${page === name ? 'active' : ''}`}
            onClick={() => setPage(name)}
          >
            <Icon size={18} />
            <span>{name}</span>
          </button>
        ))}
        <div className="sidebar-bottom">
          <Badge tone="blue">ACTIVE WORKSPACE</Badge>
          <p>Multimodal AI System</p>
        </div>
      </aside>

      {/* Main Workspace */}
      <section className="workspace-main">
        {/* Header */}
        <header className="app-header">
          <button className="mobile-menu"><Menu size={20} /></button>
          <div>
            <b>{page}</b>
            <small>Cardiac Nexus research workspace</small>
          </div>

          <div style={{ position: 'relative' }}>
            <div className="header-profile-box" onClick={() => setShowProfileMenu(!showProfileMenu)} style={{ cursor: 'pointer' }}>
              <span>{user?.name || user?.displayName || 'Active Session'}</span>
              <div className="header-avatar" style={{ overflow: 'hidden', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#176b87', color: '#fff', fontWeight: 700, fontSize: 14 }}>
                {(user?.name || user?.displayName || 'C')[0].toUpperCase()}
              </div>
            </div>

            {showProfileMenu && (
              <div className="modal-content" style={{ position: 'absolute', right: 0, top: 44, width: 260, padding: 16, zIndex: 100, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: '#176b87', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 18, flexShrink: 0 }}>
                    {(user?.name || user?.displayName || 'C')[0].toUpperCase()}
                  </div>
                  <div style={{ overflow: 'hidden' }}>
                    <b style={{ display: 'block', fontSize: 13, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{user?.name || user?.displayName || 'Cardiology Researcher'}</b>
                    <small style={{ color: '#708691', fontSize: 11, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', display: 'block' }}>{user?.email || ''}</small>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 10, marginBottom: 12, fontSize: 12, color: '#708691' }}>
                  <div>Provider: <b style={{ color: '#176b87' }}>{user?.provider === 'google.com' || user?.auth_provider === 'Google Sign-In' || user?.auth_provider === 'google' ? 'Google Sign-In' : 'Email/Password'}</b></div>
                </div>

                <button className="primary small full" onClick={onLogout}>
                  <LogOut size={15} /> Sign Out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Content Views */}
        <div className="content">
          {page === 'Dashboard' && <OverviewPage setPage={setPage} result={result} />}
          {page === 'New Analysis' && <NewAnalysisPage result={result} setResult={setResult} setPage={setPage} token={token} />}
          {page === 'Results' && <ResultsView result={result} setPage={setPage} />}
          {page === 'History' && <HistoryView token={token} setResult={setResult} setPage={setPage} />}
          {page === 'Reports' && <ReportView result={result} />}
          {page === 'Patients' && <PatientsPage />}
          {page === 'Technology' && <TechnologyPage />}
          {page === 'Research' && <ResearchPage />}
          {page === 'Settings' && <SettingsPage user={user} token={token} onLogout={onLogout} onUserUpdate={onUserUpdate} />}
        </div>

      </section>
    </div>
  );
}

// ----------------------------------------------------
// PAGE 1: DASHBOARD OVERVIEW (Image 3)
// ----------------------------------------------------
function OverviewPage({ setPage, result }) {
  const inputs = [
    { icon: UserRound, title: 'Patient details', status: result?.patient_name ? `${result.patient_name} (${result.patient_age}, ${result.patient_gender})` : 'Not Provided' },
    { icon: LineChart, title: 'ECG data', status: result?.ecg_uploaded ? 'Uploaded' : 'Not Uploaded' },
    { icon: Image, title: 'Cardiac MRI', status: result?.mri_uploaded ? 'Uploaded' : 'Not Uploaded' },
  ];

  return (
    <>
      <DemoNotice />
      <div className="page-title">
        <div>
          <div className="eyebrow">OVERVIEW</div>
          <h1>Cardiovascular AI analysis</h1>
          <p>Begin a new multimodal assessment or review prior analyses.</p>
        </div>
        <button className="primary" onClick={() => setPage('New Analysis')}>
          <Plus size={17} /> New analysis
        </button>
      </div>

      <section className="overview-card">
        <div>
          <Badge>WORKFLOW</Badge>
          <h2>Build a unified patient representation.</h2>
          <p>Upload each modality, enter the health profile, and run the analysis.</p>
          <button className="primary" onClick={() => setPage('New Analysis')}>
            Start analysis <ArrowRight size={17} />
          </button>
        </div>
        <div className="overview-visual">
          <BrainCircuit size={48} />
          <b>ECG + MRI + EHR</b>
          <span>→ multimodal fusion → risk insight</span>
        </div>
      </section>

      <div className="input-cards">
        {inputs.map(({ icon: Icon, title, status }) => (
          <article key={title}>
            <Icon size={20} />
            <div>
              <p>{title}</p>
              <b>{status}</b>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

// ----------------------------------------------------
// PAGE 2: NEW ANALYSIS PAGE (Image 4)
// ----------------------------------------------------
function Uploader({ title, subtitle, accept, file, setFile, Icon, multiple = false }) {
  const files = Array.isArray(file) ? file : file ? [file] : [];
  return (
    <div className="upload-card">
      <div className="upload-title">
        <Icon size={20} />
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      <label className={`dropzone ${files.length ? 'has-file' : ''}`}>
        <input type="file" accept={accept} multiple={multiple}
          onChange={e => setFile(multiple ? Array.from(e.target.files || []) : (e.target.files?.[0] || null))} />
        {files.length ? (
          <>
            <CheckCircle2 size={24} />
            <b>{files.map(f => f.name).join(', ')}</b>
            <small>{Math.ceil(files.reduce((n, f) => n + f.size, 0) / 1024)} KB · ready for processing</small>
          </>
        ) : (
          <>
            <Upload size={24} />
            <b>Drag and drop or browse</b>
            <small>File required for deep learning pipeline execution</small>
          </>
        )}
      </label>
    </div>
  );
}

function Processing({ active }) {
  return (
    <div className="processing">
      <div className="eyebrow">ANALYSIS IN PROGRESS</div>
      <h2>Executing Multimodal Deep Learning Pipeline</h2>
      <p>Each stage represents the Cardiac Nexus preprocessing & inference pipeline.</p>
      <div className="process-list">
        {steps.map((step, i) => (
          <div className={i < active ? 'complete' : i === active ? 'running' : ''} key={step}>
            <span>{i < active ? <CheckCircle2 size={19} /> : i === active ? <Sparkles size={18} /> : <i />}</span>
            {step}
            <small>{i < active ? 'Complete' : i === active ? 'Processing…' : 'Waiting'}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewAnalysisPage({ result, setResult, setPage, token }) {
  const [ecg, setEcg] = useState(null);
  const [mri, setMri] = useState([]);
  const [patient, setPatient] = useState({
    name: '',
    age: '',
    gender: 'Male',
    blood_pressure: 130,
    cholesterol: 210,
    chest_pain: 'Typical angina',
    max_heart_rate: 150,
    exercise_angina: 'No',
    height_cm: '',
    weight_kg: ''
  });
  const [active, setActive] = useState(-1);
  const [error, setError] = useState('');

  const update = (key, value) => setPatient({ ...patient, [key]: value });

  const canAnalyze =
    patient.name.trim() !== '' &&
    patient.age !== '' &&
    patient.gender.trim() !== '' &&
    ecg !== null &&
    mri.length > 0 && mri.length <= 2;

  async function analyze() {
    if (!canAnalyze) return;
    setError('');
    setActive(0);
    const started = Date.now();
    let n = 0;
    const timer = setInterval(() => {
      n++;
      setActive(n);
      if (n === steps.length) clearInterval(timer);
    }, 330);

    try {
      const data = new FormData();
      if (ecg) data.append('ecg_file', ecg);
      mri.forEach(file => data.append('mri_file', file));
      // Empty optional fields are left out rather than sent as blanks.
      Object.entries(patient).forEach(([k, v]) => { if (v !== '') data.append(k, v); });

      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: data,
        credentials: 'same-origin',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || 'Analysis backend service unavailable');
      }
      const out = await response.json();
      // Let the stage list finish if the models answered faster than it animates.
      const remaining = Math.max(0, steps.length * 330 + 300 - (Date.now() - started));
      setTimeout(() => {
        clearInterval(timer);
        setResult(out);
        setPage('Results');
      }, remaining);
    } catch (err) {
      clearInterval(timer);
      setTimeout(() => {
        setError(err.message || 'FastAPI service unavailable.');
        setActive(-1);
      }, 600);
    }
  }

  if (active >= 0) return <Processing active={active} />;

  return (
    <>
      <DemoNotice />
      <div className="page-title">
        <div>
          <div className="eyebrow">NEW MULTIMODAL ASSESSMENT</div>
          <h1>Patient analysis</h1>
          <p>Provide patient information and upload medical files to execute the deep learning pipeline.</p>
        </div>
      </div>


      {error && <div className="error">{error}</div>}

      <div className="analysis-grid">
        <Uploader
          title="ECG data (Required)"
          subtitle="12-lead CSV, or a flat photo or scan of a 12x1 ECG printout"
          accept=".csv,.txt,.png,.jpg,.jpeg"
          file={ecg}
          setFile={setEcg}
          Icon={LineChart}
        />
        <Uploader
          title="Cardiac MRI (Required)"
          subtitle="Two short-axis NIfTI volumes (heart full and squeezed) give ejection fraction; one DICOM or image gives an outline"
          accept=".nii,.gz,.dcm,.png,.jpg,.jpeg"
          file={mri}
          setFile={setMri}
          multiple
          Icon={Image}
        />

        <form className="ehr-form" onSubmit={e => { e.preventDefault(); analyze(); }}>
          <div className="upload-title">
            <ClipboardList size={20} />
            <div>
              <h3>Patient health profile</h3>
              <p>Checked against clinical guideline ranges; height and weight enable the MRI diagnosis</p>
            </div>
          </div>
          <div className="form-grid">
            <label>Patient Full Name *
              <input type="text" placeholder="e.g. John Doe" value={patient.name} onChange={e => update('name', e.target.value)} required />
            </label>
            <label>Age *
              <input type="number" placeholder="e.g. 52" value={patient.age} onChange={e => update('age', e.target.value)} required />
            </label>
            <label>Gender *
              <select value={patient.gender} onChange={e => update('gender', e.target.value)}>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <label>Blood pressure (mm Hg)
              <input type="number" value={patient.blood_pressure} onChange={e => update('blood_pressure', e.target.value)} />
            </label>
            <label>Cholesterol (mg/dL)
              <input type="number" value={patient.cholesterol} onChange={e => update('cholesterol', e.target.value)} />
            </label>
            <label>Maximum heart rate
              <input type="number" value={patient.max_heart_rate} onChange={e => update('max_heart_rate', e.target.value)} />
            </label>
            <label>Chest-pain type
              <select value={patient.chest_pain} onChange={e => update('chest_pain', e.target.value)}>
                <option>Typical angina</option>
                <option>Atypical angina</option>
                <option>Non-anginal pain</option>
                <option>Asymptomatic</option>
              </select>
            </label>
            <label>Exercise angina
              <select value={patient.exercise_angina} onChange={e => update('exercise_angina', e.target.value)}>
                <option>Yes</option>
                <option>No</option>
              </select>
            </label>
            <label>Height (cm)
              <input type="number" placeholder="optional" value={patient.height_cm} onChange={e => update('height_cm', e.target.value)} />
            </label>
            <label>Weight (kg)
              <input type="number" placeholder="optional" value={patient.weight_kg} onChange={e => update('weight_kg', e.target.value)} />
            </label>
          </div>
          <button
            className="primary full"
            type="submit"
            disabled={!canAnalyze}
            style={{ opacity: canAnalyze ? 1 : 0.4, cursor: canAnalyze ? 'pointer' : 'not-allowed' }}
          >
            <BrainCircuit size={18} /> {canAnalyze ? 'Start Analysis' : 'Waiting for Required Inputs'} <ArrowRight size={17} />
          </button>
        </form>
      </div>
    </>
  );
}

// ----------------------------------------------------
// PAGE 6: PATIENTS PAGE
// ----------------------------------------------------
function PatientsPage() {
  return (
    <>
      <DemoNotice />
      <div className="page-title">
        <div>
          <div className="eyebrow">PATIENT DIRECTORY</div>
          <h1>Patients</h1>
          <p>Manage and filter evaluated patient records.</p>
        </div>
      </div>
      <section className="recent">
        <table>
          <thead>
            <tr>
              <th>Patient ID</th>
              <th>Name</th>
              <th>Age</th>
              <th>Risk Category</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>#CNX-P01</td><td>Eleanor Vance</td><td>62</td><td><Badge tone="amber">High risk</Badge></td></tr>
            <tr><td>#CNX-P02</td><td>Marcus Sterling</td><td>54</td><td><Badge tone="amber">Moderate risk</Badge></td></tr>
            <tr><td>#CNX-P03</td><td>Sofia Rodriguez</td><td>45</td><td><Badge tone="green">Low risk</Badge></td></tr>
          </tbody>
        </table>
      </section>
    </>
  );
}

// ----------------------------------------------------
// PAGE 7: SETTINGS PAGE
// ----------------------------------------------------
function SettingsPage({ user, token, onLogout, onUserUpdate }) {
  const firebaseUser = auth.currentUser;
  const providerId = firebaseUser?.providerData?.[0]?.providerId || user?.provider || user?.auth_provider || '';
  const isGoogle = providerId === 'google.com' || providerId === 'Google Sign-In' || user?.auth_provider === 'google' || user?.auth_provider === 'Google Sign-In';

  const [showModal, setShowModal] = useState(false);
  const [editName, setEditName] = useState(user?.name || user?.displayName || '');
  const [editRole, setEditRole] = useState(user?.role || 'Not Set');
  const [editInstitution, setEditInstitution] = useState(user?.institution || 'Not Set');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [verificationSuccess, setVerificationSuccess] = useState('');
  const [verificationError, setVerificationError] = useState('');
  const [isEmailVerified, setIsEmailVerified] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const refreshUserVerification = async () => {
      if (auth.currentUser) {
        try {
          await auth.currentUser.reload();
        } catch (e) {
          console.warn('Could not reload Firebase user state:', e);
        }
        if (isMounted && auth.currentUser) {
          setIsEmailVerified(auth.currentUser.emailVerified);
        }
      } else if (user) {
        setIsEmailVerified(Boolean(user.emailVerified));
      }
    };
    refreshUserVerification();
    return () => { isMounted = false; };
  }, [user]);

  const handleSendVerificationEmail = async () => {
    setVerificationSuccess('');
    setVerificationError('');
    setEmailSending(true);

    try {
      if (!auth.currentUser) {
        throw new Error('No active user session found. Please sign in again.');
      }
      await sendEmailVerification(auth.currentUser);
      setVerificationSuccess('Verification email sent successfully! Please check your inbox.');
    } catch (err) {
      console.error('Send verification email error:', err);
      setVerificationError(err.message || 'Failed to send verification email.');
    } finally {
      setEmailSending(false);
    }
  };

  const formatProfileField = (val) => {
    if (!val || val === 'Not Set' || val.trim() === '') {
      return 'Complete Profile';
    }
    return val;
  };

  const roles = [
    'Researcher',
    'Cardiologist',
    'Radiologist',
    'Student',
    'Administrator',
    'Other'
  ];

  const openEditModal = () => {
    setEditName(user?.name || user?.displayName || '');
    setEditRole(user?.role && user?.role !== 'Not Set' ? user.role : 'Researcher');
    setEditInstitution(user?.institution && user?.institution !== 'Not Set' ? user.institution : '');
    setSaveError('');
    setSaveSuccess('');
    setShowModal(true);
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    setSaveSuccess('');

    try {
      const resp = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          name: editName,
          role: editRole,
          institution: editInstitution
        })
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to update profile');
      }

      const updatedUser = await resp.json();

      if (auth.currentUser && editName) {
        try {
          await updateProfile(auth.currentUser, { displayName: editName });
        } catch (e) {
          console.warn('Could not update Firebase displayName:', e);
        }
      }

      if (onUserUpdate) {
        onUserUpdate(updatedUser);
      }
      setSaveSuccess('Profile updated successfully!');
      setTimeout(() => {
        setShowModal(false);
        setSaveSuccess('');
      }, 1000);
    } catch (err) {
      setSaveError(err.message || 'Failed to save profile changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DemoNotice />
      <div className="page-title">
        <div>
          <div className="eyebrow">WORKSPACE SETTINGS</div>
          <h1>Settings</h1>
          <p>Manage researcher credentials, preferences, and session controls.</p>
        </div>
      </div>

      <div className="upload-card" style={{ maxWidth: 580 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#176b87', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 26, fontWeight: 700, flexShrink: 0 }}>
            {(user?.name || user?.displayName || 'U')[0].toUpperCase()}
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 18 }}>{user?.name || user?.displayName || 'User'}</h3>
            <p style={{ fontSize: 13, color: '#708691', margin: '2px 0 0' }}>{user?.email || 'N/A'}</p>
          </div>
        </div>

        <div style={{ background: 'rgba(0,0,0,0.03)', padding: 16, borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
          <div style={{ marginBottom: 10 }}>
            <span style={{ color: '#708691' }}>Full Name: </span>
            <b>{user?.name || user?.displayName || 'User'}</b>
          </div>
          <div style={{ marginBottom: 10 }}>
            <span style={{ color: '#708691' }}>Email Address: </span>
            <b>{user?.email || 'N/A'}</b>
          </div>
          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: '#708691' }}>Email Verification: </span>
            {isGoogle ? (
              <span style={{ color: '#2e7d32', fontWeight: 600 }}>Google Account (Verified by Google) ✅</span>
            ) : isEmailVerified ? (
              <span style={{ color: '#2e7d32', fontWeight: 600 }}>Verified ✅</span>
            ) : (
              <>
                <span style={{ color: '#ed6c02', fontWeight: 600 }}>Not Verified ⚠️</span>
                <button
                  type="button"
                  className="secondary"
                  onClick={handleSendVerificationEmail}
                  disabled={emailSending}
                  style={{ fontSize: 11, padding: '3px 10px', marginLeft: 4, cursor: 'pointer' }}
                >
                  {emailSending ? 'Sending...' : 'Send Verification Email'}
                </button>
              </>
            )}
          </div>
          {verificationSuccess && (
            <div style={{ color: '#2e7d32', fontSize: 12, marginBottom: 10, fontWeight: 500 }}>
              {verificationSuccess}
            </div>
          )}
          {verificationError && (
            <div style={{ color: '#c62828', fontSize: 12, marginBottom: 10, fontWeight: 500 }}>
              {verificationError}
            </div>
          )}
          <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#708691' }}>Authentication Provider: </span>
            <Badge tone={isGoogle ? 'blue' : 'green'}>
              {isGoogle ? 'Google Sign-In' : 'Email/Password'}
            </Badge>
          </div>
          <div style={{ marginBottom: 10 }}>
            <span style={{ color: '#708691' }}>Role: </span>
            <b style={{ color: !user?.role || user?.role === 'Not Set' || user?.role === 'Complete Profile' ? '#c62828' : 'inherit' }}>
              {formatProfileField(user?.role)}
            </b>
          </div>
          <div>
            <span style={{ color: '#708691' }}>Institute: </span>
            <b style={{ color: !user?.institution || user?.institution === 'Not Set' || user?.institution === 'Complete Profile' ? '#c62828' : 'inherit' }}>
              {formatProfileField(user?.institution)}
            </b>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button className="primary" onClick={openEditModal}>
            Edit Profile
          </button>
          <button className="secondary" onClick={onLogout}>
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, padding: 24 }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Edit Profile Details</h3>
              <button className="close-btn" style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>
            {saveSuccess ? (
              <p style={{ color: '#2e7d32', fontSize: 14, margin: '14px 0', fontWeight: 600 }}>{saveSuccess}</p>
            ) : (
              <form onSubmit={handleSaveProfile}>
                {saveError && <div className="error" style={{ marginBottom: 12 }}>{saveError}</div>}
                
                <div className="auth-form-field" style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Full Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Dr. Sarah Jenkins"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    required
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.18)', fontSize: 14 }}
                  />
                </div>

                <div className="auth-form-field" style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Role</label>
                  <select
                    value={editRole}
                    onChange={e => setEditRole(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.18)', background: '#fff', fontSize: 14 }}
                  >
                    <option value="Not Set">Not Set</option>
                    {roles.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>

                <div className="auth-form-field" style={{ marginBottom: 24 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Institute / Institution</label>
                  <input
                    type="text"
                    placeholder="e.g. Nexus Heart Institute"
                    value={editInstitution}
                    onChange={e => setEditInstitution(e.target.value)}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.18)', fontSize: 14 }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button type="button" className="secondary" onClick={() => setShowModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="primary" disabled={saving}>
                    {saving ? 'Saving...' : 'Save Profile'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ----------------------------------------------------
// PAGE 8: TECHNOLOGY PAGE
// ----------------------------------------------------
function TechnologyPage() {
  const cards = [
    { Icon: LineChart, title: 'ECG classifier: xresnet1d18 (1D ResNet-18)', sub: '12-lead ECG, 10 seconds at 100 Hz.',
      body: 'A one-dimensional residual CNN trained on PTB-XL gives the probability of five findings: normal, myocardial infarction, ST/T change, conduction disturbance and hypertrophy. Probabilities are calibrated so that 90% means about 90%.' },
    { Icon: Activity, title: 'ECG digitizer: CNN trace localizer', sub: 'Flat scans of 12x1 paper printouts.',
      body: 'Finds the page, cuts out the twelve lead strips and traces the line in each strip column by column, turning the drawing back into a signal the classifier can read.' },
    { Icon: Image, title: 'MRI segmenter: 2.5D U-Net', sub: 'Short-axis cine MRI, end-diastole and end-systole.',
      body: 'Each slice goes in with its two neighbours and comes out outlined into left ventricle, right ventricle and heart muscle. The outlines give chamber volumes, ejection fraction and muscle mass.' },
    { Icon: ClipboardList, title: 'MRI diagnosis and health checks', sub: 'Measurements and guideline rules.',
      body: 'A logistic regression on the heart measurements, with height and weight, suggests one of five conditions. Blood pressure and cholesterol are checked against ACC/AHA 2017 and NCEP ATP III; these are rules, not a trained model.' },
  ];
  return (
    <>
      <DemoNotice />
      <div className="page-title">
        <div>
          <div className="eyebrow">SYSTEM ARCHITECTURE</div>
          <h1>How Cardiac Nexus works</h1>
          <p>The models behind each analysis, how they are explained, and how the results are combined.</p>
        </div>
      </div>

      <div className="analysis-grid">
        {cards.map(({ Icon, title, sub, body }) => (
          <div className="upload-card" key={title}>
            <div className="upload-title">
              <Icon size={22} />
              <div>
                <h3>{title}</h3>
                <p>{sub}</p>
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#637b86', marginTop: 12 }}>{body}</p>
          </div>
        ))}
      </div>

      <section className="architecture" style={{ marginTop: 24, borderRadius: 14 }}>
        <div>
          <div className="eyebrow">EXPLANATIONS AND SUMMARY</div>
          <h2>Every result shows its evidence</h2>
          <p style={{ marginTop: 10 }}>
            ECG predictions come with an Integrated Gradients heat map of the moments and leads that drove them. MRI results show the model's outline on the scan, and the diagnosis lists the measurements that were out of range. No public dataset has ECG, MRI and health records for the same patients, so the three results are combined by written rules into one attention level.
          </p>
        </div>
        <div className="arch-diagram">
          <span>ECG<br /><b>Integrated Gradients</b></span>
          <span>MRI<br /><b>Outlines + reasons</b></span>
          <span>Health<br /><b>Guideline flags</b></span>
          <strong>Rule-based summary: Low / Moderate / High</strong>
        </div>
      </section>
    </>
  );
}

// ----------------------------------------------------
// PAGE 9: RESEARCH PAGE
// ----------------------------------------------------
function ResearchPage() {
  return (
    <>
      <DemoNotice />
      <div className="page-title">
        <div>
          <div className="eyebrow">RESEARCH</div>
          <h1>Datasets and test results</h1>
          <p>Every figure below is measured on patients the models never saw during training.</p>
        </div>
      </div>

      <div className="recent" style={{ marginTop: 24 }}>
        <div className="section-header">
          <h2>Training datasets</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Dataset</th>
              <th>Data</th>
              <th>Size</th>
              <th>Labels used</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><b>PTB-XL</b> (Wagner et al., 2020)</td>
              <td>12-lead ECG, 10 s</td>
              <td>21,388 recordings; 2,158 held out for testing</td>
              <td>Five diagnostic superclasses</td>
            </tr>
            <tr>
              <td><b>ACDC</b> (Bernard et al., 2018)</td>
              <td>Short-axis cine MRI</td>
              <td>150 patients: 100 training, 50 test</td>
              <td>Expert outlines and five diagnoses</td>
            </tr>
            <tr>
              <td><b>Health profile</b></td>
              <td>Clinical values</td>
              <td>No training data</td>
              <td>ACC/AHA 2017 and NCEP ATP III guideline ranges</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="recent" style={{ marginTop: 24 }}>
        <div className="section-header">
          <h2>Held-out test results</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Measure</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><b>ECG classifier</b></td><td>Macro AUROC, five findings</td><td>0.911 (normal 0.941, MI 0.921, ST/T 0.930, conduction 0.924, hypertrophy 0.837)</td></tr>
            <tr><td><b>ECG digitizer</b></td><td>Correlation with the original signal, flat scans</td><td>0.94</td></tr>
            <tr><td><b>MRI segmenter</b></td><td>Dice overlap with expert outlines</td><td>LV 0.956, RV 0.933, myocardium 0.870 (end-diastole)</td></tr>
            <tr><td><b>Ejection fraction</b></td><td>Agreement with expert values</td><td>r = 0.991</td></tr>
            <tr><td><b>MRI diagnosis</b></td><td>Correct out of 50 test patients</td><td>45 (90%, 95% CI 79–96%)</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

