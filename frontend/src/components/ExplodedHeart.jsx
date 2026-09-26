import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import './exploded-heart.css';

/*
 * Scroll-driven exploded view of the heart.
 *
 * The section is several screens tall with a sticky stage inside. Scroll
 * position becomes a progress value p in [0, 1], split into four acts:
 *
 *   intro    the assembled heart beats
 *   explode  parts separate along their own vectors
 *   tour     a probe visits each part and reads out what Cardiac Nexus sees there
 *   fusion   the parts return and the three modalities converge
 *
 * Continuous motion (the explosion) is driven by one CSS variable, --e, written
 * straight to the SVG so scrolling never re-renders React. React state changes
 * only when the act or the visited part changes.
 */

const MODALITIES = {
  ECG: { label: 'ECG', color: '#5ee6e8' },
  MRI: { label: 'MRI', color: '#b69cff' },
  EHR: { label: 'EHR', color: '#fbbf5a' },
};

// Every figure below comes from the held-out test results in nexus-ai-engine.
const STOPS = [
  {
    id: 'conduction',
    title: 'Electrical system',
    kicker: 'Where every beat begins',
    body: 'The sinoatrial node fires, the wave spreads across the atria, pauses at the atrioventricular node, then races down the bundle branches. A 12-lead ECG records that wave from twelve angles.',
    modalities: ['ECG'],
    metrics: [
      { value: '0.911', label: 'AUROC across five ECG diagnoses, 2,158 unseen recordings' },
      { value: '0.94', label: 'waveform recovered from a scanned paper ECG' },
    ],
    status: 'Trained · tested',
    probe: [300, 372],
  },
  {
    id: 'atria',
    title: 'Atria',
    kicker: 'The upper chambers',
    body: 'They collect returning blood and prime the ventricles. When they enlarge under strain, the P wave on the ECG changes shape, one of the signs the hypertrophy class looks for.',
    modalities: ['ECG'],
    metrics: [
      { value: '0.837', label: 'AUROC for hypertrophy, the hardest ECG class, reported rather than hidden' },
    ],
    status: 'Trained · tested',
    probe: [22, 262],
  },
  {
    id: 'shell',
    title: 'Heart muscle',
    kicker: 'Seen by two modalities',
    body: 'A heart attack leaves scar in this muscle. The ECG sees it as altered electrical waves; the MRI measures the wall itself. Two independent views of the same tissue are exactly what fusion is for.',
    modalities: ['ECG', 'MRI'],
    metrics: [
      { value: '0.921', label: 'ECG AUROC for myocardial infarction' },
      { value: '0.896', label: 'MRI overlap with expert outline of the muscle' },
    ],
    status: 'Trained · tested',
    probe: [345, 548],
  },
  {
    id: 'lv',
    title: 'Left ventricle',
    kicker: 'The main pump',
    body: 'It pushes blood to the whole body. The MRI model outlines it when the heart is fullest and emptiest, then calculates how much blood each beat ejects.',
    modalities: ['MRI'],
    metrics: [
      { value: '0.956', label: 'overlap with expert outline (Dice), 50 unseen patients' },
      { value: 'r 0.991', label: 'ejection fraction agreement with experts' },
    ],
    status: 'Trained · tested',
    probe: [590, 480],
  },
  {
    id: 'rv',
    title: 'Right ventricle',
    kicker: 'The lung pump',
    body: 'Thin-walled and crescent-shaped, it is the hardest chamber to outline, as in every published benchmark. Its size and function feed the MRI diagnosis of five heart conditions.',
    modalities: ['MRI'],
    metrics: [
      { value: '0.933', label: 'overlap with expert outline (Dice)' },
      { value: '45 / 50', label: 'unseen patients diagnosed correctly from heart measurements' },
    ],
    status: 'Trained · tested',
    probe: [128, 508],
  },
  {
    id: 'vessels',
    title: 'Arteries and risk factors',
    kicker: 'The life around the heart',
    body: 'Blood pressure, cholesterol, age, diabetes and smoking damage the arteries over decades. The health-record branch turns them into a risk profile that no scan or trace can see.',
    modalities: ['EHR'],
    chips: ['Age', 'Blood pressure', 'Cholesterol', 'Diabetes', 'Smoking'],
    status: 'In development',
    probe: [345, 48],
  },
];

const FUSION = {
  title: 'One patient. One picture.',
  body: 'Each branch compresses what it sees into a 128-number summary. The fusion layer is built to combine them into a single risk estimate, with every part of the answer traceable to the signal, the scan or the record behind it.',
  status: 'Encoders ready · joint training needs paired patient data',
};

// Scroll budget: fractions of the section's scroll length given to each act.
const INTRO_END = 0.07;
const EXPLODE_END = 0.17;
const TOUR_END = 0.87;
const STOP_SPAN = (TOUR_END - EXPLODE_END) / STOPS.length;
const REASSEMBLE_END = 0.94;

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function explosionAt(p) {
  if (p <= INTRO_END) return 0;
  if (p <= EXPLODE_END) return ease((p - INTRO_END) / (EXPLODE_END - INTRO_END));
  if (p <= TOUR_END) return 1;
  return 1 - ease(clamp((p - TOUR_END) / (REASSEMBLE_END - TOUR_END)));
}

function actAt(p) {
  if (p <= INTRO_END) return { act: 'intro', index: -1 };
  if (p <= EXPLODE_END) return { act: 'explode', index: -1 };
  if (p <= TOUR_END) return { act: 'tour', index: Math.min(STOPS.length - 1, Math.floor((p - EXPLODE_END) / STOP_SPAN)) };
  return { act: 'fusion', index: -1 };
}

// Part geometry. --dx/--dy is where the part flies to; --s is its exploded scale.
function Part({ id, active, dim, dx, dy, s = 1, onSelect, label, children }) {
  return (
    <g
      className={`eh-part ${active ? 'is-active' : ''} ${dim ? 'is-dim' : ''}`}
      style={{ '--dx': dx, '--dy': dy, '--s': s }}
      data-part={id}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={label}
      onClick={onSelect}
      onKeyDown={onSelect ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } } : undefined}
    >
      {children}
    </g>
  );
}

function HeartDefs() {
  return (
    <defs>
      <radialGradient id="eh-oxy" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stopColor="#ff8a98" />
        <stop offset="45%" stopColor="#d6404f" />
        <stop offset="100%" stopColor="#6d1427" />
      </radialGradient>
      <radialGradient id="eh-deoxy" cx="35%" cy="30%" r="80%">
        <stop offset="0%" stopColor="#a9b3ff" />
        <stop offset="45%" stopColor="#5d63c2" />
        <stop offset="100%" stopColor="#252768" />
      </radialGradient>
      <radialGradient id="eh-muscle" cx="40%" cy="30%" r="85%">
        <stop offset="0%" stopColor="#f08a7a" />
        <stop offset="55%" stopColor="#b43c46" />
        <stop offset="100%" stopColor="#4f0f1e" />
      </radialGradient>
      <linearGradient id="eh-sheen" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0%" stopColor="#fff" stopOpacity="0.45" />
        <stop offset="40%" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <radialGradient id="eh-core" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="40%" stopColor="#7ff3f0" />
        <stop offset="100%" stopColor="#0d7482" stopOpacity="0" />
      </radialGradient>
      <filter id="eh-soft" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="14" stdDeviation="16" floodColor="#000" floodOpacity="0.45" />
      </filter>
      <filter id="eh-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <clipPath id="eh-shell-clip">
        <path d={SHELL} />
      </clipPath>
    </defs>
  );
}

// Anterior view: the patient's right is the viewer's left, apex down and to the right.
const SHELL = 'M225 305C255 258 310 238 350 248C396 238 452 262 472 310C494 364 484 434 451 476C431 502 413 516 392 526C339 510 276 482 238 445C206 414 196 368 205 336C209 322 216 312 225 305Z';
const RA = 'M160 245C140 285 142 345 175 378C200 400 235 395 250 368C262 340 262 290 250 255C238 222 205 210 185 220C172 226 164 236 160 245Z';
const LA = 'M392 229C410 213 440 214 449 233C456 250 444 266 422 266C405 266 393 254 391 242Z';
const RV = 'M238 300C262 268 305 255 345 262C360 300 368 380 372 440C375 470 382 492 392 510C345 495 288 468 250 432C222 405 212 368 218 338C222 320 228 310 238 300Z';
const LV = 'M345 262C385 250 432 268 455 310C478 355 470 420 440 462C423 487 408 500 392 512C382 492 375 470 372 440C368 380 360 300 345 262Z';
const AORTA = 'M250 266C246 222 246 176 258 146C272 111 310 96 350 100C386 104 411 125 413 160L413 236L390 236L390 162C388 140 372 126 350 124C318 122 292 135 282 160C274 182 274 222 278 266Z';
const PT = 'M290 272C296 238 310 207 328 190C345 173 372 170 402 177L436 186L431 207L398 199C376 195 359 198 347 208C334 220 323 246 317 276Z';
const SVC = 'M194 104C194 96 226 96 226 104L230 238L196 244Z';
const CONDUCTION = [
  'M228 250C245 275 268 300 292 318',
  'M228 250C290 234 352 230 400 240',
  'M292 318C300 330 308 341 318 352',
  'M318 352C300 390 282 422 262 442',
  'M318 352C342 392 370 432 393 486',
  'M318 352C356 370 408 392 440 424',
  'M262 442l-18 10M262 442l4 20M393 486l-16 12M393 486l10 14M440 424l-6 22M440 424l14 8',
];
const CORONARIES = [
  'M348 262C358 330 368 420 390 505',
  'M262 292C240 320 232 360 245 400C258 432 290 458 330 478',
  'M352 258C382 246 422 250 450 282',
  'M356 318l30 22M362 372l34 18M366 424l26 14M242 352l-22 8M258 420l-20 14',
];

function Heart({ active, act, onSelect }) {
  const focus = act === 'tour' ? STOPS[active]?.id : null;
  const dim = id => Boolean(focus) && focus !== id;
  const is = id => focus === id;
  const select = index => onSelect ? () => onSelect(index) : undefined;

  return (
    <g className="eh-heart" filter="url(#eh-soft)">
      <Part id="shell" label="Heart muscle" active={is('shell')} dim={dim('shell')} dx={0} dy={152} s={0.82} onSelect={select(2)}>
        <path d={SHELL} fill="url(#eh-muscle)" />
        <g clipPath="url(#eh-shell-clip)" className="eh-fibres">
          {Array.from({ length: 16 }, (_, i) => (
            <path key={i} d={`M${170 + i * 22} 240C${230 + i * 20} 330 ${250 + i * 16} 420 ${240 + i * 14} 540`} />
          ))}
        </g>
        <path d={SHELL} className="eh-outline" />
      </Part>

      <Part id="atria-la" label="Atria" active={is('atria')} dim={dim('atria')} dx={200} dy={-120} s={1.35} onSelect={select(1)}>
        <path d={LA} fill="url(#eh-oxy)" />
        <path d={LA} fill="url(#eh-sheen)" />
        <path d={LA} className="eh-outline" />
      </Part>

      <Part id="vessels" label="Arteries and risk factors" active={is('vessels')} dim={dim('vessels')} dx={10} dy={-118} s={0.92} onSelect={select(5)}>
        <g fill="url(#eh-oxy)">
          <rect x="296" y="52" width="16" height="64" rx="8" />
          <rect x="326" y="44" width="15" height="62" rx="7.5" />
          <rect x="356" y="52" width="14" height="60" rx="7" />
        </g>
        <path d={AORTA} fill="url(#eh-oxy)" />
        <path d={AORTA} fill="url(#eh-sheen)" />
        <path d={AORTA} className="eh-outline" />
        <path d={SVC} fill="url(#eh-deoxy)" />
        <path d={SVC} className="eh-outline" />
      </Part>

      <Part id="atria-ra" label="Atria" active={is('atria')} dim={dim('atria')} dx={-190} dy={-45} s={1.05} onSelect={select(1)}>
        <path d={RA} fill="url(#eh-deoxy)" />
        <path d={RA} fill="url(#eh-sheen)" />
        <path d={RA} className="eh-outline" />
      </Part>

      <Part id="lv" label="Left ventricle" active={is('lv')} dim={dim('lv')} dx={190} dy={78} onSelect={select(3)}>
        <path d={LV} fill="url(#eh-oxy)" />
        <path d={LV} fill="url(#eh-sheen)" />
        <path d={LV} className="eh-outline" />
      </Part>

      <Part id="rv" label="Right ventricle" active={is('rv')} dim={dim('rv')} dx={-178} dy={112} onSelect={select(4)}>
        <path d={RV} fill="url(#eh-deoxy)" />
        <path d={RV} fill="url(#eh-sheen)" />
        <path d={RV} className="eh-outline" />
      </Part>

      <Part id="vessels-pt" label="Arteries and risk factors" active={is('vessels')} dim={dim('vessels')} dx={10} dy={-118} s={0.92} onSelect={select(5)}>
        <path d={PT} fill="url(#eh-deoxy)" />
        <path d={PT} fill="url(#eh-sheen)" />
        <path d={PT} className="eh-outline" />
        <g className="eh-coronary">
          {CORONARIES.map(d => <path key={d} d={d} />)}
        </g>
      </Part>

      <Part id="conduction" label="Electrical system" active={is('conduction')} dim={dim('conduction')} dx={0} dy={24} s={1.12} onSelect={select(0)}>
        <g className="eh-conduction" filter="url(#eh-glow)">
          {CONDUCTION.map(d => <path key={d} d={d} />)}
          <g className="eh-spark">
            {CONDUCTION.slice(0, 6).map(d => <path key={d} d={d} pathLength="100" />)}
          </g>
          <circle cx="228" cy="250" r="7" className="eh-node" />
          <circle cx="292" cy="318" r="6" className="eh-node" />
        </g>
      </Part>
    </g>
  );
}

function Probe({ stop, locked }) {
  if (!stop) return null;
  const [x, y] = stop.probe;
  const color = MODALITIES[stop.modalities[0]].color;
  return (
    <g className="eh-probe" style={{ transform: `translate(${x}px, ${y}px)`, '--probe': color }}>
      <circle r="46" className="eh-probe-halo" />
      <g>
        <circle r="34" className="eh-probe-ring" />
        <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="6s" repeatCount="indefinite" />
      </g>
      <g>
        <circle r="24" className="eh-probe-ring eh-probe-ring--inner" />
        <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="3.5s" repeatCount="indefinite" />
      </g>
      <path d="M-46 0h14M32 0h14M0 -46v14M0 32v14" className="eh-probe-ticks" />
      <circle r="3.5" className="eh-probe-dot" />
      <circle r="10" className="eh-probe-ping">
        <animate attributeName="r" from="10" to="58" dur="1.6s" repeatCount="indefinite" />
        <animate attributeName="opacity" from="0.8" to="0" dur="1.6s" repeatCount="indefinite" />
      </circle>
      <text y="-58" textAnchor="middle" className="eh-probe-text">{locked ? 'LOCKED' : 'SCANNING'}</text>
    </g>
  );
}

function FusionStreams({ visible }) {
  const streams = [
    { d: 'M-70 110C60 150 190 250 300 318', m: 'ECG', lx: -80, ly: 92 },
    { d: 'M670 110C540 150 420 250 312 318', m: 'MRI', lx: 680, ly: 92 },
    { d: 'M306 650C306 560 306 440 306 332', m: 'EHR', lx: 306, ly: 676 },
  ];
  return (
    <g className={`eh-fusion ${visible ? 'is-visible' : ''}`} aria-hidden="true">
      {streams.map(s => (
        <g key={s.m} style={{ '--c': MODALITIES[s.m].color }}>
          <path d={s.d} className="eh-stream-track" />
          <path d={s.d} className="eh-stream" pathLength="100" />
        </g>
      ))}
    </g>
  );
}

function EcgTrace({ visible }) {
  const beat = 'l18 0l6 -8l6 8l10 0l5 6l7 -62l7 76l6 -20l12 0l10 -14l12 14l30 0';
  return (
    <g className={`eh-trace ${visible ? 'is-visible' : ''}`} aria-hidden="true">
      <path d={`M-120 648${beat}${beat}${beat}${beat}${beat}${beat}`} pathLength="100" />
    </g>
  );
}

function InfoCard({ act, stop, index }) {
  if (act === 'tour' && stop) {
    return (
      <div className="eh-card" key={stop.id} aria-live="polite">
        <div className="eh-card-top">
          <span className="eh-count">{String(index + 1).padStart(2, '0')} / {String(STOPS.length).padStart(2, '0')}</span>
          <span className="eh-mods">
            {stop.modalities.map(m => (
              <span key={m} className="eh-mod" style={{ '--c': MODALITIES[m].color }}>{m}</span>
            ))}
          </span>
        </div>
        <p className="eh-kicker">{stop.kicker}</p>
        <h3>{stop.title}</h3>
        <p className="eh-body">{stop.body}</p>
        {stop.metrics && (
          <div className="eh-metrics">
            {stop.metrics.map(m => (
              <div key={m.label}>
                <b>{m.value}</b>
                <small>{m.label}</small>
              </div>
            ))}
          </div>
        )}
        {stop.chips && (
          <div className="eh-chips">{stop.chips.map(c => <span key={c}>{c}</span>)}</div>
        )}
        <p className={`eh-status ${stop.status.startsWith('In') ? 'is-pending' : ''}`}>{stop.status}</p>
      </div>
    );
  }
  if (act === 'fusion') {
    return (
      <div className="eh-card eh-card--fusion" key="fusion" aria-live="polite">
        <div className="eh-card-top">
          <span className="eh-count">FUSION</span>
          <span className="eh-mods">
            {Object.keys(MODALITIES).map(m => (
              <span key={m} className="eh-mod" style={{ '--c': MODALITIES[m].color }}>{m}</span>
            ))}
          </span>
        </div>
        <h3>{FUSION.title}</h3>
        <p className="eh-body">{FUSION.body}</p>
        <p className="eh-status is-pending">{FUSION.status}</p>
      </div>
    );
  }
  return (
    <div className="eh-card eh-card--intro" key="intro">
      <p className="eh-kicker">Multimodal by design</p>
      <h3>One heart. Three ways of seeing it.</h3>
      <p className="eh-body">An ECG hears its electricity. An MRI sees its shape. A health record knows the life around it. Keep scrolling to take it apart.</p>
      <div className="eh-legend">
        {Object.entries(MODALITIES).map(([k, v]) => (
          <span key={k} style={{ '--c': v.color }}><i />{k === 'ECG' ? 'Electrical' : k === 'MRI' ? 'Structural' : 'Clinical'}</span>
        ))}
      </div>
      <span className="eh-hint"><ArrowDown size={14} /> Scroll</span>
    </div>
  );
}

export function ExplodedHeart() {
  const sectionRef = useRef(null);
  const svgRef = useRef(null);
  const current = useRef({ act: 'intro', index: -1 });
  const [view, setView] = useState(current.current);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const section = sectionRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const p = clamp(-rect.top / (span || 1));
      section.style.setProperty('--p', p.toFixed(4));
      svgRef.current?.style.setProperty('--e', explosionAt(p).toFixed(4));
      const next = actAt(p);
      if (next.act !== current.current.act || next.index !== current.current.index) {
        current.current = next;
        setView(next);
      }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // The probe glides for ~0.8 s; only then does it report a lock.
  useEffect(() => {
    setLocked(false);
    if (view.act !== 'tour') return undefined;
    const timer = setTimeout(() => setLocked(true), 850);
    return () => clearTimeout(timer);
  }, [view.act, view.index]);

  const scrollToProgress = useCallback(p => {
    const section = sectionRef.current;
    if (!section) return;
    const top = section.getBoundingClientRect().top + window.scrollY;
    const span = section.offsetHeight - window.innerHeight;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: top + p * span, behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  const goToStop = useCallback(i => scrollToProgress(EXPLODE_END + (i + 0.5) * STOP_SPAN), [scrollToProgress]);

  const stop = view.act === 'tour' ? STOPS[view.index] : null;

  return (
    <section className={`eh-section act-${view.act}`} id="heart" ref={sectionRef} aria-label="Exploded view of the heart">
      <div className="eh-sticky">
        <div className="eh-progress" aria-hidden="true"><span /></div>
        <div className="eh-stage">
          <svg ref={svgRef} className="eh-svg" viewBox="-120 -40 840 740" role="img"
            aria-label="An anatomical heart that separates into its parts as you scroll">
            <HeartDefs />
            <g className="eh-grid" aria-hidden="true">
              <circle cx="306" cy="325" r="230" />
              <circle cx="306" cy="325" r="330" />
            </g>
            <FusionStreams visible={view.act === 'fusion'} />
            <g className="eh-beat">
              <Heart active={view.index} act={view.act} onSelect={goToStop} />
            </g>
            {stop && (
              <path
                key={`lead-${stop.id}`}
                className="eh-leader"
                d={`M${stop.probe[0]} ${stop.probe[1]}L${stop.probe[0] + 40} ${stop.probe[1] - 40}L720 ${stop.probe[1] - 40}`}
                style={{ '--c': MODALITIES[stop.modalities[0]].color }}
                pathLength="100"
              />
            )}
            <g className={`eh-fusion ${view.act === 'fusion' ? 'is-visible' : ''}`} aria-hidden="true">
              <circle cx="306" cy="330" r="64" fill="url(#eh-core)" className="eh-core" />
            </g>
            <Probe stop={stop} locked={locked} />
            <EcgTrace visible={view.act === 'intro'} />
          </svg>
        </div>

        <div className="eh-panel">
          <InfoCard act={view.act} stop={stop} index={view.index} />
          <nav className="eh-rail" aria-label="Parts of the heart">
            {STOPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={view.act === 'tour' && view.index === i ? 'is-current' : ''}
                style={{ '--c': MODALITIES[s.modalities[0]].color }}
                onClick={() => goToStop(i)}
                aria-label={`Show ${s.title}`}
                aria-current={view.act === 'tour' && view.index === i ? 'step' : undefined}
              >
                <i />
                <span>{s.title}</span>
              </button>
            ))}
            <button
              type="button"
              className={view.act === 'fusion' ? 'is-current' : ''}
              style={{ '--c': '#ffffff' }}
              onClick={() => scrollToProgress(0.97)}
              aria-label="Show fusion"
              aria-current={view.act === 'fusion' ? 'step' : undefined}
            >
              <i />
              <span>Fusion</span>
            </button>
          </nav>
        </div>
      </div>
    </section>
  );
}

export default ExplodedHeart;
