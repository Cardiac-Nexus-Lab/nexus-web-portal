import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, BrainCircuit, ChevronRight, ClipboardList, HeartPulse, Image, LineChart, ShieldCheck } from 'lucide-react'
import './styles.css'
import { ExplodedHeart } from './components/ExplodedHeart'
import { TeamPage } from './components/TeamPage'
import { ProjectIntro } from './components/ProjectIntro'
import { FusionCard } from './components/FusionCard'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { auth } from './firebase'
import { AuthPage } from './components/AuthPage'
import { Dashboard as DashboardShell } from './components/Dashboard'

const modalitiesCardsData = [
  {
    icon: LineChart,
    frontTitle: 'ECG Signal',
    frontDescription: '1D signal preprocessing and temporal feature extraction via 1D CNN + BiLSTM.',
    backTitle: 'ECG Analysis',
    backContent: 'Processes 12-lead ECG signals to extract temporal and morphological features using deep learning.',
    backDetails: [
      { label: 'Input', value: '12-lead ECG' },
      { label: 'Processing', value: 'Filtering → Normalization → Feature Extraction' },
      { label: 'Model', value: '1D CNN + BiLSTM' },
      { label: 'Output', value: 'ECG-derived cardiac features' }
    ]
  },
  {
    icon: Image,
    frontTitle: 'Cardiac MRI',
    frontDescription: 'Image preparation and spatial feature extraction using 2D/3D ResNet.',
    backTitle: 'Cardiac MRI Analysis',
    backContent: 'Analyzes cardiac MRI images to identify spatial patterns and structural cardiac characteristics.',
    backDetails: [
      { label: 'Input', value: 'Cardiac MRI' },
      { label: 'Processing', value: 'Preprocessing → Segmentation → Feature Extraction' },
      { label: 'Model', value: '2D/3D ResNet' },
      { label: 'Output', value: 'Spatial cardiac features' }
    ]
  },
  {
    icon: ClipboardList,
    frontTitle: 'Health Profile',
    frontDescription: 'Structured clinical risk-factor processing with deep neural networks.',
    backTitle: 'Health Profile Analysis',
    backContent: 'Processes structured clinical and health information to capture cardiovascular risk factors.',
    backDetails: [
      { label: 'Input', value: 'Clinical/EHR data' },
      { label: 'Features', value: 'Demographic and clinical risk factors' },
      { label: 'Model', value: 'Deep Neural Network' },
      { label: 'Output', value: 'Tabular clinical features' }
    ]
  },
  {
    icon: BrainCircuit,
    frontTitle: 'Late Fusion',
    frontDescription: 'A unified multimodal representation combining temporal, spatial, and tabular features.',
    backTitle: 'Multimodal Fusion',
    backContent: 'Combines complementary information from ECG, cardiac MRI, and health-profile models into a unified representation for cardiovascular prediction.',
    backDetails: [
      { label: 'ECG', value: 'Temporal features' },
      { label: 'MRI', value: 'Spatial features' },
      { label: 'EHR', value: 'Tabular features' },
      { label: 'Output', value: 'Unified multimodal representation' }
    ]
  }
]

function ModalityCard({ card }) {
  const [isFlipped, setIsFlipped] = useState(false)
  const Icon = card.icon

  const toggleFlip = () => setIsFlipped(prev => !prev)

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleFlip()
    }
  }

  return (
    <div className="flip-card">
      <div
        className={`flip-card-inner ${isFlipped ? 'is-flipped' : ''}`}
        onClick={toggleFlip}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-expanded={isFlipped}
        aria-label={`${card.frontTitle} card. Click to ${isFlipped ? 'show front view' : 'view detailed analysis'}`}
      >
        <div className="flip-card-front">
          <Icon />
          <h3>{card.frontTitle}</h3>
          <p>{card.frontDescription}</p>
        </div>
        <div className="flip-card-back">
          <div className="flip-card-back-header">
            <h3>{card.backTitle}</h3>
          </div>
          <p className="flip-card-back-content">{card.backContent}</p>
          <ul className="flip-card-details">
            {card.backDetails.map((detail, idx) => (
              <li key={idx}>
                <strong>{detail.label}:</strong> {detail.value}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function Badge({ children, tone = 'blue' }) { return <span className={`badge ${tone}`}>{children}</span> }
function Logo() { return <div className="logo"><span><HeartPulse size={22}/></span><div>Cardiac <b>Nexus</b><small>EXPLAINABLE CARDIOVASCULAR AI</small></div></div> }

function Landing({ enter, signIn }) {
  return (
    <div className="public">
      <header>
        <Logo />
        <div className="college">
          <img src="/sjcit-logo.png" alt="" onError={e => { e.currentTarget.hidden = true }} />
          <span>SJC Institute of Technology</span>
        </div>
        <nav>
          <a href="#heart">The heart</a>
          <a href="#how">How it works</a>
          <a href="#technology">Technology</a>
          <a href="#research">Research</a>
          <button className="text-btn" onClick={signIn}>Sign in</button>
          <button className="primary small" onClick={signIn}>Start analysis <ArrowRight size={16} /></button>
        </nav>
      </header>
      <main>
        <ProjectIntro />

        <section className="hero" id="start">
          <div className="hero-copy">
            <Badge>Multimodal cardiovascular research platform</Badge>
            <h1>AI-assisted risk assessment with <em>explainable</em> insight.</h1>
            <p>Cardiac Nexus brings ECG signals, cardiac MRI, and patient health data into one transparent research workflow.</p>
            <div className="hero-actions">
              <button className="primary" onClick={enter}>Start analysis <ArrowRight size={17} /></button>
              <a className="secondary" href="#technology">Explore technology <ChevronRight size={17} /></a>
            </div>
          </div>
          <FusionCard />
        </section>

        <ExplodedHeart />

        {/* HOW IT WORKS SECTION */}
        <section className="section" id="how">
          <div className="eyebrow">HOW IT WORKS</div>
          <h2>Three modalities. One unified patient view.</h2>
          <div className="feature-grid">
            {modalitiesCardsData.map((card) => (
              <ModalityCard key={card.frontTitle} card={card} />
            ))}
          </div>
        </section>

        {/* TECHNOLOGY SECTION */}
        <section className="architecture" id="technology">
          <div>
            <div className="eyebrow">SYSTEM ARCHITECTURE & TECHNOLOGY</div>
            <h2>Multimodal learning with transparent insight.</h2>
            <p style={{ marginTop: 12 }}>
              ECG signals (1D CNN + BiLSTM), Cardiac MRI DICOM slices (CNN), and EHR clinical variables (Dense NN) are brought together through late fusion, with clear explanation views for clinical variables, ECG temporal regions, and MRI spatial attention.
            </p>

            <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ background: 'rgba(255,255,255,0.06)', padding: 16, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)' }}>
                <h4 style={{ color: '#82e3e5', margin: '0 0 6px' }}>SHAP Variable Importance</h4>
                <p style={{ fontSize: 12, color: '#b4cbd2', margin: 0 }}>Quantifies individual EHR risk factor contribution (cholesterol, blood pressure, age) to the risk score.</p>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.06)', padding: 16, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)' }}>
                <h4 style={{ color: '#82e3e5', margin: '0 0 6px' }}>Grad-CAM Saliency Maps</h4>
                <p style={{ fontSize: 12, color: '#b4cbd2', margin: 0 }}>Visual heatmaps highlighting myocardial tissue regions in MRI and temporal segments in 12-lead ECG.</p>
              </div>
            </div>
          </div>
          <div className="arch-diagram">
            <span>ECG<br /><b>1D CNN + LSTM</b></span>
            <span>MRI<br /><b>CNN ResNet</b></span>
            <span>EHR<br /><b>Dense NN</b></span>
            <strong>Late Fusion Transformer Layer</strong>
            <strong>Risk Prediction (Low / Moderate / High)</strong>
            <strong>SHAP + Grad-CAM Explainability</strong>
          </div>
        </section>

        {/* RESEARCH SECTION */}
        <section className="research" id="research">
          <ShieldCheck style={{ flexShrink: 0 }} />
          <div>
            <div className="eyebrow">RESEARCH & CLINICAL GOVERNANCE</div>
            <h2>Responsible research by design.</h2>
            <p>
              Clinical validation, governance, calibrated performance evaluation, and privacy controls are required before any real-world clinical use. Models are developed for evaluation on PTB-XL ECG and UK Biobank Cardiac MRI cohorts.
            </p>
          </div>
        </section>

      </main>
      <footer>
        © 2026 Cardiac Nexus · <span>AI-generated risk assessment platform.</span>
      </footer>
    </div>
  );
}

const TEAM_HASH = '#/team';

function App() {
  const [view, setView] = useState(() => (window.location.hash === TEAM_HASH ? 'team' : 'public')); // 'public' | 'auth' | 'dashboard' | 'team'
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);

  // Synchronize Firebase auth state immediately
  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const providerId = firebaseUser.providerData?.[0]?.providerId || 'password';
        const isGoogle = providerId === 'google.com';

        const userData = {
          id: firebaseUser.uid,
          firebase_uid: firebaseUser.uid,
          name: firebaseUser.displayName || 'Cardiology Researcher',
          email: firebaseUser.email,
          photoURL: firebaseUser.photoURL || null,
          avatar: firebaseUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${firebaseUser.email}`,
          provider: providerId,
          auth_provider: isGoogle ? 'Google Sign-In' : 'Email/Password',
          role: 'Cardiology Researcher',
          institution: 'Nexus Heart Institute'
        };

        try {
          const idToken = await firebaseUser.getIdToken();
          setToken(idToken);
          const resp = await fetch('/api/auth/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken })
          });
          if (resp.ok) {
            const synced = await resp.json();
            setUser({ ...userData, ...synced.user });
            if (window.location.hash !== TEAM_HASH) setView('dashboard');
            return;
          }
        } catch (e) {
          console.log("Backend sync offline, using active Firebase user session.");
        }

        setUser(userData);
        if (window.location.hash !== TEAM_HASH) setView('dashboard');
      } else {
        setUser(null);
        setToken(null);
        if (view === 'dashboard') {
          setView('auth');
        }
      }
    });

    return () => unsubscribe();
  }, []);

  React.useEffect(() => {
    const onPop = () => setView(window.location.hash === TEAM_HASH ? 'team' : 'public');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The team page is reached only by its URL; the landing page shows the same
  // guide and team in its first section.
  const closeTeam = () => {
    window.history.replaceState(null, '', window.location.pathname);
    setView('public');
  };

  const handleAuthSuccess = (userData, accessToken) => {
    setUser(userData);
    setToken(accessToken);
    setView('dashboard');
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.log("Logout complete");
    }
    setUser(null);
    setToken(null);
    setView('auth');
  };

  if (view === 'team') {
    return <TeamPage onBack={closeTeam} />;
  }

  if (view === 'public') {
    return <Landing enter={() => setView('auth')} signIn={() => setView('auth')} />;
  }

  if (view === 'auth' || (!user && view === 'dashboard')) {
    return <AuthPage onAuthSuccess={handleAuthSuccess} onBackToPublic={() => setView('public')} />;
  }

  return <DashboardShell user={user} token={token} onLogout={handleLogout} />;
}

createRoot(document.getElementById('root')).render(<App />);

