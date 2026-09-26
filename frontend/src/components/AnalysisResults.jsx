import React, { useEffect, useState } from 'react';
import { Activity, ArrowRight, CircleAlert, ClipboardList, FileText, Image, LineChart, Plus } from 'lucide-react';
import './analysis-results.css';

/*
 * Views over the backend's /api/analyze result. Every value shown comes from a
 * trained model or a guideline check in the backend; nothing here invents a score.
 */

const pct = p => `${Math.round(p * 100)}%`;
const LEVEL_TONE = { High: 'high', Moderate: 'moderate', Low: 'low' };
const DOT_TONE = { high: 'high', moderate: 'moderate', info: 'info', ok: 'ok' };

const MEASUREMENTS = [
  ['lv_end_diastolic_ml', 'LV volume, heart full', 'mL'],
  ['lv_end_systolic_ml', 'LV volume, heart squeezed', 'mL'],
  ['lv_ejection_fraction', 'LV ejection fraction', '%'],
  ['rv_end_diastolic_ml', 'RV volume, heart full', 'mL'],
  ['rv_ejection_fraction', 'RV ejection fraction', '%'],
  ['myocardial_mass_g', 'Heart muscle mass', 'g'],
  ['lv_volume_ml', 'LV volume', 'mL'],
  ['rv_volume_ml', 'RV volume', 'mL'],
  ['myo_volume_ml', 'Heart muscle volume', 'mL'],
];

function EmptyState({ title, text, setPage }) {
  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">NO ACTIVE ASSESSMENT</div>
          <h1>{title}</h1>
          <p>{text}</p>
        </div>
        {setPage && (
          <button className="primary" onClick={() => setPage('New Analysis')}>
            <Plus size={17} /> New analysis
          </button>
        )}
      </div>
    </>
  );
}

function Bars({ items, threshold = 0.5 }) {
  return (
    <div className="ar-bars">
      {items.map(item => (
        <div className="ar-bar" key={item.code}>
          <span>{item.label}</span>
          <div><i className={item.probability >= threshold ? 'is-over' : ''} style={{ width: pct(item.probability) }} /></div>
          <b>{pct(item.probability)}</b>
        </div>
      ))}
    </div>
  );
}

function Notes({ notes }) {
  if (!notes?.length) return null;
  return (
    <ul className="ar-notes">
      {notes.map(n => <li key={n}>{n}</li>)}
    </ul>
  );
}

function Evidence({ children }) {
  return children ? <p className="ar-evidence">{children}</p> : null;
}

export function ResultsView({ result, setPage }) {
  if (!result?.summary) {
    return <EmptyState setPage={setPage} title="Waiting for required inputs"
      text="Enter patient details and upload an ECG and a cardiac MRI to run the models." />;
  }
  const r = result;
  const { summary, ecg, mri, clinical } = r;
  const measurements = MEASUREMENTS.filter(([key]) => mri.measurements?.[key] !== undefined);

  return (
    <div className="ar">
      <div className="page-title">
        <div>
          <div className="eyebrow">ANALYSIS COMPLETE · {r.id}</div>
          <h1>Multimodal result</h1>
          <p>{r.patient_name} · {r.patient_age} · {r.patient_gender}</p>
        </div>
        <button className="secondary buttonlike" onClick={() => setPage('Reports')}>
          <FileText size={17} /> View report
        </button>
      </div>

      <section className={`ar-summary tone-${LEVEL_TONE[summary.attention]}`}>
        <div className="ar-level">
          <span>ATTENTION LEVEL</span>
          <b>{summary.attention}</b>
        </div>
        <div className="ar-reasons">
          <h2>Why</h2>
          <ul>
            {summary.reasons.map(item => (
              <li key={item.text}>
                <i className={`ar-dot ${DOT_TONE[item.level] || 'info'}`} />
                <em>{item.modality}</em>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
          <p className="ar-method">{summary.method}</p>
        </div>
      </section>

      <section className="ar-card">
        <header>
          <LineChart size={20} />
          <div>
            <h2>ECG</h2>
            <p>{ecg.source.type === 'image' ? 'Read from an image of a printout by the digitizer' : '12-lead signal'} · xresnet1d18 classifier, calibrated</p>
          </div>
        </header>
        <div className="ar-split">
          <div>
            <h3>Probability of each finding</h3>
            <Bars items={ecg.findings} />
            <p className="ar-sub">
              Explanation shown for <b>{ecg.explained_class.label}</b> ({pct(ecg.explained_class.probability)}). Leads relied on most:{' '}
              {ecg.leads_most_relied_on.map(l => `${l.lead} (${pct(l.share)})`).join(', ')}.
            </p>
            <Notes notes={ecg.notes} />
            <Evidence>{ecg.evidence} {ecg.source.evidence}</Evidence>
          </div>
          <figure className="ar-figure">
            <img src={ecg.attribution_image} alt={`Twelve-lead ECG with Integrated Gradients attribution for ${ecg.explained_class.label}`} />
            <figcaption>Integrated Gradients: red marks the parts of the signal that pushed the model towards this finding.</figcaption>
          </figure>
        </div>
      </section>

      <section className="ar-card">
        <header>
          <Image size={20} />
          <div>
            <h2>Cardiac MRI</h2>
            <p>2.5D U-Net segmentation{mri.diagnosis ? ' · diagnosis from heart measurements' : ''}</p>
          </div>
        </header>
        <div className="ar-split">
          <div>
            {measurements.length > 0 && (
              <>
                <h3>Measurements</h3>
                <table className="ar-table">
                  <tbody>
                    {measurements.map(([key, label, unit]) => (
                      <tr key={key}>
                        <td>{label}</td>
                        <td><b>{mri.measurements[key]}</b> {unit}
                          {key === 'lv_ejection_fraction' && mri.measurements.lv_ejection_fraction_category && (
                            <span className={`ar-chip ef-${mri.measurements.lv_ejection_fraction_category.replace(' ', '-')}`}>
                              {mri.measurements.lv_ejection_fraction_category}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {mri.diagnosis && (
              <>
                <h3>Diagnosis from measurements</h3>
                <Bars items={mri.diagnosis.probabilities} />
                <p className="ar-sub">Because:</p>
                <ul className="ar-because">
                  {mri.diagnosis.because.map(b => <li key={b}>{b}</li>)}
                </ul>
                <Evidence>{mri.diagnosis.evidence}</Evidence>
              </>
            )}
            <Notes notes={mri.notes} />
            <Evidence>{mri.evidence}</Evidence>
          </div>
          <figure className="ar-figure">
            <img src={mri.segmentation_image} alt="Cardiac MRI with the model's outline of the ventricles and heart muscle" />
            <figcaption>The model's outline. Every measurement on the left is computed from these outlines.</figcaption>
          </figure>
        </div>
      </section>

      <section className="ar-card">
        <header>
          <ClipboardList size={20} />
          <div>
            <h2>Clinical values</h2>
            <p>{clinical.method}</p>
          </div>
        </header>
        <ul className="ar-flags">
          {clinical.flags.map(f => (
            <li key={f.item + f.text}>
              <i className={`ar-dot ${DOT_TONE[f.level] || 'info'}`} />
              <b>{f.item}</b>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="ar-disclaimer"><CircleAlert size={15} /> {r.disclaimer}</p>
    </div>
  );
}

export function buildReport(r) {
  const line = '-'.repeat(60);
  const out = [
    'CARDIAC NEXUS - MULTIMODAL ANALYSIS REPORT',
    line,
    `Analysis ID : ${r.id}`,
    `Date        : ${new Date(r.created_at).toLocaleString()}`,
    `Patient     : ${r.patient_name}, ${r.patient_age}, ${r.patient_gender}`,
    '',
    `ATTENTION LEVEL: ${r.summary.attention}`,
    ...r.summary.reasons.map(x => `  - [${x.modality}] ${x.text}`),
    `  Method: ${r.summary.method}`,
    '',
    'ECG',
    ...r.ecg.findings.map(f => `  ${f.label.padEnd(26)} ${pct(f.probability).padStart(5)}`),
    `  Leads relied on most: ${r.ecg.leads_most_relied_on.map(l => l.lead).join(', ')}`,
    ...(r.ecg.notes || []).map(n => `  Note: ${n}`),
    `  ${r.ecg.evidence}`,
    '',
    'CARDIAC MRI',
    ...MEASUREMENTS.filter(([k]) => r.mri.measurements?.[k] !== undefined)
      .map(([k, label, unit]) => `  ${label.padEnd(28)} ${r.mri.measurements[k]} ${unit}`),
    ...(r.mri.diagnosis ? [
      '  Diagnosis from measurements:',
      ...r.mri.diagnosis.probabilities.map(d => `    ${d.label.padEnd(32)} ${pct(d.probability).padStart(5)}`),
      '  Because:',
      ...r.mri.diagnosis.because.map(b => `    - ${b}`),
    ] : []),
    ...(r.mri.notes || []).map(n => `  Note: ${n}`),
    `  ${r.mri.evidence}`,
    '',
    'CLINICAL VALUES',
    ...r.clinical.flags.map(f => `  ${f.item}: ${f.text}`),
    '',
    line,
    r.disclaimer,
  ];
  return out.join('\n');
}

const STATUS_TEXT = { high: 'Needs attention', moderate: 'Raised', info: 'Information', ok: 'Normal' };

function ReportBars({ items }) {
  return (
    <table className="rp-table">
      <thead><tr><th>Finding</th><th>Probability</th><th /></tr></thead>
      <tbody>
        {items.map(item => {
          const over = item.probability >= 0.5;
          return (
            <tr key={item.code} className={over ? 'is-over' : ''}>
              <td>{item.label}</td>
              <td className="rp-num">{pct(item.probability)}</td>
              <td className="rp-barcell"><span className="rp-bar"><i style={{ width: pct(item.probability) }} /></span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ReportView({ result }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  if (!result?.summary) {
    return <EmptyState title="No active report" text="Reports are generated after an analysis has run." />;
  }
  const r = result;
  const { summary, ecg, mri, clinical, inputs = {} } = r;
  const measurements = MEASUREMENTS.filter(([key]) => mri.measurements?.[key] !== undefined);
  const created = r.created_at ? new Date(r.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '-';

  const downloadPdf = async () => {
    setDownloading(true);
    setError('');
    try {
      const resp = await fetch('/api/report.pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r),
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || 'Could not create the PDF');
      const url = URL.createObjectURL(await resp.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `cardiac-nexus-report-${r.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  const downloadText = () => {
    const url = URL.createObjectURL(new Blob([buildReport(r)], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `cardiac-nexus-report-${r.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">MULTIMODAL ANALYSIS REPORT</div>
          <h1>Report preview</h1>
          <p>This is the report as it appears in the downloaded PDF (A4).</p>
        </div>
        <div className="rp-actions">
          <button className="secondary buttonlike" onClick={downloadText}><FileText size={16} /> Text</button>
          <button className="primary" onClick={downloadPdf} disabled={downloading}>
            <FileText size={17} /> {downloading ? 'Preparing PDF…' : 'Download PDF'}
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      <article className="rp-sheet">
        <header className="rp-head">
          <div className="rp-brand">
            <img src="/logo.png" alt="" />
            <div>
              <b>Cardiac <span>Nexus</span></b>
              <small>EXPLAINABLE CARDIOVASCULAR AI</small>
            </div>
          </div>
          <div className="rp-inst">
            <div>
              <b>Multimodal Analysis Report</b>
              <small>SJC Institute of Technology</small>
            </div>
            <img src="/sjcit-logo.png" alt="" />
          </div>
        </header>

        <h1 className="rp-title">Multimodal Cardiovascular Analysis</h1>
        <dl className="rp-info">
          <div><dt>Patient</dt><dd>{r.patient_name}</dd></div>
          <div><dt>Age / Sex</dt><dd>{r.patient_age} / {r.patient_gender}</dd></div>
          <div><dt>Height / Weight</dt><dd>{inputs.height_cm && inputs.weight_kg ? `${inputs.height_cm} cm, ${inputs.weight_kg} kg` : '-'}</dd></div>
          <div><dt>Analysis date</dt><dd>{created}</dd></div>
          <div><dt>Analysis ID</dt><dd className="rp-light">{r.id}</dd></div>
          <div><dt>ECG file</dt><dd className="rp-light">{inputs.ecg_file || '-'}</dd></div>
          <div className="rp-wide"><dt>MRI file(s)</dt><dd className="rp-light">{(inputs.mri_files || []).join(', ') || '-'}</dd></div>
        </dl>

        <h2>1. Summary</h2>
        <div className={`rp-summary tone-${LEVEL_TONE[summary.attention]}`}>
          <div className="rp-level"><small>ATTENTION LEVEL</small><b>{summary.attention}</b></div>
          <ul>
            {summary.reasons.map(item => (
              <li key={item.text}>
                <i className={`ar-dot ${DOT_TONE[item.level] || 'info'}`} />
                <em>{item.modality}</em>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="rp-small">{summary.method}</p>

        <h2>2. Clinical values</h2>
        <p className="rp-small">{clinical.method}</p>
        <table className="rp-table">
          <thead><tr><th>Item</th><th>Finding</th><th>Status</th></tr></thead>
          <tbody>
            {clinical.flags.map(f => (
              <tr key={f.item + f.text}>
                <td><b>{f.item}</b></td>
                <td>{f.text}</td>
                <td className="rp-status"><i className={`ar-dot ${DOT_TONE[f.level] || 'info'}`} /> {STATUS_TEXT[f.level] || f.level}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>3. ECG analysis</h2>
        <p className="rp-small">
          Input: {ecg.source.type === 'image' ? 'read from an image of a printout by the digitizer' : '12-lead signal'}.
          Model: xresnet1d18 classifier over five diagnostic findings, with calibrated probabilities.
        </p>
        <ReportBars items={ecg.findings} />
        <p className="rp-body">
          Explanation shown for <b>{ecg.explained_class.label}</b> ({pct(ecg.explained_class.probability)}). Leads the model
          relied on most: {ecg.leads_most_relied_on.map(l => `${l.lead} (${pct(l.share)})`).join(', ')}.
        </p>
        <figure className="rp-figure">
          <img src={ecg.attribution_image} alt={`Integrated Gradients for ${ecg.explained_class.label}`} />
          <figcaption>Integrated Gradients: red shading marks the parts of each lead that pushed the model towards the finding; blue marks parts that argued against it.</figcaption>
        </figure>
        {(ecg.notes || []).map(n => <p className="rp-note" key={n}>Note: {n}</p>)}
        <p className="rp-small">{ecg.evidence} {ecg.source.evidence}</p>

        <h2>4. Cardiac MRI analysis</h2>
        <p className="rp-small">Model: 2.5D U-Net segmentation of the left ventricle, right ventricle and heart muscle. Every measurement is computed from the model's outlines.</p>
        {measurements.length > 0 && (
          <table className="rp-table">
            <thead><tr><th>Measurement</th><th>Value</th><th>Reference</th></tr></thead>
            <tbody>
              {measurements.map(([key, label, unit]) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td><b>{mri.measurements[key]} {unit}</b></td>
                  <td>{key === 'lv_ejection_fraction' ? `50% or above is normal · ${mri.measurements.lv_ejection_fraction_category || ''}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {mri.diagnosis && (
          <>
            <h3>Diagnosis from heart measurements</h3>
            <ReportBars items={mri.diagnosis.probabilities} />
            <p className="rp-body">Because:</p>
            <ul className="rp-list">{mri.diagnosis.because.map(b => <li key={b}>{b}</li>)}</ul>
            <p className="rp-small">{mri.diagnosis.evidence}</p>
          </>
        )}
        <figure className="rp-figure rp-figure--narrow">
          <img src={mri.segmentation_image} alt="Cardiac MRI with the model's outline" />
          <figcaption>The model's outline: red right ventricle, dark blue heart muscle, teal left ventricle.</figcaption>
        </figure>
        {(mri.notes || []).map(n => <p className="rp-note" key={n}>Note: {n}</p>)}
        <p className="rp-small">{mri.evidence}</p>

        <h2>5. Review and important notice</h2>
        <p className="rp-body">{r.disclaimer}</p>
        <p className="rp-small">This report is generated by a research prototype built as a final-year engineering project. The figures are model outputs that must be reviewed by a qualified clinician before any use.</p>
        <div className="rp-sign">
          <div><small>Reviewed by (clinician)</small></div>
          <div><small>Signature</small></div>
          <div><small>Date</small></div>
        </div>

        <footer className="rp-foot">
          <span>Research prototype. Not a medical device and not a medical prescription.<br />Analysis {r.id}</span>
          <span>Cardiac Nexus</span>
        </footer>
      </article>
    </>
  );
}

export function HistoryView({ token, setResult, setPage }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  useEffect(() => {
    let alive = true;
    fetch('/api/analyses', { headers, credentials: 'same-origin' })
      .then(async resp => {
        if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || 'Could not load history');
        return resp.json();
      })
      .then(data => { if (alive) setRows(data); })
      .catch(err => { if (alive) setError(err.message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const open = async id => {
    const resp = await fetch(`/api/analyses/${id}`, { headers, credentials: 'same-origin' });
    if (resp.ok) {
      setResult(await resp.json());
      setPage('Results');
    }
  };

  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">ASSESSMENT HISTORY</div>
          <h1>Past analyses</h1>
          <p>Analyses you have run while signed in. Select one to reopen its full result.</p>
        </div>
        <button className="primary" onClick={() => setPage('New Analysis')}>
          <Plus size={17} /> New analysis
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {!error && rows === null && <p className="ar-sub">Loading…</p>}
      {rows && rows.length === 0 && (
        <div className="empty"><Activity size={34} /><h1>No analyses yet</h1><p>Run a new analysis and it will appear here.</p></div>
      )}
      {rows && rows.length > 0 && (
        <section className="recent">
          <table>
            <thead>
              <tr><th>Analysis ID</th><th>Date</th><th>Patient</th><th>Attention</th><th /></tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="ar-row" onClick={() => open(row.id)}>
                  <td><b>{row.id}</b></td>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>{row.patient_name} ({row.patient_age}, {row.patient_gender})</td>
                  <td><span className={`ar-chip level-${LEVEL_TONE[row.attention]}`}>{row.attention}</span></td>
                  <td><ArrowRight size={15} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

