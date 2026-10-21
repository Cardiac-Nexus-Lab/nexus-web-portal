import React, { useState, useEffect, useRef } from 'react';
import {
  Activity, ArrowRight, BrainCircuit, CheckCircle2, ClipboardList, Database, Download, FileText, HeartPulse, History, Image, Info, KeyRound, LineChart, Menu, PanelLeftClose, Plus, Settings, ShieldCheck, SlidersHorizontal, Sparkles, Upload, UserRound, LogOut
} from 'lucide-react';
import { auth } from '../firebase';
import { sendEmailVerification, sendPasswordResetEmail, updateProfile } from 'firebase/auth';
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

// Per-browser preferences. Storage can be unavailable (private windows), so
// every read falls back and every write is allowed to fail.
function readPref(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}
function writePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not saved; still works this session */ }
}

const SIDEBAR_WIDTH = 238;
const DRAG_TO_TOGGLE = 60;  // px a drag must travel before release opens or closes the sidebar
const NARROW_QUERY = '(max-width: 850px)';

function useNarrowScreen() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = e => setNarrow(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

// Dragging the sidebar's edge handle: the sidebar follows the pointer, and on
// release it closes if dragged left far enough, opens if dragged right far
// enough, and otherwise springs back. A press without movement toggles it.
function useSidebarDrag(open, setOpen) {
  const [offset, setOffset] = useState(null);
  const drag = useRef(null);
  const base = open ? 0 : -SIDEBAR_WIDTH;

  const end = () => { drag.current = null; setOffset(null); };
  return {
    offset,
    handlers: {
      onPointerDown: e => {
        drag.current = { x: e.clientX, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
        setOffset(base);
      },
      onPointerMove: e => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x;
        if (Math.abs(dx) > 4) drag.current.moved = true;
        setOffset(Math.max(-SIDEBAR_WIDTH, Math.min(0, base + dx)));
      },
      onPointerUp: e => {
        if (!drag.current) return;
        const { x, moved } = drag.current;
        const dx = e.clientX - x;
        end();
        if (!moved) setOpen(!open);
        else if (open && dx < -DRAG_TO_TOGGLE) setOpen(false);
        else if (!open && dx > DRAG_TO_TOGGLE) setOpen(true);
      },
      onPointerCancel: end,
    },
  };
}

export function Dashboard({ user, token, onLogout, onUserUpdate }) {
  const [page, setPage] = useState(() => readPref('cnx.startPage', 'Dashboard'));
  const [result, setResult] = useState(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const narrow = useNarrowScreen();
  const [pinnedOpen, setPinnedOpen] = useState(() => readPref('cnx.sidebarOpen', true));
  const [drawerOpen, setDrawerOpen] = useState(false);
  // On wide screens the sidebar sits beside the page and remembers its state;
  // on narrow ones it is a drawer over the page that starts closed.
  const sidebarOpen = narrow ? drawerOpen : pinnedOpen;
  const setSidebarOpen = value => {
    if (narrow) setDrawerOpen(value);
    else { setPinnedOpen(value); writePref('cnx.sidebarOpen', value); }
  };
  const { offset, handlers } = useSidebarDrag(sidebarOpen, setSidebarOpen);

  useEffect(() => {
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarOpen(!sidebarOpen);
      } else if (e.key === 'Escape' && narrow && drawerOpen) {
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const go = name => {
    setPage(name);
    if (narrow) setDrawerOpen(false);
  };

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
    <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}>
      {narrow && drawerOpen && <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} />}

      {/* Sidebar */}
      <aside
        id="app-sidebar"
        className={`sidebar ${offset !== null ? 'dragging' : ''}`}
        style={offset !== null ? { transform: `translateX(${offset}px)` } : undefined}
        aria-hidden={!sidebarOpen && offset === null}
      >
        <Logo />
        <div className="workspace-label">RESEARCH WORKSPACE</div>
        {navItems.map(({ name, icon: Icon }) => (
          <button
            key={name}
            className={`nav-item ${page === name ? 'active' : ''}`}
            onClick={() => go(name)}
            tabIndex={sidebarOpen ? 0 : -1}
          >
            <Icon size={18} />
            <span>{name}</span>
          </button>
        ))}
        <div className="sidebar-bottom">
          <Badge tone="blue">ACTIVE WORKSPACE</Badge>
          <p>Multimodal AI System</p>
        </div>
        <div
          className="sidebar-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={sidebarOpen ? 'Drag left to hide the sidebar' : 'Drag right to show the sidebar'}
          title={sidebarOpen ? 'Drag left or click to hide' : 'Drag right or click to show'}
          {...handlers}
        >
          <span />
        </div>
      </aside>

      {/* Main Workspace */}
      <section className="workspace-main">
        {/* Header */}
        <header className="app-header">
          <button
            className="menu-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-controls="app-sidebar"
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            title={`${sidebarOpen ? 'Hide' : 'Show'} sidebar (Ctrl+B)`}
          >
            {sidebarOpen ? <PanelLeftClose size={20} /> : <Menu size={20} />}
          </button>
          <div className="app-header-title">
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
          {page === 'Settings' && (
            <SettingsPage user={user} token={token} onLogout={onLogout} onUserUpdate={onUserUpdate} setPage={go}
              sidebarPinned={pinnedOpen} setSidebarPinned={value => { setPinnedOpen(value); writePref('cnx.sidebarOpen', value); }} />
          )}
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
const SETTINGS_SECTIONS = [
  { id: 'profile', label: 'Profile', hint: 'Name, role, institution', Icon: UserRound },
  { id: 'account', label: 'Account & security', hint: 'Email, sign-in, password', Icon: KeyRound },
  { id: 'preferences', label: 'Preferences', hint: 'Layout and start page', Icon: SlidersHorizontal },
  { id: 'data', label: 'Data & privacy', hint: 'What is saved, export', Icon: Database },
  { id: 'about', label: 'About', hint: 'Models and versions', Icon: Info },
];

const ROLES = ['Researcher', 'Cardiologist', 'Radiologist', 'Student', 'Administrator', 'Other'];
const START_PAGES = ['Dashboard', 'New Analysis', 'History'];

const unset = value => !value || value === 'Not Set' || value === 'Complete Profile' || !String(value).trim();

function SettingsRow({ label, description, children }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <b>{label}</b>
        {description && <p>{description}</p>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label}
      className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function Notice({ tone, children }) {
  return children ? <div className={`settings-notice ${tone}`} role="status">{children}</div> : null;
}

function SettingsPage({ user, token, onLogout, onUserUpdate, setPage, sidebarPinned, setSidebarPinned }) {
  const [section, setSection] = useState(() => readPref('cnx.settingsSection', 'profile'));
  const choose = id => { setSection(id); writePref('cnx.settingsSection', id); };
  const current = SETTINGS_SECTIONS.find(s => s.id === section) || SETTINGS_SECTIONS[0];
  const nav = useRef(null);
  // On phones the sections are a scrolling row of tabs; keep the chosen one in view.
  useEffect(() => {
    nav.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current.id]);

  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">WORKSPACE SETTINGS</div>
          <h1>Settings</h1>
          <p>Manage your profile, account security, preferences and data.</p>
        </div>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections" ref={nav}>
          {SETTINGS_SECTIONS.map(({ id, label, hint, Icon }) => (
            <button key={id} className={current.id === id ? 'active' : ''} onClick={() => choose(id)}
              aria-current={current.id === id ? 'page' : undefined}>
              <Icon size={18} />
              <span><b>{label}</b><small>{hint}</small></span>
            </button>
          ))}
        </nav>

        <section className="settings-panel">
          {current.id === 'profile' && <ProfileSettings user={user} token={token} onUserUpdate={onUserUpdate} />}
          {current.id === 'account' && <AccountSettings user={user} onLogout={onLogout} />}
          {current.id === 'preferences' && <PreferenceSettings sidebarPinned={sidebarPinned} setSidebarPinned={setSidebarPinned} />}
          {current.id === 'data' && <DataSettings token={token} setPage={setPage} />}
          {current.id === 'about' && <AboutSettings setPage={setPage} />}
        </section>
      </div>
    </>
  );
}

function PanelHeader({ title, children }) {
  return (
    <header className="settings-panel-header">
      <h2>{title}</h2>
      <p>{children}</p>
    </header>
  );
}

function ProfileSettings({ user, token, onUserUpdate }) {
  const initial = () => ({
    name: user?.name || user?.displayName || '',
    role: unset(user?.role) ? '' : user.role,
    institution: unset(user?.institution) ? '' : user.institution,
  });
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ tone: '', text: '' });
  useEffect(() => { setForm(initial()); }, [user]);

  const saved = initial();
  const changed = form.name !== saved.name || form.role !== saved.role || form.institution !== saved.institution;
  const incomplete = !saved.role || !saved.institution;
  const set = (key, value) => { setForm({ ...form, [key]: value }); setMessage({ tone: '', text: '' }); };

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMessage({ tone: '', text: '' });
    try {
      const resp = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: form.name.trim(), role: form.role, institution: form.institution.trim() }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || 'Could not save the profile.');
      }
      const updated = await resp.json();
      if (auth.currentUser && form.name.trim()) {
        try { await updateProfile(auth.currentUser, { displayName: form.name.trim() }); } catch (e) { console.warn('Could not update Firebase displayName:', e); }
      }
      onUserUpdate?.(updated);
      setMessage({ tone: 'success', text: 'Profile saved.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err.message || 'Could not save the profile.' });
    } finally {
      setSaving(false);
    }
  }

  const name = user?.name || user?.displayName || 'User';
  return (
    <form onSubmit={save}>
      <PanelHeader title="Profile">How you appear in the workspace and on generated reports.</PanelHeader>

      <div className="settings-identity">
        <div className="settings-avatar">{name[0].toUpperCase()}</div>
        <div>
          <b>{name}</b>
          <p>{user?.email || ''}</p>
        </div>
        {incomplete && <Badge tone="amber">PROFILE INCOMPLETE</Badge>}
      </div>

      <div className="settings-fields">
        <label>Full name
          <input type="text" value={form.name} onChange={e => set('name', e.target.value)} required placeholder="e.g. Dr. Sarah Jenkins" />
        </label>
        <label>Role
          <select value={form.role} onChange={e => set('role', e.target.value)}>
            <option value="">Not set</option>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="wide">Institution
          <input type="text" value={form.institution} onChange={e => set('institution', e.target.value)} placeholder="e.g. SJC Institute of Technology" />
        </label>
      </div>

      <Notice tone={message.tone}>{message.text}</Notice>
      <div className="settings-actions">
        <button type="button" className="secondary" disabled={!changed || saving} onClick={() => setForm(initial())}>Discard</button>
        <button type="submit" className="primary" disabled={!changed || saving || !form.name.trim()}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  );
}

function AccountSettings({ user, onLogout }) {
  const providerId = auth.currentUser?.providerData?.[0]?.providerId || user?.provider || user?.auth_provider || '';
  const isGoogle = ['google.com', 'google', 'Google Sign-In'].includes(providerId) || ['google', 'Google Sign-In'].includes(user?.auth_provider);
  const email = user?.email || auth.currentUser?.email || '';
  const [verified, setVerified] = useState(Boolean(user?.emailVerified));
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState({ tone: '', text: '' });

  useEffect(() => {
    let live = true;
    (async () => {
      if (!auth.currentUser) return;
      try { await auth.currentUser.reload(); } catch (e) { console.warn('Could not reload Firebase user state:', e); }
      if (live && auth.currentUser) setVerified(auth.currentUser.emailVerified);
    })();
    return () => { live = false; };
  }, [user]);

  async function run(kind, action, success) {
    setBusy(kind);
    setMessage({ tone: '', text: '' });
    try {
      await action();
      setMessage({ tone: 'success', text: success });
    } catch (err) {
      setMessage({ tone: 'error', text: err.message || 'Something went wrong. Please try again.' });
    } finally {
      setBusy('');
    }
  }

  const sendVerification = () => run('verify', async () => {
    if (!auth.currentUser) throw new Error('No active session. Please sign in again.');
    await sendEmailVerification(auth.currentUser);
  }, `Verification email sent to ${email}.`);

  const sendReset = () => run('reset', () => sendPasswordResetEmail(auth, email),
    `Password reset email sent to ${email}.`);

  const memberSince = user?.created_at ? new Date(user.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : null;

  return (
    <>
      <PanelHeader title="Account & security">Your sign-in details. Email and password are managed by Firebase Authentication.</PanelHeader>
      <Notice tone={message.tone}>{message.text}</Notice>

      <SettingsRow label="Email address" description="Used to sign in and to link your saved analyses.">
        <span className="settings-value">{email || '—'}</span>
      </SettingsRow>

      <SettingsRow label="Email verification" description={isGoogle ? 'Verified by Google when you signed in.' : 'Confirms that this address belongs to you.'}>
        {isGoogle || verified ? (
          <Badge tone="green">VERIFIED</Badge>
        ) : (
          <>
            <Badge tone="amber">NOT VERIFIED</Badge>
            <button type="button" className="secondary small" onClick={sendVerification} disabled={busy === 'verify'}>
              {busy === 'verify' ? 'Sending…' : 'Send email'}
            </button>
          </>
        )}
      </SettingsRow>

      <SettingsRow label="Sign-in method">
        <Badge tone={isGoogle ? 'blue' : 'green'}>{isGoogle ? 'GOOGLE SIGN-IN' : 'EMAIL AND PASSWORD'}</Badge>
      </SettingsRow>

      <SettingsRow label="Password" description={isGoogle ? 'Your password is managed in your Google account.' : 'We email you a secure link to choose a new password.'}>
        {isGoogle ? (
          <a className="secondary small" href="https://myaccount.google.com/security" target="_blank" rel="noreferrer">Google security</a>
        ) : (
          <button type="button" className="secondary small" onClick={sendReset} disabled={busy === 'reset' || !email}>
            {busy === 'reset' ? 'Sending…' : 'Reset password'}
          </button>
        )}
      </SettingsRow>

      {memberSince && (
        <SettingsRow label="Member since"><span className="settings-value">{memberSince}</span></SettingsRow>
      )}

      <SettingsRow label="Sign out" description="Ends your session in this browser.">
        <button type="button" className="secondary small danger" onClick={onLogout}><LogOut size={15} /> Sign out</button>
      </SettingsRow>
    </>
  );
}

function PreferenceSettings({ sidebarPinned, setSidebarPinned }) {
  const [startPage, setStartPage] = useState(() => readPref('cnx.startPage', 'Dashboard'));
  return (
    <>
      <PanelHeader title="Preferences">Saved in this browser only.</PanelHeader>

      <SettingsRow label="Keep the sidebar open"
        description="Hide it with the menu button, by dragging its edge to the left, or with Ctrl+B (⌘B on Mac). On phones it always opens as a drawer.">
        <Switch checked={sidebarPinned} onChange={setSidebarPinned} label="Keep the sidebar open" />
      </SettingsRow>

      <SettingsRow label="Start page" description="The page that opens after you sign in.">
        <select value={startPage} onChange={e => { setStartPage(e.target.value); writePref('cnx.startPage', e.target.value); }}>
          {START_PAGES.map(p => <option key={p}>{p}</option>)}
        </select>
      </SettingsRow>
    </>
  );
}

function DataSettings({ token, setPage }) {
  const [analyses, setAnalyses] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetch('/api/analyses', { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load your saved analyses.'))))
      .then(rows => { if (live) setAnalyses(rows); })
      .catch(err => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [token]);

  function exportList() {
    const blob = new Blob([JSON.stringify(analyses, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `cardiac-nexus-analyses-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <>
      <PanelHeader title="Data & privacy">What Cardiac Nexus keeps about your work.</PanelHeader>
      <Notice tone="error">{error}</Notice>

      <SettingsRow label="Saved analyses" description="Results of each analysis you run are saved to your account and listed in History.">
        <span className="settings-value">{analyses ? analyses.length : error ? '—' : 'Loading…'}</span>
        <button type="button" className="secondary small" onClick={() => setPage('History')}>Open History</button>
      </SettingsRow>

      <SettingsRow label="Export" description="Download the list of your saved analyses as a JSON file.">
        <button type="button" className="secondary small" onClick={exportList} disabled={!analyses?.length}>
          <Download size={15} /> Export
        </button>
      </SettingsRow>

      <SettingsRow label="Uploaded files" description="ECG and MRI files are read in memory for the analysis and are not kept. Only the file names and the results are saved.">
        <Badge tone="green">NOT STORED</Badge>
      </SettingsRow>

      <SettingsRow label="Research use" description="Cardiac Nexus is a research prototype. Use de-identified data, and do not use its results for clinical decisions.">
        <ShieldCheck size={20} className="settings-icon" />
      </SettingsRow>
    </>
  );
}

function AboutSettings({ setPage }) {
  const models = [
    ['ECG classifier', 'xresnet1d18, trained on PTB-XL'],
    ['ECG digitizer', 'CNN trace localizer for 12x1 printouts'],
    ['MRI segmenter', '2.5D U-Net, trained on ACDC, M&Ms and M&Ms-2'],
    ['MRI diagnosis', 'Logistic regression on heart measurements'],
    ['Health checks', 'ACC/AHA 2017 and NCEP ATP III rules'],
  ];
  return (
    <>
      <PanelHeader title="About">Cardiac Nexus: explainable multimodal cardiovascular AI.</PanelHeader>
      {models.map(([label, value]) => (
        <SettingsRow key={label} label={label}><span className="settings-value">{value}</span></SettingsRow>
      ))}
      <SettingsRow label="Project" description="BE major project, Department of CSE, SJC Institute of Technology.">
        <button type="button" className="secondary small" onClick={() => setPage('Research')}>Test results</button>
      </SettingsRow>
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
              <td>150 patients: 80 training, 20 validation, 50 test</td>
              <td>Expert outlines and five diagnoses</td>
            </tr>
            <tr>
              <td><b>M&amp;Ms and M&amp;Ms-2</b></td>
              <td>Short-axis cine MRI, several vendors</td>
              <td>680 patients: 310 training, 74 validation, 296 test</td>
              <td>Expert outlines</td>
            </tr>
            <tr>
              <td><b>Kaggle Data Science Bowl</b></td>
              <td>Short-axis cine MRI</td>
              <td>439 external test patients</td>
              <td>Clinician LV volumes and ejection fraction</td>
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
            <tr><td><b>MRI segmenter</b></td><td>Dice overlap with expert outlines</td><td>End-diastole, ACDC / M&amp;Ms / M&amp;Ms-2: LV 0.954 / 0.937 / 0.944, RV 0.928 / 0.892 / 0.908, myocardium 0.861 / 0.828 / 0.833</td></tr>
            <tr><td><b>Ejection fraction</b></td><td>Mean absolute error</td><td>3.0 / 4.1 / 3.6 points against experts; 5.7 points against clinicians on 439 external Kaggle patients</td></tr>
            <tr><td><b>MRI diagnosis</b></td><td>Correct out of 50 ACDC test patients</td><td>43 (86%, 95% CI 74–93%)</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

