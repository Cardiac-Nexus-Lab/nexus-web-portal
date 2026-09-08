/* =============================================================================
   content.js — the prose that is generated rather than hand-marked-up.
   Kept apart from the orchestration so copy can be edited without reading a
   line of animation code.
   ========================================================================== */
(function (global) {
  'use strict';

  const CLASSES = {
    NORM: {
      name: 'Normal',
      long: 'No diagnostic abnormality on the tracing.',
      body: 'This is a statement about the recording, not a clearance for the patient. A normal ECG excludes very little on its own — a person with severe stable coronary disease can produce a perfectly normal resting trace.',
      caption: 'Sinus rhythm. A P wave before every QRS, a narrow complex, an ST segment sitting on the baseline, and an upright T wave.'
    },
    MI: {
      name: 'Myocardial infarction',
      long: 'Muscle has died, or is dying, because its blood supply failed.',
      body: 'Spans both acute injury patterns and the permanent residue of old infarcts, subdivided by territory. The clinical stakes are the highest of the five: acute presentations are time-critical, and old-infarct findings mark patients at raised risk of arrhythmia and heart failure.',
      caption: 'The ST segment has lifted off the baseline and the R wave has lost height. Injured muscle holds a different resting charge from healthy muscle, and that difference is what displaces the segment.'
    },
    STTC: {
      name: 'ST/T change',
      long: 'The recovery phase of the ventricle is not normal.',
      body: 'The most clinically ambiguous class, and the most important to get right. Repolarisation changes are the language in which ischaemia, electrolyte disturbance, drug effect, pericarditis and strain all speak. A model that flags STTC is saying recovery is disturbed — not that it knows why.',
      caption: 'The ST segment sags below the baseline and the T wave has flipped below the line. The depolarisation is intact; it is the recovery that has gone wrong.'
    },
    CD: {
      name: 'Conduction disturbance',
      long: 'Failure or delay along the path from atrium to Purkinje fibre.',
      body: 'Blocks of every degree, bundle branch and fascicular blocks, intraventricular delay, pre-excitation. These are the most electrically legible of the five, because the ECG measures conduction directly rather than inferring it from anything else.',
      caption: 'The QRS complex has smeared out past 120 milliseconds. One branch of the wiring is blocked, so one ventricle is being activated late and through muscle rather than through fibre.'
    },
    HYP: {
      name: 'Hypertrophy',
      long: 'Increased muscle mass, inferred from voltage, axis and repolarisation together.',
      body: 'Left ventricular hypertrophy is the common case and marks chronic pressure load, most often untreated hypertension. It is also the class with the weakest correspondence between ECG and truth: the criteria are specific but not sensitive against echocardiography — which is exactly what the numbers below show.',
      caption: 'The R wave has grown tall. More muscle beneath the electrode means a larger electrical vector. The inverted T wave beside it is the strain pattern — the muscle is not merely large, it is under duress.'
    }
  };

  /* Each difficulty is paired with the specific thing done about it. Listing
     a problem without its answer is complaining; listing an answer without
     its problem is marketing. */
  const PAIRS = [
    {
      problem: 'The classes are unbalanced, and the imbalance runs the wrong way.',
      detail: 'NORM appears 9,514 times in PTB-XL; HYP appears 2,649. A model that never predicts the rare classes scores well on aggregate accuracy and is clinically worthless, because the rare classes include the dangerous ones.',
      k: 'Multi-label learning with weighted loss',
      answer: 'Five independent per-class outputs rather than a softmax over five options, so the model is never forced to choose between findings that genuinely coexist. Class-weighted loss raises the cost of missing a rare positive — positive weights run from <strong>1.25 for NORM to 7.06 for HYP</strong>, pushing the decision surface toward clinical risk rather than dataset mass.'
    },
    {
      problem: 'The labels were made by people, and people disagree.',
      detail: 'PTB-XL records were annotated by up to two cardiologists. That is strong by the standards of the field, and it is still two opinions. Reading the same tracings for possible STEMI, physician agreement has been measured at kappa 0.33.',
      k: 'Report agreement, not accuracy',
      answer: 'A model trained against these labels is learning to reproduce a consensus that does not fully exist, and every metric here must be read as <strong>agreement with cardiologists, not accuracy against the patient’s true condition</strong>. Where annotators disagreed, the model is penalised whatever it outputs. We state this rather than let the number imply otherwise.'
    },
    {
      problem: 'AUROC is not clinical usefulness.',
      detail: 'Area under the ROC curve measures ranking. It is invariant to prevalence, invariant to threshold, and silent about the cost of a miss. A model at 0.93 can still produce a positive predictive value low enough to bury a clinic in false alarms.',
      k: 'Bootstrap intervals and the full confusion',
      answer: 'Every metric carries a <strong>percentile bootstrap interval over 1,000 resamples</strong>, and average precision is reported beside AUROC everywhere — because AP is the number that collapses when a class is rare. HYP reads 0.837 AUROC and 0.474 AP. The second number is the honest one. Two models whose intervals overlap are treated as indistinguishable.'
    },
    {
      problem: 'Deep networks are systematically overconfident.',
      detail: 'A screening tool does not decide. It changes what a clinician believes before they do — which only works if the number means something. An overconfident 0.95 and a well-calibrated 0.95 look identical on a dashboard and lead to different actions.',
      k: 'Per-class vector scaling',
      answer: 'A calibration map is fitted on held-out data with the trained model left untouched. A single shared temperature was fitted and <strong>rejected</strong>: one scalar cannot correct five classes each distorted by its own positive weight. Vector scaling learns a slope and intercept per class instead. Mean expected calibration error falls from <strong>0.091 to 0.015</strong>, and AUROC does not move at all.'
    },
    {
      problem: 'Saliency maps are not explanations.',
      detail: 'Published work shows several widely used attribution methods produce convincing maps that barely change when the model’s weights are randomised. A map that survives destroying the model was never explaining the model.',
      k: 'The model-randomisation sanity check, shipped',
      answer: 'Attribution uses Integrated Gradients, which satisfies a completeness axiom — measured convergence delta <strong>0.00093</strong>. It is then run against a randomly initialised network of identical architecture. Correlation collapses to <strong>&minus;0.012</strong>. That collapse is the passing grade. Attributions are presented as evidence of where the model looked, never as a reason it decided.'
    },
    {
      problem: 'Generalisation across hospitals is not free.',
      detail: 'PTB-XL came from one institution, with particular hardware, electrode conventions and filter settings. A model can learn site-specific artefacts that correlate with diagnosis in training and carry no information anywhere else.',
      k: 'Augmentation that mimics the real variation',
      answer: 'Training perturbs amplitude, timing, baseline and noise within ranges that reflect how real recordings differ, and randomly drops one or two leads entirely. <strong>Lead dropout matters most</strong>: a model that still classifies with an electrode missing has learned physiology distributed across twelve views rather than a shortcut in one channel. This narrows the gap. It does not close it, and no external dataset has been tested.'
    }
  ];

  const LIMITS = [
    ['This is not a medical device.', 'No regulatory clearance from any authority, and none sought. It must not be used to make or defer a clinical decision about any person.'],
    ['It has never been tested on a patient.', 'All performance here is retrospective, on stored recordings. There has been no prospective study, no trial, and no measurement of whether the output changes an outcome for anyone.'],
    ['It agrees with cardiologists. It does not know the truth.', 'Labels are cardiologist annotations — not catheterisation findings, echocardiograms, biopsies or outcomes. Where the annotating cardiologists were wrong, the model is trained to be wrong the same way, and these metrics will not detect it.'],
    ['One dataset, one institution, one seed.', 'Evaluated on PTB-XL fold 10 only. Generalisation beyond this cohort, its equipment and its labelling conventions is unestablished. Results come from a single random seed, so seed-to-seed variation is unquantified. Assume degradation until shown otherwise.'],
    ['It sees ten seconds and nothing else.', 'No symptoms, no history, no age, no troponin, no vitals, and no prior ECG. Comparison against a previous tracing is one of the most powerful tools in real ECG reading, and the model does not have it.'],
    ['It cannot detect what it was not trained on.', 'Five superclasses. Not rhythm as such, not valvular or pericardial disease, not pulmonary embolism, not channelopathies, not electrolyte disturbance. Faced with a pathology it has never seen it does not abstain — it returns five probabilities, and they are wrong.'],
    ['Thresholds are a flat 0.5.', 'Every F1, sensitivity and specificity below uses one arbitrary cut-off for all five classes rather than a deliberate per-class operating point. That is a choice not yet made, not a choice already optimised.'],
    ['We do not know when it fails.', 'There is no out-of-distribution detector in this system. It will produce a confident-looking number for an input it has no business being confident about. Calibration is fitted on one distribution and degrades first when that shifts — usually before accuracy does, and usually without warning.']
  ];

  global.Content = { CLASSES, PAIRS, LIMITS };
})(window);
