import React, { useEffect, useRef, useState } from 'react';
import './WellnessAssistant.css';
import {
  Brain,
  HeartPulse,
  Hand,
  Phone,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Smile,
  Frown,
  Meh
} from 'lucide-react';

// Pretrained models, loaded from pinned CDN builds:
//  - Emotion: FaceExpressionNet from @vladmandic/face-api (7 classes, trained on labelled face images)
//  - Hands: Google MediaPipe Hand Landmarker, used to see where a hand is resting relative to the face
const FACE_API_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.js';
const FACE_API_MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model';
const TASKS_VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const TASKS_VISION_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const TICK_MS = 250;          // run the models 4 times a second; the heart-rate face mesh keeps the full frame rate
const MOOD_WINDOW = 12;       // average emotions over the last ~3 seconds
const GESTURE_HOLD_MS = 2000; // a hand must stay in one place this long before we react
const FACE_MEMORY_MS = 1500;  // a hand over the face can hide it from the detector; reuse the last box briefly

const REGION_LABELS = {
  chest: 'On chest',
  throat: 'On throat / neck',
  head: 'On head / forehead',
  jaw: 'On jaw / cheek',
  mouth: 'Over mouth',
  eyes: 'Over eyes'
};
// When both hands are somewhere, report the more serious place
const REGION_PRIORITY = ['chest', 'throat', 'head', 'jaw', 'mouth', 'eyes'];

const MOOD_LABELS = {
  neutral: 'Calm',
  happy: 'Happy',
  sad: 'Sad',
  angry: 'Angry / frustrated',
  fearful: 'Anxious / scared',
  disgusted: 'Uncomfortable',
  surprised: 'Surprised'
};

// Indian emergency numbers: 112 (all emergencies), 108 (ambulance), 14416 (Tele-MANAS mental health, 24x7, free)
const HOSPITAL_MAP = 'https://www.google.com/maps/search/hospital+emergency+near+me';
const CLINIC_MAP = 'https://www.google.com/maps/search/clinic+near+me';
const DENTIST_MAP = 'https://www.google.com/maps/search/dentist+near+me';
const EYE_MAP = 'https://www.google.com/maps/search/eye+hospital+near+me';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      if (window.faceapi) return resolve();
      document.querySelector(`script[src="${src}"]`).addEventListener('load', () => resolve());
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// Palm centre (wrist + knuckles) of a hand from MediaPipe's 21 landmarks, in video pixels
function palmCentre(lm, w, h) {
  const idx = [0, 5, 9, 13, 17];
  return {
    x: (idx.reduce((a, i) => a + lm[i].x, 0) / idx.length) * w,
    y: (idx.reduce((a, i) => a + lm[i].y, 0) / idx.length) * h
  };
}

// Where is a hand relative to the face? The face box (brows to chin) is the ruler, so this works
// at any distance from the camera, with the view running from the head down to the chest.
function locateHand(p, box) {
  const u = (p.x - box.x) / box.width;  // 0 = left edge of face, 1 = right edge
  const v = (p.y - box.y) / box.height; // 0 = brows, 1 = chin
  if (v > 1.6 && v < 3.8 && u > -0.9 && u < 1.9) return 'chest';
  if (v >= 0.95 && v <= 1.6 && u > -0.15 && u < 1.15) return 'throat';
  if (v > 0.55 && v < 0.95 && u > 0.25 && u < 0.75) return 'mouth';
  if (v > 0.15 && v <= 0.55 && u > 0.1 && u < 0.9) return 'eyes';
  if (v > 0.4 && v < 1.05 && ((u > -0.35 && u <= 0.3) || (u >= 0.7 && u < 1.35))) return 'jaw';
  if (v > -0.9 && v <= 0.4 && u > -0.5 && u < 1.5) return 'head';
  return null;
}

function locateHands(hands, box, w, h) {
  if (!box || !hands || hands.length === 0) return null;
  const found = hands.map((lm) => locateHand(palmCentre(lm, w, h), box)).filter(Boolean);
  return REGION_PRIORITY.find((r) => found.includes(r)) || null;
}

// Turns what the camera sees into plain advice.
function buildAssessment({ gesture, mood, distress, heartRate }) {
  const fastHr = heartRate && heartRate > 100;
  const hrNote = heartRate ? ` Your camera heart-rate estimate is about ${heartRate} BPM${fastHr ? ', which is fast' : ''}.` : '';

  if (gesture === 'chest') {
    const urgent = distress > 0.45 || fastHr;
    return {
      level: urgent ? 'urgent' : 'warning',
      icon: HeartPulse,
      title: urgent ? 'Hand on chest and you look distressed — possible chest pain' : 'Hand on chest — are you having chest pain?',
      happening:
        'Holding the chest often means pain or tightness there. It can come from the heart (angina or a heart attack), but also from acidity/heartburn, a strained chest muscle, or anxiety.' +
        hrNote,
      doNow: [
        'Stop what you are doing. Sit down and rest; do not walk around or drive yourself.',
        'Loosen tight clothing and take slow breaths.',
        'If the pain is a pressure or squeezing feeling, spreads to the arm, jaw, neck or back, or comes with sweating, breathlessness or nausea: call 108 / 112 now.',
        'While waiting, emergency services commonly advise chewing one regular 300 mg aspirin — only if you are not allergic to it and a doctor has not told you to avoid it.',
        'If you use a prescribed nitroglycerin (GTN) spray for angina, use it as your doctor told you.',
        'If the pain is a burning feeling after food and settles with an antacid, it is more likely acidity — still see a doctor if it comes back.'
      ],
      where: 'Nearest hospital emergency department. Chest pain should be checked the same day — do not wait it out.',
      call: [{ label: 'Call 108 (ambulance)', tel: '108' }, { label: 'Call 112', tel: '112' }],
      map: { label: 'Find nearest emergency hospital', href: HOSPITAL_MAP }
    };
  }

  if (gesture === 'head') {
    const low = mood === 'sad' || mood === 'fearful' || distress > 0.45;
    return {
      level: 'warning',
      icon: Brain,
      title: low ? 'Holding your head and you look low — headache or feeling overwhelmed?' : 'Hand on head — headache?',
      happening:
        'A hand on the head usually means a headache or feeling overwhelmed. Common causes are stress, tension headache, migraine, not drinking enough water, poor sleep, skipped meals or long screen time.' +
        hrNote,
      doNow: [
        'Drink a glass or two of water and eat something light if you skipped a meal.',
        'Rest in a quiet, dim room and take a break from screens for 20–30 minutes.',
        'A cold pack on the forehead or a warm towel on the neck and shoulders can ease it.',
        'Paracetamol 500 mg–1 g (adults) can help; follow the pack label, do not exceed 4 g in a day, and avoid it with liver disease.',
        'Slow breathing: in for 4 seconds, hold 4, out for 6 — repeat for two minutes.'
      ],
      redFlags:
        'Go to emergency (108 / 112) if it is a sudden, worst-ever headache, follows a head injury, or comes with weakness or numbness, a drooping face, slurred speech, confusion, fainting, fever with a stiff neck, or loss of vision.',
      where: 'A general physician or nearby clinic if it lasts more than 2–3 days, keeps coming back, or painkillers do not help.',
      call: [{ label: 'Call 112', tel: '112' }],
      map: { label: 'Find a clinic nearby', href: CLINIC_MAP }
    };
  }

  if (gesture === 'throat') {
    return {
      level: distress > 0.45 ? 'urgent' : 'warning',
      icon: AlertTriangle,
      title: 'Hand on throat — sore throat, or trouble breathing or swallowing?',
      happening:
        'Holding the throat usually means a sore or scratchy throat (often a cold or infection), pain when swallowing, or a feeling of tightness. If someone grips their throat and cannot speak, cough or breathe, they may be choking.' +
        hrNote,
      doNow: [
        'If you cannot speak, cough or breathe: get someone to help now and call 112. A helper should give up to 5 firm back blows between the shoulder blades, then up to 5 abdominal thrusts.',
        'For a sore throat: gargle with warm salt water (half a teaspoon of salt in a glass of warm water) a few times a day.',
        'Sip warm fluids — warm water with honey and lemon, or tea. Avoid very cold or spicy food for now.',
        'Paracetamol (adults 500 mg–1 g, follow the label) can ease the pain; throat lozenges help too.',
        'Rest your voice and stay hydrated.'
      ],
      redFlags:
        'Go to emergency (108 / 112) if breathing is noisy or difficult, you cannot swallow your own saliva or are drooling, the tongue, lips or neck are swelling (possible allergic reaction), or you have high fever with a very stiff neck.',
      where: 'A general physician if it lasts more than a week, keeps coming back, or comes with high fever or white patches on the tonsils.',
      call: [{ label: 'Call 112', tel: '112' }],
      map: { label: 'Find a clinic nearby', href: CLINIC_MAP }
    };
  }

  if (gesture === 'jaw') {
    return {
      level: 'warning',
      icon: Hand,
      title: 'Hand on jaw or cheek — toothache or jaw pain?',
      happening:
        'Holding the cheek or jaw usually means toothache, a sore gum, jaw-joint pain (from clenching or grinding, often with stress), or sinus pressure. Rarely, jaw pain together with chest pressure can come from the heart.' +
        hrNote,
      doNow: [
        'Rinse your mouth with warm salt water and gently floss around the sore tooth.',
        'Hold a cold pack wrapped in a cloth against the outside of the cheek for 15 minutes.',
        'Paracetamol or ibuprofen (follow the label; skip ibuprofen with stomach ulcers, kidney problems or asthma it worsens) can ease the pain.',
        'Eat soft food on the other side and avoid very hot, cold or sweet things.',
        'If you clench your jaw, relax it: lips together, teeth apart, tongue resting on the roof of the mouth.'
      ],
      redFlags:
        'Call 108 / 112 if jaw pain comes with chest pressure, sweating, breathlessness or pain in the arm. Get urgent care if the face or neck is swelling, you have fever, or you find it hard to open the mouth, swallow or breathe.',
      where: 'A dentist for tooth or gum pain, ideally within a day or two; a general physician for jaw-joint or sinus pain that does not settle.',
      call: [],
      map: { label: 'Find a dentist nearby', href: DENTIST_MAP }
    };
  }

  if (gesture === 'mouth') {
    return {
      level: 'warning',
      icon: AlertTriangle,
      title: 'Hand over mouth — feeling sick, or coughing?',
      happening:
        'Covering the mouth often means nausea (feeling like vomiting), a coughing fit, or a mouth or tooth problem. Nausea can come from acidity, something you ate, motion sickness, anxiety or not eating.' +
        hrNote,
      doNow: [
        'Sit upright, loosen tight clothing and breathe slowly through the nose; get some fresh air.',
        'Take small, frequent sips of water or ORS rather than large gulps.',
        'Ginger tea, plain crackers or dry toast can settle the stomach. Avoid oily or heavy food for a few hours.',
        'If coughing: sip warm water with honey, and cough into your elbow; wear a mask if you have a cold.',
        'If you vomit more than a few times, keep sipping ORS to replace lost fluids.'
      ],
      redFlags:
        'Get urgent help (108 / 112) if you vomit blood or something like coffee grounds, have severe belly pain, chest pain, cannot keep any fluids down for a day, or feel faint and very dry (little or no urine).',
      where: 'A general physician if nausea or cough lasts more than a few days or keeps coming back.',
      call: [],
      map: { label: 'Find a clinic nearby', href: CLINIC_MAP }
    };
  }

  if (gesture === 'eyes') {
    const low = mood === 'sad' || distress > 0.45;
    return {
      level: low ? 'support' : 'warning',
      icon: low ? Frown : AlertTriangle,
      title: low ? 'Covering your eyes and you look low — tired, upset or crying?' : 'Hand over eyes — tired or sore eyes?',
      happening: low
        ? 'Covering the eyes with a low mood often means feeling overwhelmed, tired or upset. It can also be eye strain after a long time at a screen.'
        : 'Rubbing or covering the eyes usually means eye strain from screens, tiredness, dry eyes, allergy, or something in the eye.',
      doNow: [
        'Try not to rub your eyes — it can make irritation worse.',
        '20-20-20 rule: every 20 minutes, look at something 20 feet away for 20 seconds, and blink fully.',
        'If something is in the eye, rinse it with clean running water for a few minutes.',
        'A cool, damp cloth over closed eyes for a few minutes can soothe them; lubricating eye drops help dry eyes.',
        low
          ? 'If you feel overwhelmed, take a short break, drink water, and talk to someone you trust.'
          : 'Make sure you are getting enough sleep tonight.'
      ],
      redFlags:
        'Go to emergency eye care right away for sudden loss or blurring of vision, an eye injury, a chemical splash (rinse with water for 15 minutes first), or severe eye pain with redness and headache.',
      where: low
        ? 'Tele-MANAS (14416, free, 24x7) if you are feeling low often; an eye doctor if your eyes stay red or sore for more than 2 days.'
        : 'An eye doctor (ophthalmologist) if redness, pain or blurry vision lasts more than 2 days.',
      call: low ? [{ label: 'Call Tele-MANAS 14416', tel: '14416' }] : [],
      map: low ? null : { label: 'Find an eye doctor nearby', href: EYE_MAP }
    };
  }

  if (mood === 'sad') {
    return {
      level: 'support',
      icon: Frown,
      title: 'You seem sad',
      happening:
        'Your face has looked sad for the last few seconds. Everyone has low moments — stress, tiredness, loneliness or worries can all bring them on.',
      doNow: [
        'Talk to someone you trust — a friend, family member or classmate — even a short call helps.',
        'Step outside for a 10-minute walk or some sunlight.',
        'Try slow breathing: in for 4 seconds, hold 4, out for 6, for two minutes.',
        'Drink water, eat something, and try to get proper sleep tonight.',
        'Write down what is on your mind; it often makes it feel smaller.'
      ],
      redFlags:
        'If you have felt low most days for two weeks or more, or have any thoughts of hurting yourself, please reach out now — call Tele-MANAS on 14416 (free, 24x7) or 112.',
      where: 'Tele-MANAS (14416), a college counsellor, or a doctor if the sadness keeps coming back.',
      call: [{ label: 'Call Tele-MANAS 14416', tel: '14416' }],
      map: null
    };
  }

  if (mood === 'fearful') {
    return {
      level: 'support',
      icon: AlertTriangle,
      title: 'You look anxious',
      happening: 'Your expression looks worried or scared. Anxiety can also cause a fast heartbeat, tight chest or shaky breathing.' + hrNote,
      doNow: [
        'Box breathing: in 4 seconds, hold 4, out 4, hold 4 — repeat for two minutes.',
        'Grounding: name 5 things you can see, 4 you can touch, 3 you can hear.',
        'Sit somewhere comfortable and drink some water.',
        'If you also have chest pain, put your hand on your chest so the check can guide you.'
      ],
      where: 'If anxiety keeps happening, talk to a doctor or call Tele-MANAS on 14416.',
      call: [{ label: 'Call Tele-MANAS 14416', tel: '14416' }],
      map: null
    };
  }

  if (mood === 'angry' || mood === 'disgusted') {
    return {
      level: 'support',
      icon: Meh,
      title: mood === 'angry' ? 'You look frustrated' : 'You look uncomfortable',
      happening:
        mood === 'angry'
          ? 'Your face shows frustration or tension. Stress raises heart rate and blood pressure for a while.' + hrNote
          : 'Your face shows discomfort. If you feel sick or in pain, put your hand where it hurts.',
      doNow: [
        'Step away from what is bothering you for a few minutes.',
        'Breathe out slowly, longer than you breathe in.',
        'Drink some water and loosen your shoulders and jaw.'
      ],
      where: 'If you feel unwell, see a doctor.',
      call: [],
      map: null
    };
  }

  if (mood === 'happy') {
    return {
      level: 'good',
      icon: Smile,
      title: 'You look happy',
      happening: 'No signs of pain or distress. Your expression is positive.' + hrNote,
      doNow: ['Keep it up — stay hydrated, keep moving, and sleep well.'],
      where: null,
      call: [],
      map: null
    };
  }

  return {
    level: 'good',
    icon: CheckCircle2,
    title: mood === 'surprised' ? 'You look surprised' : 'You look calm',
    happening: 'No signs of pain or distress right now.' + hrNote,
    doNow: [
      'If something hurts, put your hand where it hurts (head, eyes, jaw, mouth, throat or chest) and hold it there for two seconds.'
    ],
    where: null,
    call: [],
    map: null
  };
}

const LEVEL_STYLES = {
  urgent: { bg: '#fef2f2', border: '#fecaca', accent: '#dc2626' },
  warning: { bg: '#fffbeb', border: '#fde68a', accent: '#d97706' },
  support: { bg: '#eff6ff', border: '#bfdbfe', accent: '#2563eb' },
  good: { bg: '#f0fdf4', border: '#bbf7d0', accent: '#16a34a' }
};

export default function WellnessAssistant({ videoRef, cameraActive, heartRate, onMood }) {
  const [modelStatus, setModelStatus] = useState('idle'); // idle | loading | ready | error
  const [faceSeen, setFaceSeen] = useState(false);
  const [moodProbs, setMoodProbs] = useState(null);
  const [gesture, setGesture] = useState(null);
  const [gestureProgress, setGestureProgress] = useState(0);
  const [assessment, setAssessment] = useState(null);

  const faceApiRef = useRef(null);
  const handsRef = useRef(null);
  const lastFaceRef = useRef({ box: null, at: 0 });
  const timerRef = useRef(null);
  const loadStartedRef = useRef(false);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const moodHistoryRef = useRef([]);
  const gestureSinceRef = useRef({ kind: null, since: 0 });
  const heartRateRef = useRef(heartRate);
  const onMoodRef = useRef(onMood);
  heartRateRef.current = heartRate;
  onMoodRef.current = onMood;

  // Load both models the first time the camera turns on
  useEffect(() => {
    if (!cameraActive || loadStartedRef.current) return;
    loadStartedRef.current = true;
    (async () => {
      setModelStatus('loading');
      try {
        await loadScript(FACE_API_URL);
        const faceapi = window.faceapi;
        await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODELS);
        await faceapi.nets.faceExpressionNet.loadFromUri(FACE_API_MODELS);
        faceApiRef.current = faceapi;

        const vision = await import(/* @vite-ignore */ TASKS_VISION_URL);
        const fileset = await vision.FilesetResolver.forVisionTasks(TASKS_VISION_WASM);
        handsRef.current = await vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2
        });
        if (mountedRef.current) setModelStatus('ready');
      } catch (err) {
        console.error('Wellness assistant model load failed:', err);
        loadStartedRef.current = false;
        if (mountedRef.current) setModelStatus('error');
      }
    })();
  }, [cameraActive]);

  // Analysis loop
  useEffect(() => {
    if (!cameraActive || modelStatus !== 'ready') {
      setFaceSeen(false);
      setGesture(null);
      setGestureProgress(0);
      setAssessment(null);
      moodHistoryRef.current = [];
      return;
    }

    const tick = async () => {
      const video = videoRef.current;
      if (busyRef.current || !video || video.readyState < 2 || !video.videoWidth) return;
      busyRef.current = true;
      try {
        const faceapi = faceApiRef.current;
        const face = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
          .withFaceExpressions();

        let probs = null;
        if (face) {
          moodHistoryRef.current.push(face.expressions);
          if (moodHistoryRef.current.length > MOOD_WINDOW) moodHistoryRef.current.shift();
        } else {
          moodHistoryRef.current = [];
        }
        if (moodHistoryRef.current.length > 0) {
          probs = {};
          for (const k of Object.keys(MOOD_LABELS)) {
            probs[k] = moodHistoryRef.current.reduce((a, e) => a + (e[k] || 0), 0) / moodHistoryRef.current.length;
          }
        }

        const now = performance.now();
        if (face) lastFaceRef.current = { box: face.detection.box, at: now };
        const faceBox = now - lastFaceRef.current.at < FACE_MEMORY_MS ? lastFaceRef.current.box : null;
        const hands = handsRef.current.detectForVideo(video, now);
        const where = locateHands(hands?.landmarks, faceBox, video.videoWidth, video.videoHeight);
        if (where !== gestureSinceRef.current.kind) gestureSinceRef.current = { kind: where, since: now };
        const heldMs = where ? now - gestureSinceRef.current.since : 0;
        const confirmed = where && heldMs >= GESTURE_HOLD_MS ? where : null;

        const mood = probs ? Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0] : null;
        const distress = probs ? probs.sad + probs.fearful + probs.angry + probs.disgusted : 0;

        setFaceSeen(Boolean(face));
        setMoodProbs(probs);
        setGesture(where);
        setGestureProgress(where ? Math.min(1, heldMs / GESTURE_HOLD_MS) : 0);
        if (onMoodRef.current) onMoodRef.current(mood ? MOOD_LABELS[mood] : null);

        // Only change the advice when we have something to go on; keep a chest/head alert
        // on screen until the person is clearly calm again, so it doesn't flicker away.
        if (!face && !confirmed) {
          setAssessment((prev) => (prev?.gesture ? prev : null));
        } else if (confirmed || (mood && moodHistoryRef.current.length >= 4)) {
          setAssessment((prev) => {
            if (!confirmed && prev?.gesture && distress > 0.3) return prev;
            return { ...buildAssessment({ gesture: confirmed, mood, distress, heartRate: heartRateRef.current }), gesture: confirmed };
          });
        }
      } catch (err) {
        console.warn('Wellness assistant frame skipped:', err);
      } finally {
        busyRef.current = false;
      }
    };

    timerRef.current = setInterval(tick, TICK_MS);
    return () => clearInterval(timerRef.current);
  }, [cameraActive, modelStatus, videoRef]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try {
        handsRef.current?.close();
      } catch (_) {}
    };
  }, []);

  const topMood = moodProbs ? Object.entries(moodProbs).sort((a, b) => b[1] - a[1])[0] : null;
  const MoodIcon = !topMood ? Meh : topMood[0] === 'happy' ? Smile : topMood[0] === 'sad' ? Frown : Meh;
  const style = assessment ? LEVEL_STYLES[assessment.level] : LEVEL_STYLES.good;
  const AssessIcon = assessment?.icon;

  return (
    <div className="wellness-assistant">
      <div className="wa-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Brain size={18} style={{ color: '#0d7482' }} />
          <b style={{ fontSize: 15 }}>Wellness Assistant</b>
        </div>
        <span className="wa-status">
          {!cameraActive
            ? 'Turn on the camera to start'
            : modelStatus === 'loading'
            ? 'Loading models…'
            : modelStatus === 'error'
            ? 'Models failed to load — check the internet connection and refresh'
            : 'Live'}
        </span>
      </div>

      {cameraActive && modelStatus === 'loading' && (
        <div className="wa-empty">
          <Loader2 size={20} className="wa-spin" /> Loading the emotion and hand-tracking models (first time only)…
        </div>
      )}

      {cameraActive && modelStatus === 'ready' && (
        <>
          <div className="wa-live">
            <div className="wa-tile">
              <MoodIcon size={22} style={{ color: '#0d7482' }} />
              <div>
                <div className="wa-tile-label">Mood</div>
                <div className="wa-tile-value">{faceSeen && topMood ? MOOD_LABELS[topMood[0]] : 'No face in view'}</div>
              </div>
            </div>
            <div className="wa-tile">
              <Hand size={22} style={{ color: gesture ? '#d97706' : '#0d7482' }} />
              <div style={{ flex: 1 }}>
                <div className="wa-tile-label">Hands</div>
                <div className="wa-tile-value">
                  {gesture ? REGION_LABELS[gesture] : 'Not touching face, neck or chest'}
                </div>
                {gesture && gestureProgress < 1 && (
                  <div className="wa-hold">
                    <div style={{ width: `${gestureProgress * 100}%` }} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {moodProbs && faceSeen && (
            <div className="wa-bars">
              {Object.entries(moodProbs)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <div key={k} className="wa-bar-row">
                    <span>{MOOD_LABELS[k]}</span>
                    <div className="wa-bar">
                      <div style={{ width: `${Math.round(v * 100)}%` }} />
                    </div>
                    <span className="wa-pct">{Math.round(v * 100)}%</span>
                  </div>
                ))}
            </div>
          )}

          {assessment ? (
            <div className="wa-card" style={{ background: style.bg, borderColor: style.border }}>
              <div className="wa-card-title" style={{ color: style.accent }}>
                {AssessIcon && <AssessIcon size={20} />}
                <span>{assessment.title}</span>
              </div>

              <div className="wa-section">
                <b>What may be happening</b>
                <p>{assessment.happening}</p>
              </div>

              <div className="wa-section">
                <b>What you can do now</b>
                <ul>
                  {assessment.doNow.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>

              {assessment.redFlags && (
                <div className="wa-section wa-red">
                  <b>Get help immediately if</b>
                  <p>{assessment.redFlags}</p>
                </div>
              )}

              {assessment.where && (
                <div className="wa-section">
                  <b>Where to go</b>
                  <p>{assessment.where}</p>
                </div>
              )}

              {(assessment.call.length > 0 || assessment.map) && (
                <div className="wa-actions">
                  {assessment.call.map((c) => (
                    <a key={c.tel} href={`tel:${c.tel}`} className="wa-btn" style={{ background: style.accent }}>
                      <Phone size={14} /> {c.label}
                    </a>
                  ))}
                  {assessment.map && (
                    <a href={assessment.map.href} target="_blank" rel="noreferrer" className="wa-btn wa-btn-light">
                      <MapPin size={14} /> {assessment.map.label}
                    </a>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="wa-empty">
              {faceSeen
                ? 'Reading your expression…'
                : 'Sit so the camera sees you from head to chest. If something hurts, hold your hand there for two seconds.'}
            </div>
          )}

          <p className="wa-note">Camera-based guidance, not a diagnosis. In an emergency call 112.</p>
        </>
      )}
    </div>
  );
}
