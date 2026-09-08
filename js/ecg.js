/* =============================================================================
   ecg.js — Synthetic 12-lead ECG waveform engine
   -----------------------------------------------------------------------------
   Every beat is modelled as a sum of Gaussians, one per deflection of the
   PQRST complex, following the approach of McSharry et al. (2003) in simplified
   form. Each deflection carries three parameters:

       mu  — its centre, in normalised cardiac-cycle units (0 = start, 1 = end)
       a   — its amplitude, in millivolts
       b   — its width

   Encoding morphology this way means a pathology is not a separate drawing.
   It is a set of numbers. ST elevation is an amplitude. A bundle branch block
   is a width. Every condition on this page is therefore continuously
   interpolable, so the waveform can *morph* from healthy to diseased instead of
   cutting between two static images.
   ========================================================================== */

(function (global) {
  'use strict';

  /* --- The healthy reference beat -------------------------------------- */
  const SINUS = {
    name: 'Normal sinus rhythm',
    bpm: 62,
    // ST segment offset in mV, applied as a plateau between S and T
    st: 0.0,
    // proportion of RR-interval jitter (0 = metronomic)
    irregularity: 0.012,
    waves: {
      P: { mu: 0.160, a:  0.120, b: 0.0230 },
      Q: { mu: 0.276, a: -0.075, b: 0.0068 },
      R: { mu: 0.300, a:  1.000, b: 0.0098 },
      S: { mu: 0.326, a: -0.220, b: 0.0110 },
      T: { mu: 0.462, a:  0.290, b: 0.0420 }
    }
  };

  /* --- Pathologies ------------------------------------------------------
     Each is expressed as a *delta* from sinus rhythm, so the difference
     between health and disease stays legible in the source itself.        */
  const CONDITIONS = {
    NORM: {
      code: 'NORM',
      label: 'Normal',
      blurb: 'Impulse starts at the sinoatrial node, spreads through both atria, pauses at the AV node, then sweeps the ventricles in under 100 ms.',
      patch: {}
    },

    MI: {
      code: 'MI',
      label: 'Myocardial infarction',
      blurb: 'A coronary artery is blocked. The muscle it feeds is starving, and injured tissue holds a different resting charge — which lifts the ST segment off the baseline.',
      patch: {
        st: 0.26,
        waves: {
          Q: { a: -0.230, b: 0.0130 },   // pathological Q wave: deep and broad
          R: { a:  0.620 },              // loss of R wave height over the infarct
          T: { a:  0.400, b: 0.0480 }    // hyperacute T
        }
      }
    },

    STTC: {
      code: 'STTC',
      label: 'ST/T change',
      blurb: 'Repolarisation is disturbed. The muscle recovers unevenly after each beat, which depresses the ST segment and flips the T wave below the line.',
      patch: {
        st: -0.16,
        waves: {
          T: { a: -0.240, b: 0.0440 }    // T wave inversion
        }
      }
    },

    CD: {
      code: 'CD',
      label: 'Conduction disturbance',
      blurb: 'One branch of the His-Purkinje wiring is blocked. One ventricle fires late, so the two no longer contract together and the QRS complex smears out.',
      patch: {
        waves: {
          P: { mu: 0.120 },              // PR interval prolonged
          Q: { mu: 0.262, b: 0.0130 },
          R: { a: 0.880, b: 0.0250 },    // markedly widened QRS
          S: { mu: 0.352, a: -0.330, b: 0.0260 },
          T: { mu: 0.500, a: -0.180 }    // discordant T
        }
      }
    },

    HYP: {
      code: 'HYP',
      label: 'Hypertrophy',
      blurb: 'The ventricular wall has thickened against years of pressure. More muscle means a larger electrical vector, so the QRS grows tall.',
      patch: {
        waves: {
          P: { a: 0.175, b: 0.0290 },    // left atrial enlargement
          R: { a: 1.720 },               // high voltage
          S: { a: -0.420 },
          T: { a: -0.150, b: 0.0460 }    // strain pattern
        }
      }
    },

    AFIB: {
      code: 'AFIB',
      label: 'Atrial fibrillation',
      blurb: 'The atria stop beating and start quivering. There is no organised P wave left to see, and the ventricles respond at irregular intervals.',
      patch: {
        irregularity: 0.19,
        waves: {
          P: { a: 0.0 }                  // P wave abolished
        }
      }
    },

    BLOCK: {
      code: 'BLOCK',
      label: 'First-degree AV block',
      blurb: 'The AV node holds the impulse longer than it should. Every beat still arrives, but each one is late.',
      patch: {
        waves: {
          P: { mu: 0.075 }               // PR interval stretched
        }
      }
    }
  };

  /* --- Deep merge of a patch onto the sinus template -------------------- */
  function resolve(code) {
    const cond = CONDITIONS[code] || CONDITIONS.NORM;
    const p = cond.patch || {};
    const out = {
      bpm: p.bpm != null ? p.bpm : SINUS.bpm,
      st: p.st != null ? p.st : SINUS.st,
      irregularity: p.irregularity != null ? p.irregularity : SINUS.irregularity,
      waves: {}
    };
    for (const k of Object.keys(SINUS.waves)) {
      const base = SINUS.waves[k];
      const patch = (p.waves && p.waves[k]) || {};
      out.waves[k] = {
        mu: patch.mu != null ? patch.mu : base.mu,
        a:  patch.a  != null ? patch.a  : base.a,
        b:  patch.b  != null ? patch.b  : base.b
      };
    }
    return out;
  }

  /* --- Linear interpolation between two resolved morphologies ----------
     This is what lets the page dissolve one condition into another.      */
  function lerpMorph(A, B, t) {
    const mix = (x, y) => x + (y - x) * t;
    const out = {
      bpm: mix(A.bpm, B.bpm),
      st: mix(A.st, B.st),
      irregularity: mix(A.irregularity, B.irregularity),
      waves: {}
    };
    for (const k of Object.keys(A.waves)) {
      out.waves[k] = {
        mu: mix(A.waves[k].mu, B.waves[k].mu),
        a:  mix(A.waves[k].a,  B.waves[k].a),
        b:  mix(A.waves[k].b,  B.waves[k].b)
      };
    }
    return out;
  }

  /* --- Smooth window used to build the ST plateau ----------------------- */
  function smoothstep(edge0, edge1, x) {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  /* --- Amplitude of one cardiac cycle at normalised phase u in [0,1) ---- */
  function sampleCycle(morph, u) {
    let v = 0;
    const w = morph.waves;
    for (const k in w) {
      const g = w[k];
      if (g.a === 0) continue;
      // wrap the phase difference so waves near the cycle edge behave
      let d = u - g.mu;
      if (d > 0.5) d -= 1;
      if (d < -0.5) d += 1;
      v += g.a * Math.exp(-(d * d) / (2 * g.b * g.b));
    }
    // ST segment: the plateau between the J point (just past S) and the foot
    // of the T wave. Clinically this is the stretch that lifts in infarction
    // and sags in ischaemia, so it needs real width — it is the single most
    // diagnostically loaded 80 ms on the whole trace.
    if (morph.st !== 0) {
      const jPoint = w.S.mu + w.S.b * 1.4;      // end of depolarisation
      const tFoot  = w.T.mu - w.T.b * 0.9;      // T wave begins to climb
      const rise = smoothstep(jPoint - 0.010, jPoint + 0.014, u);
      // ST change blends into the T wave rather than stopping at a wall
      const fall = 1 - smoothstep(tFoot, w.T.mu + w.T.b * 0.8, u);
      v += morph.st * rise * fall;
    }
    return v;
  }

  /* --- Per-lead projection ---------------------------------------------
     A 12-lead ECG is not twelve recordings. It is one electrical vector
     viewed from twelve angles. Rather than simulate the full vector, each
     lead is given the scaling and polarity that reproduces its
     characteristic shape — most importantly aVR's inversion and the R-wave
     progression that sweeps across V1 to V6.                              */
  const LEADS = [
    { name: 'I',   p:  0.85, qrs:  0.95, t:  0.85, group: 'limb',       view: 'Left lateral wall' },
    { name: 'II',  p:  1.15, qrs:  1.15, t:  1.10, group: 'limb',       view: 'Inferior wall' },
    { name: 'III', p:  0.55, qrs:  0.72, t:  0.45, group: 'limb',       view: 'Inferior wall' },
    { name: 'aVR', p: -1.00, qrs: -0.90, t: -0.95, group: 'augmented',  view: 'Right upper — reads everything backwards' },
    { name: 'aVL', p:  0.42, qrs:  0.55, t:  0.50, group: 'augmented',  view: 'High lateral wall' },
    { name: 'aVF', p:  0.80, qrs:  0.92, t:  0.78, group: 'augmented',  view: 'Inferior wall' },
    { name: 'V1',  p:  0.35, qrs: -0.62, t: -0.30, group: 'precordial', view: 'Septum, right ventricle' },
    { name: 'V2',  p:  0.45, qrs: -0.20, t:  0.95, group: 'precordial', view: 'Septum, anterior wall' },
    { name: 'V3',  p:  0.60, qrs:  0.45, t:  1.15, group: 'precordial', view: 'Anterior wall' },
    { name: 'V4',  p:  0.75, qrs:  1.25, t:  1.10, group: 'precordial', view: 'Apex' },
    { name: 'V5',  p:  0.80, qrs:  1.10, t:  0.95, group: 'precordial', view: 'Lateral wall' },
    { name: 'V6',  p:  0.72, qrs:  0.85, t:  0.80, group: 'precordial', view: 'Lateral wall' }
  ];

  function projectMorph(morph, lead) {
    const out = {
      bpm: morph.bpm,
      st: morph.st * lead.qrs,
      irregularity: morph.irregularity,
      waves: {}
    };
    const scaleFor = { P: lead.p, Q: lead.qrs, R: lead.qrs, S: lead.qrs, T: lead.t };
    for (const k in morph.waves) {
      out.waves[k] = {
        mu: morph.waves[k].mu,
        a:  morph.waves[k].a * scaleFor[k],
        b:  morph.waves[k].b
      };
    }
    return out;
  }

  /* --- Deterministic pseudo-random, so a redraw is never a reshuffle ---- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* =========================================================================
     generate — produce a strip of samples.

     opts:
       morph        resolved morphology object (from resolve/lerpMorph)
       seconds      duration of the strip
       fs           samples per second
       phase        starting offset in seconds, for scrolling animation
       noise        amplitude of high-frequency noise in mV
       wander       amplitude of low-frequency baseline drift in mV
       seed         integer, fixes the random sequence
     returns Float32Array of millivolt values.
     ====================================================================== */
  function generate(opts) {
    const o = Object.assign({
      morph: resolve('NORM'),
      seconds: 10,
      fs: 250,
      phase: 0,
      noise: 0.006,
      wander: 0.02,
      seed: 7
    }, opts);

    const morph = o.morph;
    const n = Math.round(o.seconds * o.fs);
    const out = new Float32Array(n);
    const rand = mulberry32(o.seed);

    // Build the sequence of beat start times, with RR variability applied.
    const meanRR = 60 / morph.bpm;
    const starts = [];
    // begin far enough behind zero that the strip is populated from t=0
    let t = -meanRR * 3 - (o.phase % (meanRR * 64));
    const end = o.seconds + meanRR * 2;
    while (t < end) {
      starts.push(t);
      const jitter = 1 + (rand() * 2 - 1) * morph.irregularity;
      t += meanRR * jitter;
    }

    for (let i = 0; i < n; i++) {
      const time = i / o.fs + o.phase;
      // locate the beat this sample belongs to
      let v = 0;
      for (let b = 0; b < starts.length; b++) {
        const s0 = starts[b];
        const s1 = (b + 1 < starts.length) ? starts[b + 1] : s0 + meanRR;
        const localT = time - s0;
        const dur = s1 - s0;
        if (localT >= 0 && localT < dur) {
          v = sampleCycle(morph, localT / dur);
          break;
        }
      }
      // baseline wander: slow respiratory drift
      v += o.wander * Math.sin(time * 0.9 + 0.6) * 0.6
         + o.wander * Math.sin(time * 0.31 + 2.1) * 0.4;
      // sensor noise
      v += (rand() * 2 - 1) * o.noise;
      out[i] = v;
    }
    return out;
  }

  /* --- Convert samples to an SVG path string ---------------------------- */
  function toPath(samples, width, height, mvRange) {
    const range = mvRange || 2.6;
    const n = samples.length;
    const mid = height / 2;
    const yScale = height / range;
    let d = '';
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * width;
      const y = mid - samples[i] * yScale;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2);
    }
    return d;
  }

  global.ECG = {
    SINUS, CONDITIONS, LEADS,
    resolve, lerpMorph, projectMorph,
    generate, toPath, sampleCycle, mulberry32
  };
})(window);
