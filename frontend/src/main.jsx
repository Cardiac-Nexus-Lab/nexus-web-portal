import './api-fetch'
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
    frontDescription: 'A 12-lead recording or a scanned printout, classified by a 1D ResNet-18.',
    backTitle: 'ECG Analysis',
    backContent: 'Reads 10 seconds of a 12-lead ECG and gives the probability of five diagnostic findings, with a heat map of the evidence.',
    backDetails: [
      { label: 'Input', value: '12-lead ECG as CSV, or a flat scan of a 12x1 printout' },
      { label: 'Processing', value: 'Digitizer for printouts → 10 s at 100 Hz → per-lead scaling' },
      { label: 'Model', value: 'xresnet1d18 (1D ResNet-18), calibrated' },
      { label: 'Output', value: 'Five findings with probabilities + Integrated Gradients map' }
    ]
  },
  {
    icon: Image,
    frontTitle: 'Cardiac MRI',
    frontDescription: 'Short-axis MRI outlined by a 2.5D U-Net, then measured.',
    backTitle: 'Cardiac MRI Analysis',
    backContent: 'Outlines the heart chambers on every slice, measures how well the heart pumps, and suggests one of five diagnoses.',
    backDetails: [
      { label: 'Input', value: 'Two short-axis volumes: heart full and heart squeezed' },
      { label: 'Processing', value: 'Segment LV, RV, myocardium → volumes, EF, mass' },
      { label: 'Model', value: '2.5D U-Net + measurement-based classifier' },
      { label: 'Output', value: 'Ejection fraction, volumes and diagnosis with reasons' }
    ]
  },
  {
    icon: ClipboardList,
    frontTitle: 'Health Profile',
    frontDescription: 'Blood pressure, cholesterol and symptoms checked against clinical guidelines.',
    backTitle: 'Health Profile Check',
    backContent: 'Compares each value with published clinical guidelines and explains every flag in words.',
    backDetails: [
      { label: 'Input', value: 'Age, sex, BP, cholesterol, max heart rate, symptoms' },
      { label: 'Guidelines', value: 'ACC/AHA 2017 (BP), NCEP ATP III (cholesterol)' },
      { label: 'Method', value: 'Guideline rules, not a trained model' },
      { label: 'Output', value: 'Risk flags: ok, moderate or high, with reasons' }
    ]
  },
  {
    icon: BrainCircuit,
    frontTitle: 'Combined Summary',
    frontDescription: 'All three results brought together into one attention level.',
    backTitle: 'Multimodal Summary',
    backContent: 'No public dataset has ECG, MRI and health records for the same patients, so the three results are combined by written rules shown with every result.',
    backDetails: [
      { label: 'ECG', value: 'Findings above set probability thresholds' },
      { label: 'MRI', value: 'Ejection fraction and diagnosis' },
      { label: 'Health', value: 'Guideline flags' },
      { label: 'Output', value: 'Attention level Low / Moderate / High, with reasons' }
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
            <h2>Three analyses, each one explained.</h2>
            <p style={{ marginTop: 12 }}>
              ECG recordings go to a 1D ResNet-18 trained on PTB-XL; paper printouts are first turned back into signals by a CNN trace digitizer. Cardiac MRI is outlined by a 2.5D U-Net trained on ACDC, and the outlines give chamber volumes, ejection fraction and a five-way diagnosis. Health values are checked against clinical guidelines. The three results are then combined by written rules into one attention level.
            </p>

            <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ background: 'rgba(255,255,255,0.06)', padding: 16, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)' }}>
                <h4 style={{ color: '#82e3e5', margin: '0 0 6px' }}>Integrated Gradients (ECG)</h4>
                <p style={{ fontSize: 12, color: '#b4cbd2', margin: 0 }}>Shows which moments of each lead pushed the prediction up or down, and which leads the model relied on most.</p>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.06)', padding: 16, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)' }}>
                <h4 style={{ color: '#82e3e5', margin: '0 0 6px' }}>Outlines and reasons (MRI)</h4>
                <p style={{ fontSize: 12, color: '#b4cbd2', margin: 0 }}>Every MRI result shows the model's outline on the scan, and the diagnosis lists the measurements that were out of range.</p>
              </div>
            </div>
          </div>
          <div className="arch-diagram">
            <span>ECG<br /><b>1D ResNet-18</b></span>
            <span>MRI<br /><b>2.5D U-Net</b></span>
            <span>Health<br /><b>Guideline checks</b></span>
            <strong>Rule-based multimodal summary</strong>
            <strong>Attention level (Low / Moderate / High)</strong>
            <strong>Heat maps · outlines · reasons</strong>
          </div>
        </section>

        {/* RESEARCH SECTION */}
        <section className="research" id="research">
          <ShieldCheck style={{ flexShrink: 0 }} />
          <div>
            <div className="eyebrow">RESEARCH & CLINICAL GOVERNANCE</div>
            <h2>Responsible research by design.</h2>
            <p>
              The models are trained and tested on public datasets: PTB-XL for ECG (21,388 recordings, with 2,158 held out for testing) and ACDC for cardiac MRI (100 training and 50 test patients). Every figure on this site is a held-out test result. Clinical validation, governance and privacy controls would be required before any real-world clinical use.
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

