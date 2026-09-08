/* =============================================================================
   charts.js — small SVG charts, hand-built.
   -----------------------------------------------------------------------------
   No charting library. Four charts with four different jobs do not share enough
   structure to justify one, and hand-built SVG inherits the page's CSS variables
   directly — which is what lets every chart flip to paper mode without a single
   line of theme-handling code.
   ========================================================================== */
(function (global) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, text) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  const clear = (svg) => { while (svg.firstChild) svg.removeChild(svg.firstChild); };

  /* Map a value in [d0,d1] onto [r0,r1] */
  const scale = (v, d0, d1, r0, r1) => r0 + (v - d0) / (d1 - d0) * (r1 - r0);

  function frame(svg, pad) {
    const vb = svg.getAttribute('viewBox').split(' ').map(Number);
    return { w: vb[2], h: vb[3],
             x0: pad.l, x1: vb[2] - pad.r, y0: vb[3] - pad.b, y1: pad.t };
  }

  /* ── Training history: two losses on the left axis, AUROC on the right ── */
  function history(svg, data) {
    clear(svg);
    const f = frame(svg, { l: 38, r: 42, t: 18, b: 30 });
    const es = data.map(d => d.e);
    const e0 = Math.min(...es), e1 = Math.max(...es);
    const losses = data.flatMap(d => [d.tr, d.va]);
    const l0 = Math.min(...losses) * 0.92, l1 = Math.max(...losses) * 1.04;
    const aucs = data.map(d => d.auc);
    const a0 = Math.min(...aucs) - 0.004, a1 = Math.max(...aucs) + 0.004;

    const X = e => scale(e, e0, e1, f.x0, f.x1);
    const YL = v => scale(v, l0, l1, f.y0, f.y1);
    const YA = v => scale(v, a0, a1, f.y0, f.y1);

    // horizontal gridlines
    for (let i = 0; i <= 4; i++) {
      const y = f.y1 + (f.y0 - f.y1) * (i / 4);
      svg.appendChild(el('line', { x1: f.x0, x2: f.x1, y1: y, y2: y, class: 'ch-grid' }));
      svg.appendChild(el('text', { x: f.x0 - 6, y: y + 3, class: 'ch-tick', 'text-anchor': 'end' },
        (l1 - (l1 - l0) * (i / 4)).toFixed(2)));
    }
    // right axis: AUROC
    for (let i = 0; i <= 3; i++) {
      const y = f.y1 + (f.y0 - f.y1) * (i / 3);
      svg.appendChild(el('text', { x: f.x1 + 6, y: y + 3, class: 'ch-tick' },
        (a1 - (a1 - a0) * (i / 3)).toFixed(3)));
    }
    svg.appendChild(el('line', { x1: f.x0, x2: f.x1, y1: f.y0, y2: f.y0, class: 'ch-axis' }));

    const line = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    svg.appendChild(el('path', { d: line(data.map(d => [X(d.e), YL(d.tr)])), class: 'ch-train' }));
    svg.appendChild(el('path', { d: line(data.map(d => [X(d.e), YL(d.va)])), class: 'ch-val' }));
    svg.appendChild(el('path', { d: line(data.map(d => [X(d.e), YA(d.auc)])), class: 'ch-auc' }));

    // annotate the two epochs the caption talks about
    const best = data.reduce((a, b) => (b.auc > a.auc ? b : a));
    const minVal = data.reduce((a, b) => (b.va < a.va ? b : a));
    [[minVal.e, 'val loss floor'], [best.e, 'AUROC peak — checkpoint']].forEach(([e, label], i) => {
      const x = X(e);
      svg.appendChild(el('line', { x1: x, x2: x, y1: f.y1, y2: f.y0, class: 'ch-marker' }));
      // Flip the label to the left of its marker when it would run off the
      // right edge, rather than letting it clip.
      const flip = x > f.x1 - 130;
      svg.appendChild(el('text', {
        x: x + (flip ? -4 : 4), y: f.y1 + 10 + i * 12,
        class: 'ch-note', 'text-anchor': flip ? 'end' : 'start'
      }, `e${e} · ${label}`));
    });

    svg.appendChild(el('text', { x: f.x0, y: f.h - 6, class: 'ch-lab' }, 'Epoch'));
    // legend
    const legend = [['ch-train', 'train loss'], ['ch-val', 'val loss'], ['ch-auc', 'val macro AUROC']];
    legend.forEach(([cls, name], i) => {
      const x = f.x0 + 62 + i * 118;
      svg.appendChild(el('line', { x1: x, x2: x + 14, y1: f.h - 9, y2: f.h - 9, class: cls }));
      svg.appendChild(el('text', { x: x + 19, y: f.h - 6, class: 'ch-lab' }, name));
    });
  }

  /* ── Reliability diagram ────────────────────────────────────────────── */
  function reliability(svg, raw, cal, showCal) {
    clear(svg);
    const f = frame(svg, { l: 40, r: 18, t: 18, b: 34 });
    const X = v => scale(v, 0, 1, f.x0, f.x1);
    const Y = v => scale(v, 0, 1, f.y0, f.y1);

    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      svg.appendChild(el('line', { x1: f.x0, x2: f.x1, y1: Y(t), y2: Y(t), class: 'ch-grid' }));
      svg.appendChild(el('text', { x: f.x0 - 6, y: Y(t) + 3, class: 'ch-tick', 'text-anchor': 'end' }, t.toFixed(1)));
      svg.appendChild(el('text', { x: X(t), y: f.y0 + 13, class: 'ch-tick', 'text-anchor': 'middle' }, t.toFixed(1)));
    }

    // bin population, so the reader sees where the mass actually is
    const maxN = Math.max(...raw.map(b => b.n));
    raw.forEach(b => {
      const h = (b.n / maxN) * (f.y0 - f.y1) * 0.3;
      svg.appendChild(el('rect', {
        x: X(b.lo) + 1, y: f.y0 - h, width: Math.max(2, X(0.1) - X(0) - 2), height: h, class: 'ch-bin'
      }));
    });

    // the diagonal: perfect calibration
    svg.appendChild(el('line', { x1: X(0), y1: Y(0), x2: X(1), y2: Y(1), class: 'ch-diag' }));
    svg.appendChild(el('line', { x1: f.x0, x2: f.x1, y1: f.y0, y2: f.y0, class: 'ch-axis' }));
    svg.appendChild(el('line', { x1: f.x0, x2: f.x0, y1: f.y0, y2: f.y1, class: 'ch-axis' }));

    const path = (bins) => bins.map((b, i) =>
      (i ? 'L' : 'M') + X(b.conf).toFixed(1) + ' ' + Y(b.obs).toFixed(1)).join('');

    const rawEl = el('path', { d: path(raw), class: 'ch-raw' });
    svg.appendChild(rawEl);
    raw.forEach(b => svg.appendChild(el('circle',
      { cx: X(b.conf), cy: Y(b.obs), r: 2.6, class: 'ch-dot' })));

    if (showCal) {
      svg.appendChild(el('path', { d: path(cal), class: 'ch-cal' }));
      cal.forEach(b => svg.appendChild(el('circle',
        { cx: X(b.conf), cy: Y(b.obs), r: 2.6, fill: 'var(--infer)' })));
      rawEl.setAttribute('opacity', '0.32');
    }

    svg.appendChild(el('text', { x: f.x0, y: f.h - 6, class: 'ch-lab' }, 'Predicted probability'));
    svg.appendChild(el('text', { x: 10, y: f.y1 + 4, class: 'ch-lab',
      transform: `rotate(-90 10 ${f.y1 + 4})`, 'text-anchor': 'end' }, 'Observed'));
  }

  /* ── Parameters against score, log x ────────────────────────────────── */
  function scatter(svg, runs) {
    clear(svg);
    const f = frame(svg, { l: 44, r: 90, t: 20, b: 32 });
    const lp = runs.map(r => Math.log10(r.params));
    const p0 = Math.min(...lp) - 0.25, p1 = Math.max(...lp) + 0.25;
    const aucs = runs.map(r => r.test);
    const a0 = Math.min(...aucs) - 0.004, a1 = Math.max(...aucs) + 0.004;
    const X = v => scale(Math.log10(v), p0, p1, f.x0, f.x1);
    const Y = v => scale(v, a0, a1, f.y0, f.y1);

    for (let i = 0; i <= 4; i++) {
      const t = i / 4, y = f.y0 + (f.y1 - f.y0) * t;
      svg.appendChild(el('line', { x1: f.x0, x2: f.x1, y1: y, y2: y, class: 'ch-grid' }));
      svg.appendChild(el('text', { x: f.x0 - 6, y: y + 3, class: 'ch-tick', 'text-anchor': 'end' },
        (a0 + (a1 - a0) * t).toFixed(3)));
    }
    // decade ticks
    for (let d = Math.ceil(p0); d <= Math.floor(p1); d++) {
      const x = scale(d, p0, p1, f.x0, f.x1);
      svg.appendChild(el('line', { x1: x, x2: x, y1: f.y0, y2: f.y1, class: 'ch-grid' }));
      svg.appendChild(el('text', { x, y: f.y0 + 13, class: 'ch-tick', 'text-anchor': 'middle' },
        d >= 6 ? (10 ** (d - 6)) + 'M' : (10 ** (d - 3)) + 'K'));
    }
    svg.appendChild(el('line', { x1: f.x0, x2: f.x1, y1: f.y0, y2: f.y0, class: 'ch-axis' }));

    runs.forEach(r => {
      const x = X(r.params), y = Y(r.test);
      svg.appendChild(el('circle', { cx: x, cy: y, r: r.best ? 5.5 : 4,
        class: r.published ? 'ch-dot--pub' : 'ch-dot' }));
      const anchor = x > f.x1 - 70 ? 'end' : 'start';
      svg.appendChild(el('text',
        { x: x + (anchor === 'end' ? -9 : 9), y: y + 3, class: 'ch-note', 'text-anchor': anchor },
        r.arch));
    });
    svg.appendChild(el('text', { x: f.x0, y: f.h - 6, class: 'ch-lab' }, 'Parameters (log scale)'));
    svg.appendChild(el('text', { x: f.x1, y: f.h - 6, class: 'ch-lab', 'text-anchor': 'end' },
      'hollow = published benchmark'));
  }

  /* ── Attribution: two correlation distributions on one axis ─────────── */
  function attribution(svg, attr) {
    clear(svg);
    const f = frame(svg, { l: 42, r: 20, t: 30, b: 40 });
    const X = v => scale(v, -0.25, 1, f.x0, f.x1);
    const mid = (f.y0 + f.y1) / 2;

    // axis with ticks
    svg.appendChild(el('line', { x1: f.x0, x2: f.x1, y1: mid, y2: mid, class: 'ch-axis' }));
    [-0.25, 0, 0.25, 0.5, 0.75, 1].forEach(t => {
      svg.appendChild(el('line', { x1: X(t), x2: X(t), y1: mid - 5, y2: mid + 5, class: 'ch-grid' }));
      svg.appendChild(el('text', { x: X(t), y: mid + 20, class: 'ch-tick', 'text-anchor': 'middle' }, t.toFixed(2)));
    });
    // zero line, emphasised: it is the number that matters
    svg.appendChild(el('line', { x1: X(0), x2: X(0), y1: f.y1, y2: f.y0, class: 'ch-diag' }));

    const band = (items, y, cls, label, valueKey) => {
      items.forEach(e => {
        svg.appendChild(el('circle',
          { cx: X(e[valueKey]), cy: y, r: 4, class: cls, opacity: 0.75 }));
      });
      const mean = items.reduce((s, e) => s + e[valueKey], 0) / items.length;
      svg.appendChild(el('line',
        { x1: X(mean), x2: X(mean), y1: y - 13, y2: y + 13, class: cls === 'ch-dot' ? 'ch-val' : 'ch-auc' }));
      svg.appendChild(el('text', { x: f.x0, y: y - 20, class: 'ch-lab' }, label));
      svg.appendChild(el('text', { x: X(mean), y: y + 26, class: 'ch-note', 'text-anchor': 'middle' },
        'mean ' + mean.toFixed(3)));
      return mean;
    };

    band(attr.examples, f.y1 + 26, 'ch-dot--pub', 'IG vs SmoothGrad — self-consistency', 'ig_sg');
    band(attr.examples, f.y0 - 34, 'ch-dot', 'IG vs randomised weights — the sanity check', 'rand');
    svg.appendChild(el('text', { x: f.x1, y: f.h - 6, class: 'ch-lab', 'text-anchor': 'end' },
      'Spearman correlation'));
  }

  global.Charts = { history, reliability, scatter, attribution, el, clear };
})(window);
