# Cardiac Nexus — web portal

The public explainer for the Cardiac Nexus ECG work: what the heart does, how it
fails, what it writes down on a 12-lead ECG, and how a model learns to read it.

A single scroll-driven page. No build step, no framework, no bundler — open
`index.html` and it runs.

## Running it

Any static server will do. From the repository root:

```bash
python3 -m http.server 4321
```

Then open <http://localhost:4321>.

Opening `index.html` directly from the filesystem mostly works, but `fetch` of
`data/metrics.json` is blocked by the `file://` origin policy, so the results and
chart sections come up empty. Use a server.

### URL flags

| Flag | Effect |
| --- | --- |
| `?static=1` | Renders the finished page with no motion and no scroll dependence — every element in its end state. Used for print, screenshots, and any browser that never fires an animation frame. |
| `?only=<section-id>` | Isolates one section at the top of the document. Section ids: `stakes`, `signal`, `organ`, `leads`, `classes`, `hard`, `machine`, `evidence`, `limits`. |

## Structure

```text
index.html          the whole page
css/main.css        design tokens, reset, shared components, paper theme
css/sections.css    per-section composition and breakpoints
js/ecg.js           synthetic 12-lead ECG waveform engine
js/trace.js         canvas renderers for live and still traces
js/heart.js         the anatomical schematic and its conduction path
js/charts.js        hand-built SVG charts
js/content.js       the prose that is generated rather than marked up
js/main.js          scroll orchestration and section wiring
data/metrics.json   measured results, generated from the training repository
```

## Where the numbers come from

Every figure on the page is measured, not illustrative. `data/metrics.json` is
generated from the evaluation artefacts in the
[nexus-ai-engine](https://github.com/Cardiac-Nexus-Lab/nexus-ai-engine)
repository — held-out performance on PTB-XL fold 10, per-class bootstrap
confidence intervals, the training history, and the calibration reliability
bins. Nothing is hand-entered, and no point estimate is displayed without its
interval.

The **waveforms are synthesised**, not recorded. Each beat is a sum of Gaussians
— one per deflection of the PQRST complex, each with an amplitude, a position in
the cardiac cycle and a width. Pathologies are therefore parameter changes
rather than separate assets, which is what lets a trace morph continuously from
healthy to diseased. They illustrate morphology. They are not recordings of any
patient, and no patient data is present in this repository.

## Accessibility and motion

Smooth scrolling and every scroll-linked animation are disabled under
`prefers-reduced-motion`, and the page carries its own motion toggle, persisted
to `localStorage`. All copy is present in the DOM at full opacity for screen
readers; reveals animate `transform` and `opacity` only. Every chapter is a real
`<section id>` reachable by anchor.

## Status

Research communication. The system it describes is **not a medical device**, has
no regulatory clearance, has never been tested on a patient, and must not be
used to make or defer a clinical decision. The limitations chapter is part of
the page, at the same visual weight as the results, and should stay that way.
