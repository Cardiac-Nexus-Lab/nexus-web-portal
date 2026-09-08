/* =============================================================================
   main.js — scroll orchestration and section wiring.
   ========================================================================== */
(function () {
  'use strict';

  const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stored = localStorage.getItem('cn-motion');
  let motionOn = stored ? stored === 'full' : !prefersReduced;

  gsap.registerPlugin(ScrollTrigger);

  /* ?static=1 renders the finished page with no motion and no scroll
     dependence: every element in its end state, every canvas drawn once.
     It is what a print stylesheet, a screenshot, or a reader whose browser
     never fires an animation frame should get. */
  const STATIC = new URLSearchParams(location.search).has('static');
  if (STATIC) { motionOn = false; document.documentElement.dataset.static = '1'; }

  /* ?only=<section-id> isolates one section at the top of the document.
     Used for review and for capturing a single chapter without scrolling. */
  const ONLY = new URLSearchParams(location.search).get('only');
  if (ONLY) {
    document.querySelectorAll('.page > section, .page > footer').forEach((el) => {
      if (el.id !== ONLY) el.style.display = 'none';
    });
    // Show the bar rather than hide it: it is chrome that belongs on every
    // chapter, so an isolated chapter should be reviewed with it in place.
    document.querySelector('.rail').classList.add('is-on');
  }

  /* Animate `targets` into view on scroll, or simply place them there. */
  function enter(targets, vars, trigger, start) {
    if (STATIC) { gsap.set(targets, { opacity: 1, x: 0, y: 0, scaleX: 1, clearProps: 'transform' }); return; }
    gsap.to(targets, Object.assign({ opacity: 1, x: 0, y: 0 }, vars, {
      scrollTrigger: { trigger: trigger || targets, start: start || 'top 88%' }
    }));
  }
  function enterFrom(targets, vars, trigger, start) {
    if (STATIC) { gsap.set(targets, { opacity: 1, x: 0, y: 0, clearProps: 'transform' }); return; }
    gsap.from(targets, Object.assign({}, vars, {
      scrollTrigger: { trigger: trigger, start: start || 'top 80%' }
    }));
  }

  /* ─── Smooth scroll ────────────────────────────────────────────────────
     Lenis is driven from GSAP's ticker with its own rAF disabled. Two
     independent loops is the usual cause of scroll-linked jitter: Lenis
     writes the scroll position on its tick, and ScrollTrigger reads a value
     one frame stale. One loop, one frame, no lag.                          */
  let lenis = null;
  function initLenis() {
    if (STATIC || !motionOn || typeof Lenis === 'undefined' || lenis) return;
    lenis = new Lenis({
      autoRaf: false,
      duration: 1.05,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: false
    });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(lenisTick);
    gsap.ticker.lagSmoothing(0);
  }
  function lenisTick(time) { lenis && lenis.raf(time * 1000); }
  function killLenis() {
    if (!lenis) return;
    gsap.ticker.remove(lenisTick);
    lenis.destroy();
    lenis = null;
  }
  initLenis();

  // Anchors must keep working with a hijacked scroll.
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const t = document.querySelector(a.getAttribute('href'));
      if (!t) return;
      e.preventDefault();
      const bar = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--railh')) * 16 || 52;
      lenis ? lenis.scrollTo(t, { duration: 1.2, offset: -bar })
            : t.scrollIntoView();
    });
  });

  const registry = [];   // live canvas renderers, so motion can be stopped globally

  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, arguments), ms);
    };
  }

  /* ═══ HERO ═══════════════════════════════════════════════════════════ */
  const heroCanvas = document.getElementById('heroTrace');
  if (heroCanvas) {
    const t = new Trace.LiveTrace(heroCanvas, {
      condition: 'NORM', seconds: 7.5, speed: 0.55,
      lineWidth: 2.25, mvRange: 3.1, severity: 0
    });
    t.start(); registry.push(t);
  }

  if (STATIC) {
    gsap.set('.hero .eyebrow, .hero__lead, .hero__meta', { opacity: 1, y: 0 });
    gsap.set('.hero__title .split-line > span', { y: '0%' });
  } else {
    gsap.timeline({ defaults: { ease: 'expo.out' } })
      .to('.hero .eyebrow', { opacity: 1, y: 0, duration: 0.9 }, 0.15)
      .to('.hero__title .split-line > span', { y: '0%', duration: 1.25, stagger: 0.09 }, 0.25)
      .to('.hero__lead', { opacity: 1, y: 0, duration: 1.1 }, 0.7)
      .to('.hero__meta', { opacity: 1, y: 0, duration: 1.1 }, 0.85);
  }

  /* ─── Counters. Tabular numerals are non-negotiable or the layout judders. */
  function countUp(el) {
    if (el.dataset.done) return;
    el.dataset.done = '1';
    const dec = +(el.dataset.dec || 0);
    const target = parseFloat(el.dataset.count);
    const unit = el.querySelector('.u');
    const write = (v) => {
      el.firstChild.nodeType === 3
        ? (el.firstChild.textContent = v)
        : el.insertBefore(document.createTextNode(v), el.firstChild);
    };
    if (!motionOn || STATIC) {
      el.textContent = target.toFixed(dec);
      if (unit) el.appendChild(unit);
      return;
    }
    const o = { v: 0 };
    gsap.to(o, {
      v: target, duration: 1.6, ease: 'power2.out',
      onUpdate: () => {
        el.textContent = o.v.toFixed(dec);
        if (unit) el.appendChild(unit);
      }
    });
  }
  document.querySelectorAll('[data-count]').forEach((el) => {
    if (STATIC) { countUp(el); return; }
    if (el.closest('.hero')) { gsap.delayedCall(1.0, () => countUp(el)); return; }
    ScrollTrigger.create({ trigger: el, start: 'top 88%', once: true, onEnter: () => countUp(el) });
  });

  /* ─── Generic reveals ───────────────────────────────────────────────── */
  gsap.utils.toArray('.reveal, .reveal-fast').forEach((el) => {
    if (el.closest('.hero')) return;
    enter(el, { duration: 1.0, ease: 'expo.out' });
  });

  /* ═══ RAIL + PROGRESS ════════════════════════════════════════════════ */
  const railLinks = new Map(
    [...document.querySelectorAll('.rail__list a')].map((a) => [a.dataset.ch, a]));
  const railNow = document.getElementById('railNow');
  railNow.textContent = 'Cardiac Nexus';
  const rail = document.querySelector('.rail');
  // rootMargin picks out the middle band of the viewport, so a chapter goes
  // active when it is actually being read rather than when it first peeks in.
  const railObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      railLinks.forEach((a) => a.removeAttribute('aria-current'));
      const a = railLinks.get(e.target.id);
      if (!a) return;
      a.setAttribute('aria-current', 'true');
      railNow.textContent = a.textContent.trim();
      // Keep the active chapter in view when the bar has to scroll sideways.
      a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('section[id]').forEach((s) => railObserver.observe(s));

  ScrollTrigger.create({
    trigger: '#stakes', start: 'top 70%',
    onEnter: () => rail.classList.add('is-on'),
    onLeaveBack: () => rail.classList.remove('is-on')
  });
  gsap.to('.progress > i', {
    scaleX: 1, ease: 'none',
    scrollTrigger: { trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: 0.3 }
  });

  /* ═══ 02 · SIGNAL — the scrubbed PQRST ═══════════════════════════════ */
  (function signalSection() {
    const svg = document.getElementById('pqrstSvg');
    if (!svg) return;
    const W = 1200, H = 340;
    // Map a slice of the cardiac cycle across the full frame, so the six
    // annotated features fill the width instead of huddling on the left.
    const U0 = 0.045, U1 = 0.70;
    const morph = ECG.resolve('NORM');
    const xFor = (u) => (u - U0) / (U1 - U0) * W;

    let d = '';
    const N = 900;
    for (let i = 0; i < N; i++) {
      const u = U0 + (U1 - U0) * (i / (N - 1));
      const y = H / 2 - ECG.sampleCycle(morph, u) * (H / 2.9);
      d += (i ? 'L' : 'M') + xFor(u).toFixed(2) + ' ' + y.toFixed(2);
    }
    const paths = svg.querySelectorAll('.pq-ghost, .pq-glow, .pq-line');
    paths.forEach((p) => p.setAttribute('d', d));

    // Annotation marks, one per step
    const marks = svg.querySelector('.pq-marks');
    const steps = [...document.querySelectorAll('#signal .step')];
    steps.forEach((s) => {
      const u = parseFloat(s.dataset.cycle);
      const x = xFor(u);
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-mark', s.dataset.step);
      const row = (+s.dataset.step) % 2;          // stagger, so labels cannot collide
      const tick = H - 40 + row * 20;
      const ty = H - 24 + row * 20;
      g.innerHTML =
        `<line x1="${x}" y1="18" x2="${x}" y2="${tick}"/>` +
        `<text x="${x}" y="${ty}" text-anchor="middle">${s.querySelector('.step__tag').textContent}</text>`;
      marks.appendChild(g);
    });

    const line = svg.querySelector('.pq-line');
    const glow = svg.querySelector('.pq-glow');
    const head = svg.querySelector('.pq-head');
    const L = line.getTotalLength();
    [line, glow].forEach((p) => {
      p.style.strokeDasharray = L;
      p.style.strokeDashoffset = motionOn ? L : 0;
    });

    if (STATIC) {
      [line, glow].forEach((p) => { p.style.strokeDashoffset = 0; });
    } else if (motionOn) {
      gsap.to([line, glow], {
        strokeDashoffset: 0, ease: 'none',
        scrollTrigger: {
          trigger: '#signal', start: 'top top', end: 'bottom bottom', scrub: 0.6,
          onUpdate: (self) => {
            const pt = line.getPointAtLength(L * self.progress);
            head.setAttribute('cx', pt.x);
            head.setAttribute('cy', pt.y);
            head.setAttribute('opacity', self.progress > 0.005 && self.progress < 0.999 ? 1 : 0);
          }
        }
      });
    } else {
      head.setAttribute('opacity', 0);
    }

    const label = document.getElementById('pqrstLabel');
    const readout = document.getElementById('pqrstReadout');
    const READOUTS = [
      'Atrial depolarisation · 80–100 ms',
      'AV nodal delay · PR interval 120–200 ms',
      'Ventricular depolarisation · QRS < 120 ms',
      'The isoelectric plateau · should sit at baseline',
      'Ventricular repolarisation · recovery',
      'QT interval · total ventricular electrical activity'
    ];
    steps.forEach((step, i) => {
      ScrollTrigger.create({
        trigger: step, start: 'top 62%', end: 'bottom 62%',
        onToggle: (self) => {
          step.classList.toggle('is-on', self.isActive);
          const g = marks.querySelector(`[data-mark="${i}"]`);
          if (g) g.classList.toggle('is-on', self.isActive);
          if (self.isActive) {
            label.textContent = step.querySelector('h3').textContent;
            readout.textContent = READOUTS[i] || '';
          }
        }
      });
      enterFrom(step.children,
        { y: 22, opacity: 0, duration: 0.8, stagger: 0.07, ease: 'power3.out' }, step);
    });
  })();

  /* ═══ 03 · ORGAN — the heart ═════════════════════════════════════════ */
  (function organSection() {
    const mount = document.getElementById('heartMount');
    if (!mount) return;
    const svg = Heart.build(mount);
    const canvas = document.getElementById('organTrace');
    const traceLabel = document.getElementById('organTraceLabel');

    const trace = new Trace.LiveTrace(canvas, {
      condition: 'NORM', seconds: 6, speed: 0.6, lineWidth: 2, mvRange: 3.0, severity: 0
    });
    trace.start(); registry.push(trace);

    const lit = (names) => {
      svg.querySelectorAll('.h-part').forEach((p) => p.classList.remove('is-lit'));
      names.forEach((n) => {
        svg.querySelectorAll(`[data-part="${n}"]`).forEach((p) => p.classList.add('is-lit'));
      });
      svg.classList.toggle('is-dimmed', names.length > 0);
    };

    /* The travelling impulse. Its timing is the lesson: it sprints through
       the atria, then *stops* at the AV node for a fifth of the cycle before
       the ventricles fire. That pause is the PR segment, and making the dot
       visibly wait is the clearest way to show why the delay exists. */
    const condPath = svg.querySelector('[data-part="conduction"]');
    const leftPath = svg.querySelector('[data-part="leftBundle"]');
    const impulse = svg.querySelector('.h-impulse');
    const condLen = condPath.getTotalLength();
    const leftLen = leftPath.getTotalLength();

    function placeImpulse(phase) {
      let pt, op = 1;
      if (phase < 0.34) {                       // SA node down to the AV node
        pt = condPath.getPointAtLength((phase / 0.34) * condLen * 0.72);
      } else if (phase < 0.54) {                // the AV delay — held still
        pt = condPath.getPointAtLength(condLen * 0.72);
      } else if (phase < 0.78) {                // His bundle into the branches
        const t = (phase - 0.54) / 0.24;
        pt = t < 0.35
          ? condPath.getPointAtLength(condLen * (0.72 + 0.28 * (t / 0.35)))
          : leftPath.getPointAtLength(leftLen * ((t - 0.35) / 0.65));
      } else {                                  // recovery
        pt = leftPath.getPointAtLength(leftLen);
        op = 1 - (phase - 0.78) / 0.22;
      }
      impulse.setAttribute('cx', pt.x);
      impulse.setAttribute('cy', pt.y);
      impulse.setAttribute('opacity', op);
    }

    let impulseTl = null;
    if (motionOn) {
      const o = { p: 0 };
      impulseTl = gsap.to(o, {
        p: 1, duration: 1.9, ease: 'none', repeat: -1,
        onUpdate: () => placeImpulse(o.p)
      });
      // Only run it while the heart is actually on screen.
      new IntersectionObserver(([e]) => {
        e.isIntersecting ? impulseTl.play() : impulseTl.pause();
      }, { rootMargin: '100px' }).observe(svg);
    }

    const NAMES = { NORM: 'Sinus rhythm', AFIB: 'Atrial fibrillation',
                    CD: 'Bundle branch block', HYP: 'Left ventricular hypertrophy',
                    MI: 'ST-elevation infarction' };
    const SEVERITY = { NORM: 0, AFIB: 0.55, CD: 0.7, HYP: 0.7, MI: 1 };

    document.querySelectorAll('#organ .station').forEach((station) => {
      const id = station.dataset.station;
      const chapter = Heart.CHAPTERS.find((c) => c.id === id);
      const cond = station.dataset.cond || 'NORM';
      ScrollTrigger.create({
        trigger: station, start: 'top 58%', end: 'bottom 45%',
        onToggle: (self) => {
          if (!self.isActive) return;
          lit(chapter ? chapter.parts : []);
          trace.setCondition(cond, motionOn ? 1.0 : 0);
          trace.opts.severity = SEVERITY[cond] != null ? SEVERITY[cond] : 0;
          traceLabel.textContent = NAMES[cond] || cond;
          traceLabel.style.color = cond === 'NORM' ? '' : 'var(--signal)';
        }
      });
      enterFrom(station.querySelectorAll('.beat, .station__head, .metricchip'),
        { y: 26, opacity: 0, duration: 0.85, stagger: 0.08, ease: 'power3.out' },
        station, 'top 72%');
    });
  })();

  /* ═══ DATA-DRIVEN SECTIONS ═══════════════════════════════════════════ */
  fetch('data/metrics.json')
    .then((r) => r.json())
    .then(build)
    .catch((err) => {
      console.error('metrics.json failed to load', err);
      document.getElementById('results').innerHTML =
        '<p class="cite">Metrics could not be loaded.</p>';
    });

  function fmt(n, d) { return Number(n).toFixed(d == null ? 3 : d); }

  function build(M) {
    const byCode = Object.fromEntries(M.classes.map((c) => [c.code, c]));

    /* ── Metric chips inside the anatomy stations ──────────────────────── */
    document.querySelectorAll('.metricchip').forEach((chip) => {
      const c = byCode[chip.dataset.metric];
      if (!c) return;
      const weak = c.code === 'HYP';
      chip.innerHTML =
        `<span class="metricchip__k">${c.code} — held-out performance</span>` +
        `<span class="metricchip__v">${fmt(c.auroc)} <span style="color:var(--text-faint);font-size:.7em">AUROC</span></span>` +
        `<span class="metricchip__ci">95% CI ${fmt(c.auroc_lo)}–${fmt(c.auroc_hi)} · average precision ${fmt(c.ap)} · ${c.support} positives in the test set</span>` +
        `<span class="metricchip__note">${weak
          ? 'The weakest of the five, and the anatomy explains why. Hypertrophy is a subtle, continuous, voltage-based finding — and each lead is standardised before the model sees it, so it never observes absolute millivolts at all. An average precision of 0.474 beside an AUROC of 0.837 means it ranks reasonably and still finds a minority of true cases at the default threshold.'
          : 'Sensitivity ' + fmt(c.sensitivity, 2) + ', specificity ' + fmt(c.specificity, 2) + ' at a flat 0.5 threshold. Of ' + c.support + ' true cases it identifies ' + c.confusion.tp + ' and raises ' + c.confusion.fp + ' false alarms.'}</span>`;
    });

    /* ── 04 · Lead grid ────────────────────────────────────────────────── */
    const grid = document.getElementById('leadGrid');
    const leadTraces = [];
    let leadCond = 'NORM';
    ECG.LEADS.forEach((lead) => {
      const cell = document.createElement('div');
      cell.className = 'leadcell';
      cell.tabIndex = 0;
      cell.innerHTML =
        `<div class="leadcell__top"><span class="leadcell__n">${lead.name}</span>` +
        `<span class="leadcell__g">${lead.group}</span></div>` +
        `<canvas></canvas>` +
        `<div class="leadcell__v">${lead.view}</div>`;
      grid.appendChild(cell);
      leadTraces.push({ canvas: cell.querySelector('canvas'), lead });
    });
    function drawLeads() {
      leadTraces.forEach(({ canvas, lead }) => {
        Trace.drawStatic(canvas, {
          condition: leadCond, lead, beats: 2, lineWidth: 1.5, mvRange: 3.4,
          severity: leadCond === 'NORM' ? 0 : 0.9, glow: false
        });
      });
    }
    const leadSwitch = document.getElementById('leadSwitch');
    ['NORM', 'MI', 'STTC', 'CD', 'HYP'].forEach((code) => {
      const b = document.createElement('button');
      b.textContent = code;
      b.setAttribute('aria-pressed', String(code === 'NORM'));
      b.addEventListener('click', () => {
        leadCond = code;
        [...leadSwitch.children].forEach((x) =>
          x.setAttribute('aria-pressed', String(x === b)));
        drawLeads();
      });
      leadSwitch.appendChild(b);
    });
    drawLeads();
    addEventListener('resize', debounce(drawLeads, 220));
    ScrollTrigger.create({ trigger: '#leads', start: 'top 80%', once: true, onEnter: drawLeads });

    /* ── 05 · The five classes ─────────────────────────────────────────── */
    const tabs = document.getElementById('classTabs');
    const detail = document.getElementById('classDetail');
    const caption = document.getElementById('classCaption');
    const classCanvas = document.getElementById('classTrace');
    const classTrace = new Trace.LiveTrace(classCanvas, {
      condition: 'NORM', seconds: 5.2, speed: 0.5, lineWidth: 2.25, mvRange: 3.2, severity: 0
    });
    classTrace.start(); registry.push(classTrace);

    const SEV = { NORM: 0, MI: 1, STTC: 0.75, CD: 0.7, HYP: 0.6 };
    function selectClass(code) {
      const c = byCode[code], info = Content.CLASSES[code];
      [...tabs.children].forEach((t) =>
        t.setAttribute('aria-selected', String(t.dataset.code === code)));
      classTrace.setCondition(code, motionOn ? 0.9 : 0);
      classTrace.opts.severity = SEV[code];
      caption.textContent = info.caption;
      detail.innerHTML =
        `<h4>${info.long}</h4><p>${info.body}</p>` +
        `<dl>` +
        `<div><dt>AUROC</dt><dd>${fmt(c.auroc)}</dd></div>` +
        `<div><dt>Average precision</dt><dd>${fmt(c.ap)}</dd></div>` +
        `<div><dt>Sensitivity @ 0.5</dt><dd>${fmt(c.sensitivity, 2)}</dd></div>` +
        `<div><dt>Test positives</dt><dd>${c.support}</dd></div>` +
        `</dl>`;
    }
    M.classes.forEach((c) => {
      const b = document.createElement('button');
      b.className = 'classtab';
      b.dataset.code = c.code;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(c.code === 'NORM'));
      b.innerHTML =
        `<span class="classtab__code">${c.code}</span>` +
        `<span class="classtab__name">${Content.CLASSES[c.code].name}</span>` +
        `<span class="classtab__auc">${fmt(c.auroc)}</span>`;
      b.addEventListener('click', () => selectClass(c.code));
      tabs.appendChild(b);
    });
    selectClass('NORM');

    /* ── 06 · Problem / answer pairs ───────────────────────────────────── */
    const pairs = document.getElementById('pairs');
    Content.PAIRS.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'pair';
      li.innerHTML =
        `<span class="pair__n">${String(i + 1).padStart(2, '0')}</span>` +
        `<div class="pair__problem"><h3>${p.problem}</h3><p>${p.detail}</p></div>` +
        `<div class="pair__answer"><span class="pair__k">${p.k}</span><p>${p.answer}</p></div>`;
      pairs.appendChild(li);
      enterFrom(li, { y: 30, opacity: 0, duration: 0.9, ease: 'power3.out' }, li, 'top 86%');
    });

    /* ── 07 · Architecture funnel ──────────────────────────────────────── */
    const funnel = document.getElementById('funnel');
    const stages = M.architecture.stages;
    // Bar height encodes channels, width encodes sequence length — both on a
    // log scale, so the reader physically watches time collapse as depth grows.
    const maxCh = Math.max(...stages.map((s) => s.shape[0]));
    const maxLen = Math.max(...stages.map((s) => (s.shape[1] || 1)));
    stages.forEach((s) => {
      const ch = s.shape[0], len = s.shape[1] || 1;
      const h = 40 + (Math.log10(ch) / Math.log10(maxCh)) * 150;
      const w = 26 + (Math.log10(len) / Math.log10(maxLen)) * 74;
      const div = document.createElement('div');
      div.className = 'fstage' + (s.boundary ? ' fstage--boundary' : '');
      div.style.maxWidth = w + 'px';
      div.innerHTML =
        `<span class="fstage__shape">${s.shape.join(' × ')}</span>` +
        `<div class="fstage__bar" style="height:${h}px"></div>` +
        `<span class="fstage__op">${s.op}</span>`;
      funnel.appendChild(div);
    });

    /* ── 07b · Augmentation ────────────────────────────────────────────── */
    const yes = document.getElementById('augYes'), no = document.getElementById('augNo');
    M.augment.forEach((a) => {
      const li = document.createElement('li');
      li.innerHTML =
        `<div class="auglist__top"><span class="auglist__n">${a.name}</span>` +
        `<span class="auglist__p">p = ${a.p.toFixed(2)}</span></div>` +
        `<div class="auglist__param">${a.param}</div>` +
        `<p class="auglist__why">${a.why}</p>`;
      yes.appendChild(li);
    });
    M.augment_rejected.forEach((a) => {
      const li = document.createElement('li');
      li.innerHTML =
        `<div class="auglist__top"><span class="auglist__n">${a.name}</span>` +
        `<span class="auglist__p">excluded</span></div>` +
        `<p class="auglist__why">${a.why}</p>`;
      no.appendChild(li);
    });

    /* ── 08 · Results table ────────────────────────────────────────────── */
    const results = document.getElementById('results');
    const lo = 0.75, hi = 1.0;   // shared axis so bars are comparable
    const pos = (v) => ((v - lo) / (hi - lo)) * 100;
    results.innerHTML =
      `<div class="resrow resrow--head"><span>Class</span>` +
      `<span>AUROC with 95% bootstrap interval &nbsp;·&nbsp; axis 0.75 – 1.00</span>` +
      `<span>Estimate</span><span style="text-align:right">Positives</span></div>`;
    M.classes.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'resrow';
      row.innerHTML =
        `<span class="resrow__code">${c.code}</span>` +
        `<span class="resrow__bar">` +
          `<span class="resbar__track"></span>` +
          `<span class="resbar__ci" style="left:${pos(c.auroc_lo)}%;width:${pos(c.auroc_hi) - pos(c.auroc_lo)}%"></span>` +
          `<span class="resbar__fill" style="width:${pos(c.auroc)}%"></span>` +
          `<span class="resbar__dot" style="left:${pos(c.auroc)}%"></span>` +
        `</span>` +
        `<span class="resrow__val">${fmt(c.auroc)}` +
          `<span class="resrow__ci">AP ${fmt(c.ap)} · F1 ${fmt(c.f1, 2)}</span></span>` +
        `<span class="resrow__n">${c.support}</span>`;
      results.appendChild(row);
      enterFrom(row.querySelectorAll('.resbar__fill, .resbar__ci'),
        { scaleX: 0, transformOrigin: 'left center', duration: 1.1, ease: 'expo.out', stagger: 0.05 },
        row, 'top 90%');
    });
    const foot = document.createElement('div');
    foot.className = 'resrow';
    foot.innerHTML =
      `<span class="resrow__code" style="color:var(--signal)">MACRO</span>` +
      `<span class="resrow__bar"><span class="resbar__track"></span>` +
        `<span class="resbar__fill" style="width:${pos(M.macro_auroc)}%"></span>` +
        `<span class="resbar__dot" style="left:${pos(M.macro_auroc)}%"></span>` +
        `<span class="resbar__bench" style="left:${pos(M.benchmark.macro_auroc)}%" title="published benchmark"></span>` +
      `</span>` +
      `<span class="resrow__val">${fmt(M.macro_auroc)}` +
        `<span class="resrow__ci">benchmark ${M.benchmark.macro_auroc}</span></span>` +
      `<span class="resrow__n">${M.dataset.test}</span>`;
    results.appendChild(foot);

    const note = document.createElement('p');
    note.className = 'cite';
    note.style.marginTop = '1.5rem';
    note.innerHTML =
      `${M.model.architecture}, ${M.model.epochs} epochs, batch ${M.model.batch_size}, ` +
      `lr ${M.model.learning_rate}, weight decay ${M.model.weight_decay}, one-cycle schedule, ` +
      `seed ${M.model.seed}, trained on ${M.model.device}. Checkpoint taken at epoch ${M.selected_epoch}. ` +
      `The vertical tick on the macro row is the published benchmark of ${M.benchmark.macro_auroc} ` +
      `(${M.benchmark.ref}), achieved with ${M.benchmark.arch} at 33.3M parameters against 6.4M here. ` +
      `Thresholded metrics use a flat 0.5 for every class.`;
    results.appendChild(note);

    /* ── 08b · Charts ──────────────────────────────────────────────────── */
    Charts.history(document.getElementById('historyChart'), M.history);
    Charts.scatter(document.getElementById('scatterChart'), M.runs);
    Charts.attribution(document.getElementById('attrChart'), M.attribution);

    let calClass = 'CD', calOn = false;
    const calSvg = document.getElementById('calChart');
    const calNote = document.getElementById('calNote');
    const calHeadline = document.getElementById('calHeadline');
    function drawCal() {
      const d = M.calibration[calClass];
      Charts.reliability(calSvg, d.raw, d.cal, calOn);
      const c = byCode[calClass];
      // Quote the 0.8–0.9 bin specifically, and drive the headline from the
      // same bin, so the sentence above the chart and the note below it can
      // never disagree about which number they are talking about.
      const hi = d.raw.find((b) => Math.abs(b.lo - 0.8) < 1e-6) ||
                 d.raw.reduce((a, b) => (b.conf > a.conf ? b : a));
      const said = Math.round(hi.conf * 100), right = Math.round(hi.obs * 100);
      calHeadline.textContent =
        `The model said ${said}%. It was right ${right}% of the time.`;
      calNote.innerHTML =
        `${calClass} — expected calibration error <strong>${fmt(c.ece_raw)}</strong> raw, ` +
        `<strong>${fmt(c.ece_cal)}</strong> after scaling. ` +
        `In the 0.8–0.9 band the model assigned a mean ${said}% to ${hi.n} recordings, ` +
        `and ${right}% of them were actually positive. ` +
        (calClass === 'HYP'
          ? 'After calibration HYP has no recordings left above 0.9 at all — the model stopped claiming near-certainty about the thing it is worst at.'
          : 'Bars along the bottom show how many recordings landed in each bin.');
    }
    const calSeg = document.getElementById('calClass');
    Object.keys(M.calibration).forEach((code) => {
      const b = document.createElement('button');
      b.className = 'seg__btn';
      b.textContent = code;
      b.setAttribute('aria-pressed', String(code === calClass));
      b.addEventListener('click', () => {
        calClass = code;
        [...calSeg.children].forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        drawCal();
      });
      calSeg.appendChild(b);
    });
    const calToggle = document.getElementById('calToggle');
    calToggle.addEventListener('click', () => {
      calOn = !calOn;
      calToggle.setAttribute('aria-pressed', String(calOn));
      calToggle.textContent = calOn ? 'Show raw output' : 'Apply calibration';
      drawCal();
    });
    drawCal();

    /* ── 09 · Limits ───────────────────────────────────────────────────── */
    const limits = document.getElementById('limitsList');
    Content.LIMITS.forEach(([k, v]) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="limits__k">${k}</span><span class="limits__v">${v}</span>`;
      limits.appendChild(li);
    });

    ScrollTrigger.refresh();
  }

  /* ═══ MOTION TOGGLE ══════════════════════════════════════════════════ */
  const toggle = document.getElementById('motionToggle');
  function applyMotion() {
    toggle.textContent = motionOn ? 'Reduce motion' : 'Restore motion';
    toggle.setAttribute('aria-pressed', String(!motionOn));
    document.documentElement.dataset.motion = motionOn ? 'full' : 'reduced';
    if (motionOn) { initLenis(); registry.forEach((t) => t.start()); }
    else { killLenis(); registry.forEach((t) => { t.stop(); t.draw(); }); }
  }
  toggle.addEventListener('click', () => {
    motionOn = !motionOn;
    localStorage.setItem('cn-motion', motionOn ? 'full' : 'reduced');
    applyMotion();
  });
  applyMotion();

  /* A handle for debugging and for verification tooling. Also the escape
     hatch that lets a static render be forced when rAF is unavailable — a
     hidden tab, a screenshot harness, a print stylesheet. */
  window.__nexus = {
    get lenis() { return lenis; },
    registry,
    redraw() { registry.forEach((t) => t.draw()); },
    settle() {
      // Kill the triggers before the tweens. A live ScrollTrigger re-fires its
      // gsap.from() on the next scroll, which sets opacity back to 0 — and in a
      // context with no animation frames that is where it stays.
      ScrollTrigger.getAll().forEach((t) => t.kill());
      gsap.globalTimeline.getChildren(true, true, true).forEach((t) => t.kill());
      gsap.set(
        '.reveal, .reveal-fast, .beat, .station__head, .metricchip, .pair, .resbar__fill, .resbar__ci, .step > *',
        { opacity: 1, clearProps: 'transform,x,y,scaleX' });
      document.querySelectorAll('.split-line > span').forEach((e) => {
        e.style.transform = 'none';
      });
      document.querySelectorAll('[data-count]').forEach((e) => {
        const dec = +(e.dataset.dec || 0);
        const unit = e.querySelector('.u');
        e.textContent = parseFloat(e.dataset.count).toFixed(dec);
        if (unit) e.appendChild(unit);
      });
      registry.forEach((t) => t.draw());
    }
  };

  // Pin distances are computed from laid-out text. Fonts land late.
  document.fonts && document.fonts.ready.then(() => ScrollTrigger.refresh());
  addEventListener('load', () => ScrollTrigger.refresh());
})();
