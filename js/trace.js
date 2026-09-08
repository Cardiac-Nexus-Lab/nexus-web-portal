/* =============================================================================
   trace.js — Canvas renderers for live ECG traces.
   -----------------------------------------------------------------------------
   Two renderers share one engine:
     LiveTrace  — a sweeping monitor line that redraws continuously
     StaticTrace— a still strip, used where the reader should study a shape
   Both are DPR-aware and pause themselves when scrolled out of view, which is
   what keeps a page with a dozen live traces on it running at 60fps.
   ========================================================================== */
(function (global) {
  'use strict';
  const ECG = global.ECG;

  function fitCanvas(canvas) {
    const dpr = Math.min(global.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    return { ctx: canvas.getContext('2d'), w, h, dpr };
  }

  /* Blend mint -> red as `severity` goes 0 -> 1. Colour is the diagnosis. */
  function traceColor(severity) {
    const a = [52, 229, 192], b = [255, 64, 85];
    const t = Math.min(1, Math.max(0, severity));
    // ease so the trace stays convincingly healthy until disease really bites
    const e = t * t;
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * e)},${Math.round(a[1] + (b[1] - a[1]) * e)},${Math.round(a[2] + (b[2] - a[2]) * e)})`;
  }

  class LiveTrace {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.opts = Object.assign({
        condition: 'NORM',
        seconds: 5.5,
        fs: 260,
        speed: 1,
        lineWidth: 2,
        glow: true,
        severity: 0,
        mvRange: 2.8,
        lead: null            // optional lead object for per-lead projection
      }, opts);
      this.phase = 0;
      this.visible = true;
      this.running = false;
      this._morph = this._resolve(this.opts.condition);
      this._target = this._morph;
      this._blend = 1;
      this._last = 0;
      this._observe();
    }

    _resolve(code) {
      let m = ECG.resolve(code);
      if (this.opts.lead) m = ECG.projectMorph(m, this.opts.lead);
      return m;
    }

    /* Morph to another condition over `dur` seconds instead of cutting. */
    setCondition(code, dur) {
      this._from = this._current() ;
      this._target = this._resolve(code);
      this._blendDur = dur == null ? 0.9 : dur;
      this._blend = this._blendDur > 0 ? 0 : 1;
      this.opts.condition = code;
    }

    _current() {
      if (this._blend >= 1) return this._target;
      return ECG.lerpMorph(this._from, this._target, this._blend);
    }

    _observe() {
      if (!('IntersectionObserver' in global)) return;
      this._io = new IntersectionObserver((es) => {
        this.visible = es[0].isIntersecting;
      }, { rootMargin: '120px' });
      this._io.observe(this.canvas);
    }

    start() {
      if (this.running) return;
      this.running = true;
      this._last = performance.now();
      const loop = (now) => {
        if (!this.running) return;
        const dt = Math.min(0.05, (now - this._last) / 1000);
        this._last = now;
        if (this.visible) {
          this.phase += dt * this.opts.speed;
          if (this._blend < 1) {
            this._blend = Math.min(1, this._blend + dt / this._blendDur);
          }
          this.draw();
        }
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    }

    stop() { this.running = false; cancelAnimationFrame(this._raf); }

    draw() {
      const { ctx, w, h, dpr } = fitCanvas(this.canvas);
      ctx.clearRect(0, 0, w, h);
      const o = this.opts;
      const samples = ECG.generate({
        morph: this._current(),
        seconds: o.seconds,
        fs: o.fs,
        phase: this.phase,
        noise: 0.005,
        wander: 0.014,
        seed: 11
      });

      const mid = h / 2;
      const yScale = h / o.mvRange;
      const col = traceColor(o.severity);

      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = o.lineWidth * dpr;

      if (o.glow) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 14 * dpr;
      }
      ctx.strokeStyle = col;
      ctx.beginPath();
      const n = samples.length;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w;
        const y = mid - samples[i] * yScale;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  /* A still strip — one or two beats, centred, for close reading. */
  function drawStatic(canvas, opts) {
    const o = Object.assign({
      condition: 'NORM', beats: 2, severity: 0,
      lineWidth: 2, mvRange: 2.6, color: null, glow: true, lead: null
    }, opts);
    const { ctx, w, h, dpr } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);

    let morph = ECG.resolve(o.condition);
    if (o.lead) morph = ECG.projectMorph(morph, o.lead);
    const seconds = o.beats * (60 / morph.bpm);
    const samples = ECG.generate({
      morph, seconds, fs: 400, phase: 0.42, noise: 0.0025, wander: 0, seed: 3
    });

    const col = o.color || traceColor(o.severity);
    const mid = h / 2;
    const yScale = h / o.mvRange;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.lineWidth = o.lineWidth * dpr;
    ctx.strokeStyle = col;
    if (o.glow) { ctx.shadowColor = col; ctx.shadowBlur = 12 * dpr; }
    ctx.beginPath();
    for (let i = 0; i < samples.length; i++) {
      const x = (i / (samples.length - 1)) * w;
      const y = mid - samples[i] * yScale;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    return { samples, morph };
  }

  global.Trace = { LiveTrace, drawStatic, traceColor, fitCanvas };
})(window);
