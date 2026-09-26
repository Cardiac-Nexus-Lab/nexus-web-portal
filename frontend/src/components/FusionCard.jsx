import React from 'react';
import { Activity } from 'lucide-react';
import './fusion-card.css';

/*
 * Hero card: three inputs, each with a small live preview of what it carries,
 * streaming into one fusion core. The diagram is a single SVG so every row,
 * connector and the core stay aligned at any card width.
 */

const ROWS = [
  { key: 'ecg', y: 50, label: 'ECG', sub: '12 leads', color: '#5ee6e8' },
  { key: 'mri', y: 150, label: 'MRI', sub: 'Heart scan', color: '#b69cff' },
  { key: 'ehr', y: 250, label: 'EHR', sub: 'Clinical data', color: '#fbbf5a' },
];

const CORE = { x: 432, y: 150 };
const BEAT = 'l10 0l4 -5l4 5l6 0l3 4l4 -30l4 38l4 -12l8 0l6 -8l7 8l14 0';

function EcgPreview({ y }) {
  return (
    <g clipPath="url(#fc-clip-ecg)">
      <g className="fc-ecg-scroll">
        <path d={`M132 ${y + 6}${BEAT}${BEAT}${BEAT}${BEAT}`} className="fc-ecg" />
      </g>
    </g>
  );
}

function MriPreview({ y }) {
  const cx = 176;
  return (
    <g>
      <path d={`M${cx - 22} ${y - 12}C${cx - 38} ${y - 4} ${cx - 38} ${y + 14} ${cx - 20} ${y + 18}C${cx - 26} ${y + 6} ${cx - 26} ${y - 4} ${cx - 22} ${y - 12}Z`} className="fc-mri-rv" />
      <circle cx={cx} cy={y + 2} r="17" className="fc-mri-wall" />
      <circle cx={cx} cy={y + 2} r="10" className="fc-mri-cavity" />
      <g clipPath="url(#fc-clip-mri)">
        <rect x={cx - 40} y={y - 22} width="80" height="3" className="fc-mri-scan" />
      </g>
    </g>
  );
}

function EhrPreview({ y }) {
  const bars = [
    { w: 52, d: '0s' },
    { w: 38, d: '0.4s' },
    { w: 64, d: '0.8s' },
  ];
  return (
    <g>
      {bars.map((b, i) => (
        <g key={i}>
          <rect x="138" y={y - 12 + i * 11} width="68" height="5" rx="2.5" className="fc-ehr-track" />
          <rect x="138" y={y - 12 + i * 11} width={b.w} height="5" rx="2.5" className="fc-ehr-bar" style={{ animationDelay: b.d }} />
        </g>
      ))}
    </g>
  );
}

const PREVIEWS = { ecg: EcgPreview, mri: MriPreview, ehr: EhrPreview };

export function FusionCard() {
  return (
    <div className="fc">
      <div className="fc-head">
        <span className="fc-icon"><Activity size={22} /></span>
        <div>
          <b>Multimodal analysis</b>
          <small>Three views, one heart</small>
        </div>
        <span className="fc-live"><i />Live</span>
      </div>

      <svg className="fc-diagram" viewBox="0 0 520 300" role="img"
        aria-label="ECG, MRI and health-record inputs flowing into a single fusion model">
        <defs>
          <clipPath id="fc-clip-ecg"><rect x="132" y="20" width="80" height="60" /></clipPath>
          <clipPath id="fc-clip-mri"><circle cx="176" cy="152" r="20" /></clipPath>
          <radialGradient id="fc-core" cx="40%" cy="35%" r="75%">
            <stop offset="0%" stopColor="#8ff5f2" />
            <stop offset="55%" stopColor="#1a8f9c" />
            <stop offset="100%" stopColor="#0c4f5c" />
          </radialGradient>
          <linearGradient id="fc-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5ee6e8" />
            <stop offset="50%" stopColor="#b69cff" />
            <stop offset="100%" stopColor="#fbbf5a" />
          </linearGradient>
        </defs>

        {ROWS.map(row => {
          const d = `M220 ${row.y}C302 ${row.y} 322 ${CORE.y} ${CORE.x - 50} ${CORE.y}`;
          return (
            <g key={`link-${row.key}`} style={{ '--c': row.color }}>
              <path d={d} className="fc-link-track" />
              <path d={d} className="fc-link" pathLength="100" />
            </g>
          );
        })}

        {ROWS.map(row => {
          const Preview = PREVIEWS[row.key];
          return (
            <g key={row.key} className="fc-row" style={{ '--c': row.color }}>
              <rect x="0" y={row.y - 38} width="220" height="76" rx="16" className="fc-row-box" />
              <circle cx="24" cy={row.y} r="5" className="fc-row-dot" />
              <text x="44" y={row.y - 4} className="fc-row-label">{row.label}</text>
              <text x="44" y={row.y + 17} className="fc-row-sub">{row.sub}</text>
              <Preview y={row.y} />
            </g>
          );
        })}

        <g className="fc-core-group">
          <circle cx={CORE.x} cy={CORE.y} r="60" className="fc-orbit" />
          <circle cx={CORE.x} cy={CORE.y} r="47" className="fc-halo" />
          <circle cx={CORE.x} cy={CORE.y} r="36" className="fc-pulse" />
          <circle cx={CORE.x} cy={CORE.y} r="36" fill="url(#fc-core)" className="fc-core" />
          {/* Heartbeat blip, drawn across the core once per beat */}
          <path className="fc-beatline-track" d={`M${CORE.x + -24} ${CORE.y + 0}L${CORE.x + -12} ${CORE.y + 0}L${CORE.x + -8} ${CORE.y + -5}L${CORE.x + -5} ${CORE.y + 0}L${CORE.x + -2} ${CORE.y + 0}L${CORE.x + 2} ${CORE.y + -19}L${CORE.x + 7} ${CORE.y + 15}L${CORE.x + 11} ${CORE.y + 0}L${CORE.x + 15} ${CORE.y + 0}L${CORE.x + 18} ${CORE.y + -4}L${CORE.x + 21} ${CORE.y + 0}L${CORE.x + 24} ${CORE.y + 0}`} />
          <path className="fc-beatline" d={`M${CORE.x + -24} ${CORE.y + 0}L${CORE.x + -12} ${CORE.y + 0}L${CORE.x + -8} ${CORE.y + -5}L${CORE.x + -5} ${CORE.y + 0}L${CORE.x + -2} ${CORE.y + 0}L${CORE.x + 2} ${CORE.y + -19}L${CORE.x + 7} ${CORE.y + 15}L${CORE.x + 11} ${CORE.y + 0}L${CORE.x + 15} ${CORE.y + 0}L${CORE.x + 18} ${CORE.y + -4}L${CORE.x + 21} ${CORE.y + 0}L${CORE.x + 24} ${CORE.y + 0}`} pathLength="100" />
          <text x={CORE.x} y={CORE.y + 86} className="fc-core-label">Fusion</text>
          <text x={CORE.x} y={CORE.y + 106} className="fc-core-sub">One patient view</text>
        </g>
      </svg>
    </div>
  );
}

export default FusionCard;
