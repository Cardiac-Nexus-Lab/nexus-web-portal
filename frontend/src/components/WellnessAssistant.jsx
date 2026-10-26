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
//  - Body / hands: Google MediaPipe Pose Landmarker (lite), used to see where the hands are
const FACE_API_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.js';
const FACE_API_MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model';
const TASKS_VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const TASKS_VISION_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const POSE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const TICK_MS = 250;          // run the models 4 times a second; the heart-rate face mesh keeps the full frame rate
const MOOD_WINDOW = 12;       // average emotions over the last ~3 seconds
const GESTURE_HOLD_MS = 2000; // a hand must stay on the chest or head this long before we react

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

function avgPoint(points) {
  const seen = points.filter((p) => p && (p.visibility ?? 1) > 0.3);
  if (seen.length === 0) return null;
  return {
    x: seen.reduce((a, p) => a + p.x, 0) / seen.length,
    y: seen.reduce((a, p) => a + p.y, 0) / seen.length
  };
}

// Where is each hand relative to the body? Returns 'chest', 'head' or null.
// Pose landmarks: 0 nose, 11/12 shoulders, 15/16 wrists, 17-22 pinky/index/thumb.
function locateHands(lm) {
  if (!lm || lm.length < 23) return null;
  const ls = lm[11];
  const rs = lm[12];
  const nose = lm[0];
  if ((ls.visibility ?? 0) < 0.5 || (rs.visibility ?? 0) < 0.5) return null;

  const sw = Math.abs(ls.x - rs.x); // shoulder width, the body's own ruler
  if (sw < 0.05) return null;
  const shoulderY = (ls.y + rs.y) / 2;
  const minX = Math.min(ls.x, rs.x) - 0.1 * sw;
  const maxX = Math.max(ls.x, rs.x) + 0.1 * sw;

  const hands = [
    avgPoint([lm[15], lm[17], lm[19], lm[21]]),
    avgPoint([lm[16], lm[18], lm[20], lm[22]])
  ].filter(Boolean);

  let onHead = false;
  let onChest = false;
  for (const h of hands) {
    const toNose = Math.hypot(h.x - nose.x, h.y - nose.y);
    // at or above nose height, so a hand resting under the chin doesn't count
    if (toNose < 0.8 * sw && h.y < nose.y + 0.1 * sw) onHead = true;
    if (h.x > minX && h.x < maxX && h.y > shoulderY - 0.05 * sw && h.y < shoulderY + 1.1 * sw) onChest = true;
  }
  if (onChest) return 'chest';
  if (onHead) return 'head';
  return null;
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
          : 'Your face shows discomfort. If you feel sick or in pain, point to where it hurts — chest or head.',
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
      'If something hurts, put your hand where it hurts (chest or head) and hold it for two seconds.'
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
  const poseRef = useRef(null);
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
        poseRef.current = await vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1
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

        const pose = poseRef.current.detectForVideo(video, performance.now());
        const where = locateHands(pose?.landmarks?.[0]);
        const now = performance.now();
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
          setAssessment((prev) => (prev && (prev.gesture === 'chest' || prev.gesture === 'head') ? prev : null));
        } else if (confirmed || (mood && moodHistoryRef.current.length >= 4)) {
          setAssessment((prev) => {
            if (!confirmed && prev && (prev.gesture === 'chest' || prev.gesture === 'head') && distress > 0.3) return prev;
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
        poseRef.current?.close();
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
          <Loader2 size={20} className="wa-spin" /> Loading the emotion and body-pose models (first time only)…
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
                  {gesture === 'chest' ? 'On chest' : gesture === 'head' ? 'On head' : 'Not touching chest or head'}
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
                : 'Face the camera. If something hurts, place your hand on your chest or head for two seconds.'}
            </div>
          )}

          <p className="wa-note">Camera-based guidance, not a diagnosis. In an emergency call 112.</p>
        </>
      )}
    </div>
  );
}
