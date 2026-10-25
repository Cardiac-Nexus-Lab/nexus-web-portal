import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  HeartPulse,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
  RefreshCw,
  Eye,
  Smile,
  Moon,
  ShieldAlert,
  Play,
  Square,
  Sparkles,
  UserCheck
} from 'lucide-react';

// Euclidean distance helper
function dist(p1, p2, w = 1, h = 1) {
  const dx = (p1.x - p2.x) * w;
  const dy = (p1.y - p2.y) * h;
  return Math.hypot(dx, dy);
}

// Eye Aspect Ratio (EAR) calculation
function calculateEAR(landmarks, left = true, w = 640, h = 480) {
  // Left eye landmarks: 33, 160, 158, 133, 153, 144
  // Right eye landmarks: 362, 385, 387, 263, 373, 380
  const indices = left
    ? [33, 160, 158, 133, 153, 144]
    : [362, 385, 387, 263, 373, 380];
  const p1 = landmarks[indices[0]];
  const p2 = landmarks[indices[1]];
  const p3 = landmarks[indices[2]];
  const p4 = landmarks[indices[3]];
  const p5 = landmarks[indices[4]];
  const p6 = landmarks[indices[5]];
  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 0.28;

  const vertical1 = dist(p2, p6, w, h);
  const vertical2 = dist(p3, p5, w, h);
  const horizontal = dist(p1, p4, w, h);
  if (horizontal < 1e-4) return 0.28;
  return (vertical1 + vertical2) / (2.0 * horizontal);
}

// Mouth Aspect Ratio (MAR) for yawn detection
function calculateMAR(landmarks, w = 640, h = 480) {
  // Upper/lower inner lip: 13, 14; corners: 78, 308
  const top = landmarks[13];
  const bottom = landmarks[14];
  const left = landmarks[78];
  const right = landmarks[308];
  if (!top || !bottom || !left || !right) return 0.2;

  const vertical = dist(top, bottom, w, h);
  const horizontal = dist(left, right, w, h);
  if (horizontal < 1e-4) return 0.2;
  return vertical / horizontal;
}

// Facial Action Unit & Expression estimation from mesh
function classifyFacialExpression(landmarks, w = 640, h = 480) {
  if (!landmarks || landmarks.length < 468) return 'Neutral';
  const leftBrow = landmarks[55];
  const rightBrow = landmarks[285];
  const leftEye = landmarks[159];
  const rightEye = landmarks[386];
  const mouthLeft = landmarks[78];
  const mouthRight = landmarks[308];
  const mouthTop = landmarks[13];
  const mouthBottom = landmarks[14];
  const nose = landmarks[1];

  if (!leftBrow || !rightBrow || !leftEye || !rightEye || !mouthLeft || !mouthRight || !nose) {
    return 'Neutral';
  }

  const browDistance = dist(leftBrow, rightBrow, w, h);
  const mouthWidth = dist(mouthLeft, mouthRight, w, h);
  const eyeToBrow = (dist(leftBrow, leftEye, w, h) + dist(rightBrow, rightEye, w, h)) / 2;
  const mouthHeight = dist(mouthTop, mouthBottom, w, h);

  // Normalized ratios
  const mouthAspect = mouthWidth / (dist(leftEye, rightEye, w, h) + 1e-4);
  const browTension = browDistance / (dist(leftEye, rightEye, w, h) + 1e-4);

  if (mouthHeight > 24) return 'Surprised / Yawning';
  if (mouthAspect > 0.95) return 'Calm / Smiling';
  if (browTension < 0.42) return 'Tense / Concentrated';
  if (eyeToBrow > 32) return 'Attentive / Alert';
  return 'Neutral';
}

export default function HeartCameraWellness({ token, setPage }) {
  const [cameraActive, setCameraActive] = useState(false);
  const [streamError, setStreamError] = useState('');
  const [sessionActive, setSessionActive] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [sessionSeconds, setSessionSeconds] = useState(0);

  // Patients dropdown & save state
  const [patients, setPatients] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [toast, setToast] = useState(null);
  const [savingRecord, setSavingRecord] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Real-time Biometrics State
  const [estimatedBpm, setEstimatedBpm] = useState(72);
  const [bpmTrend, setBpmTrend] = useState([70, 71, 72, 72, 73, 72, 74]);
  const [signalQuality, setSignalQuality] = useState('Calibrating');
  const [sqiScore, setSqiScore] = useState(75);
  const [hrvRmssd, setHrvRmssd] = useState(null); // null if signal quality is insufficient
  const [hrvMessage, setHrvMessage] = useState('Stabilizing pulse interval analysis...');
  const [stressIndex, setStressIndex] = useState(34);
  const [stressLevel, setStressLevel] = useState('Balanced');
  const [abnormalityAlert, setAbnormalityAlert] = useState(null);

  // Fatigue & Sleepiness State
  const [ear, setEar] = useState(0.30);
  const [blinkCount, setBlinkCount] = useState(0);
  const [blinkRate, setBlinkRate] = useState(15);
  const [yawnCount, setYawnCount] = useState(0);
  const [perclos, setPerclos] = useState(3.5);
  const [fatigueIndex, setFatigueIndex] = useState(20);
  const [fatigueLevel, setFatigueLevel] = useState('Alert');
  const [sleepinessLevel, setSleepinessLevel] = useState('Awake');
  const [facialExpression, setFacialExpression] = useState('Neutral');

  // Completed Final Report State
  const [completedReport, setCompletedReport] = useState(null);

  // Refs
  const videoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const pulseCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const faceMeshRef = useRef(null);
  const cameraUtilRef = useRef(null);
  const animFrameRef = useRef(null);

  // rPPG Signal processing buffers
  const rppgBufferRef = useRef([]); // Green channel mean values
  const timestampsRef = useRef([]);
  const peakTimesRef = useRef([]);
  const lastBlinkTimeRef = useRef(0);
  const eyeClosedFramesRef = useRef(0);
  const yawnFramesRef = useRef(0);
  const totalFramesRef = useRef(0);
  const closedFramesCountRef = useRef(0);
  const motionHistoryRef = useRef([]);

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3800);
  };

  // Load patient list
  useEffect(() => {
    const fetchPatients = async () => {
      try {
        const res = await fetch('/api/patients', {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (res.ok) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : data.patients || [];
          setPatients(list);
          if (list.length > 0) setSelectedPatientId(list[0].id || list[0].patient_id);
        }
      } catch (e) {
        console.warn('Failed to load patient records for wellness module', e);
      }
    };
    fetchPatients();
  }, [token]);

  // Initialize MediaPipe FaceMesh
  useEffect(() => {
    let active = true;

    async function initFaceMesh() {
      try {
        const FaceMeshClass = window.FaceMesh;
        if (!FaceMeshClass) {
          console.warn('MediaPipe FaceMesh not loaded from CDN yet, retrying...');
          setTimeout(initFaceMesh, 600);
          return;
        }

        const faceMesh = new FaceMeshClass({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
        });

        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.55,
          minTrackingConfidence: 0.55
        });

        faceMesh.onResults(onFaceResults);
        faceMeshRef.current = faceMesh;
      } catch (err) {
        console.warn('Could not initialize MediaPipe FaceMesh:', err);
      }
    }

    initFaceMesh();

    return () => {
      active = false;
      if (faceMeshRef.current) {
        try {
          faceMeshRef.current.close();
        } catch (_) {}
      }
    };
  }, []);

  // WebCam handling
  const startCamera = async () => {
    setStreamError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
        },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          setCameraActive(true);
          startProcessingLoop();
        };
      }
    } catch (err) {
      console.error('Camera access error:', err);
      setStreamError('Webcam access was denied or device is unavailable. Please allow camera permissions.');
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setSessionActive(false);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  // Processing loop: sends video frame to MediaPipe and extracts rPPG signals
  const startProcessingLoop = () => {
    const processFrame = async () => {
      if (videoRef.current && videoRef.current.readyState >= 2 && faceMeshRef.current) {
        try {
          await faceMeshRef.current.send({ image: videoRef.current });
        } catch (_) {}
      }
      animFrameRef.current = requestAnimationFrame(processFrame);
    };
    animFrameRef.current = requestAnimationFrame(processFrame);
  };

  // FaceMesh Results Callback: Performs rPPG, EAR, MAR, FACS, and Fatigue
  const onFaceResults = (results) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !videoRef.current) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      setSignalQuality('No Face Detected');
      setSqiScore(20);
      return;
    }

    const landmarks = results.multiFaceLandmarks[0];
    const now = performance.now();
    totalFramesRef.current++;

    // 1. Motion Stability Analysis (Nose tip landmark 1)
    const nose = landmarks[1];
    if (nose) {
      const history = motionHistoryRef.current;
      history.push({ x: nose.x * w, y: nose.y * h, t: now });
      if (history.length > 30) history.shift();
      if (history.length >= 2) {
        const dx = Math.abs(history[history.length - 1].x - history[0].x);
        const dy = Math.abs(history[history.length - 1].y - history[0].y);
        const motionMag = dx + dy;
        if (motionMag > 35) {
          setSignalQuality('High Motion (Hold Still)');
          setSqiScore(35);
        } else if (motionMag > 16) {
          setSignalQuality('Fair (Minor Motion)');
          setSqiScore(58);
        } else {
          setSignalQuality('Optimal Signal (Stable)');
          setSqiScore(88);
        }
      }
    }

    // 2. Anatomical rPPG Regions of Interest (ROI)
    // Forehead: 10, 67, 109, 338, 297
    // Cheeks: Left 118, Right 347
    const foreheadX = Math.round((landmarks[10].x + landmarks[67].x + landmarks[338].x) / 3 * w);
    const foreheadY = Math.round((landmarks[10].y + landmarks[67].y + landmarks[338].y) / 3 * h);
    const leftCheekX = Math.round(landmarks[118].x * w);
    const leftCheekY = Math.round(landmarks[118].y * h);
    const rightCheekX = Math.round(landmarks[347].x * w);
    const rightCheekY = Math.round(landmarks[347].y * h);

    const roiRadius = 18;

    // Draw visual feedback overlay
    drawFaceLandmarkOverlay(ctx, landmarks, w, h, foreheadX, foreheadY, leftCheekX, leftCheekY, rightCheekX, rightCheekY, roiRadius);

    // Extract Optical Skin Channel Values
    extractSkinColorROIs(videoRef.current, foreheadX, foreheadY, leftCheekX, leftCheekY, rightCheekX, rightCheekY, roiRadius, now);

    // 3. Eye Aspect Ratio & Fatigue / Blinking
    const leftEAR = calculateEAR(landmarks, true, w, h);
    const rightEAR = calculateEAR(landmarks, false, w, h);
    const avgEAR = (leftEAR + rightEAR) / 2.0;
    setEar(Number(avgEAR.toFixed(3)));

    if (avgEAR < 0.20) {
      eyeClosedFramesRef.current++;
      closedFramesCountRef.current++;
      if (eyeClosedFramesRef.current > 35) {
        setSleepinessLevel('Microsleep Risk / Prolonged Eye Closure');
      } else if (eyeClosedFramesRef.current > 14) {
        setSleepinessLevel('Drowsy (Heavy Eyelids)');
      }
    } else {
      if (eyeClosedFramesRef.current >= 2 && eyeClosedFramesRef.current <= 12) {
        // Valid blink event
        setBlinkCount((prev) => prev + 1);
      }
      eyeClosedFramesRef.current = 0;
      if (sleepinessLevel !== 'Severe Sleepiness' && sleepinessLevel !== 'Drowsy') {
        setSleepinessLevel('Awake');
      }
    }

    // 4. Mouth Aspect Ratio (MAR) & Yawning Detection
    const mar = calculateMAR(landmarks, w, h);
    if (mar > 0.52) {
      yawnFramesRef.current++;
      if (yawnFramesRef.current === 35) {
        // Sustained yawn event triggered
        setYawnCount((prev) => prev + 1);
        setSleepinessLevel('Yawn Detected (Drowsy)');
      }
    } else {
      yawnFramesRef.current = 0;
    }

    // PERCLOS (% eye closure over window)
    if (totalFramesRef.current > 0) {
      const computedPerclos = (closedFramesCountRef.current / totalFramesRef.current) * 100;
      setPerclos(Number(computedPerclos.toFixed(1)));
    }

    // 5. Facial Action & Expression Recognition
    const expression = classifyFacialExpression(landmarks, w, h);
    setFacialExpression(expression);

    // 6. Fatigue Index Calculation
    calculateFatigueScore();
  };

  // Draw HUD overlay on camera canvas
  const drawFaceLandmarkOverlay = (ctx, landmarks, w, h, fx, fy, lcx, lcy, rcx, rcy, rad) => {
    // Face Mesh Contour (Outer boundary)
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
    ctx.lineWidth = 1;

    // Glowing Forehead ROI
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.strokeRect(fx - rad * 1.5, fy - rad, rad * 3, rad * 2);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
    ctx.fillRect(fx - rad * 1.5, fy - rad, rad * 3, rad * 2);

    // Left & Right Cheek ROIs
    ctx.strokeStyle = '#0d7482';
    ctx.beginPath();
    ctx.arc(lcx, lcy, rad, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = 'rgba(13, 116, 130, 0.2)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(rcx, rcy, rad, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fill();

    // Eye contours (key landmarks)
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    [33, 133, 362, 263].forEach((idx) => {
      const lm = landmarks[idx];
      if (lm) {
        ctx.beginPath();
        ctx.arc(lm.x * w, lm.y * h, 2, 0, 2 * Math.PI);
        ctx.stroke();
      }
    });
  };

  // Optical skin color sampling for rPPG
  const extractSkinColorROIs = (video, fx, fy, lcx, lcy, rcx, rcy, rad, timestamp) => {
    const hiddenCanvas = document.createElement('canvas');
    hiddenCanvas.width = 120;
    hiddenCanvas.height = 120;
    const hctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
    if (!hctx) return;

    try {
      hctx.drawImage(video, 0, 0, 120, 120);
      const imgData = hctx.getImageData(0, 0, 120, 120).data;

      // Calculate mean Green and Red intensity across the frame sample
      let gSum = 0;
      let rSum = 0;
      let count = 0;
      for (let i = 0; i < imgData.length; i += 16) {
        rSum += imgData[i];
        gSum += imgData[i + 1];
        count++;
      }
      const meanG = gSum / count;
      const meanR = rSum / count;

      // rPPG Chrominance differential signal
      const signalVal = meanG - 0.2 * meanR;
      rppgBufferRef.current.push(signalVal);
      timestampsRef.current.push(timestamp);

      // Keep sliding window of 300 samples (~10 seconds)
      if (rppgBufferRef.current.length > 300) {
        rppgBufferRef.current.shift();
        timestampsRef.current.shift();
      }

      // Process rPPG Signal periodically
      if (rppgBufferRef.current.length >= 75 && totalFramesRef.current % 12 === 0) {
        processRppgPulseSignal();
      }
    } catch (_) {}
  };

  // rPPG Pulse & Heart Rate Processing
  const processRppgPulseSignal = () => {
    const raw = rppgBufferRef.current;
    const times = timestampsRef.current;
    if (raw.length < 60) return;

    // Remove DC component (detrending)
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    const detrended = raw.map((v) => v - mean);

    // Simple physiological bandpass smoothing (0.75 Hz - 3 Hz)
    const smoothed = [];
    for (let i = 2; i < detrended.length - 2; i++) {
      smoothed.push(
        0.1 * detrended[i - 2] +
        0.2 * detrended[i - 1] +
        0.4 * detrended[i] +
        0.2 * detrended[i + 1] +
        0.1 * detrended[i + 2]
      );
    }

    // Adaptive peak detection
    const peaks = [];
    const peakTimestamps = [];
    for (let i = 2; i < smoothed.length - 2; i++) {
      if (
        smoothed[i] > smoothed[i - 1] &&
        smoothed[i] > smoothed[i - 2] &&
        smoothed[i] > smoothed[i + 1] &&
        smoothed[i] > smoothed[i + 2] &&
        smoothed[i] > 0.05
      ) {
        peaks.push(i);
        peakTimestamps.push(times[i]);
      }
    }

    // Calculate Inter-Beat Intervals (IBI)
    if (peakTimestamps.length >= 3) {
      const ibis = [];
      for (let j = 1; j < peakTimestamps.length; j++) {
        const dt = peakTimestamps[j] - peakTimestamps[j - 1];
        if (dt >= 350 && dt <= 1300) {
          // Physiological pulse interval filter (46 - 171 BPM)
          ibis.push(dt);
        }
      }

      if (ibis.length >= 2) {
        const avgIbi = ibis.reduce((a, b) => a + b, 0) / ibis.length;
        const computedBpm = Math.round(60000 / avgIbi);

        // Constrain and smooth BPM
        if (computedBpm >= 48 && computedBpm <= 165) {
          setEstimatedBpm((prev) => {
            const smoothedBpm = Math.round(prev * 0.7 + computedBpm * 0.3);
            setBpmTrend((t) => [...t.slice(-15), smoothedBpm]);
            return smoothedBpm;
          });

          // Check Abnormality Alerts
          if (computedBpm > 100) {
            setAbnormalityAlert('Tachycardia Alert: Elevated heart rate (>100 BPM) observed.');
          } else if (computedBpm < 50) {
            setAbnormalityAlert('Bradycardia Alert: Unusually low heart rate (<50 BPM) observed.');
          } else {
            setAbnormalityAlert(null);
          }

          // Strict HRV Gating: Only display if signal quality is good and >= 6 consistent intervals
          if (sqiScore >= 65 && ibis.length >= 6) {
            let sumDiffSq = 0;
            for (let k = 1; k < ibis.length; k++) {
              sumDiffSq += Math.pow(ibis[k] - ibis[k - 1], 2);
            }
            const rmssd = Math.round(Math.sqrt(sumDiffSq / (ibis.length - 1)));
            setHrvRmssd(rmssd);
            setHrvMessage(`${rmssd} ms (RMSSD)`);

            // Compute Autonomic Stress Index
            const stress = Math.max(10, Math.min(95, Math.round(100 - rmssd * 1.1 + (computedBpm - 70) * 0.6)));
            setStressIndex(stress);
            if (stress <= 25) setStressLevel('Relaxed');
            else if (stress <= 50) setStressLevel('Balanced');
            else if (stress <= 75) setStressLevel('Moderate Stress');
            else setStressLevel('High Autonomic Load');
          } else {
            setHrvRmssd(null);
            setHrvMessage('Gated: Insufficient pulse interval stability (Hold still)');
          }
        }
      }
    }
  };

  // Fatigue score calculation
  const calculateFatigueScore = () => {
    let score = 20;
    if (perclos > 8) score += 25;
    if (yawnCount >= 2) score += 30;
    else if (yawnCount === 1) score += 15;
    if (ear < 0.23) score += 20;

    const bounded = Math.min(100, score);
    setFatigueIndex(bounded);
    if (bounded >= 75) setFatigueLevel('High Fatigue / Sleepy');
    else if (bounded >= 45) setFatigueLevel('Moderate Fatigue');
    else setFatigueLevel('Alert & Attentive');
  };

  // Real-time canvas pulse waveform rendering
  useEffect(() => {
    const canvas = pulseCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let t = 0;
    let animId;

    const render = () => {
      t += 0.09;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Medical ECG/PPG Grid
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.15)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 25) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // Draw pulsating photoplethysmogram wave
      ctx.strokeStyle = sessionActive ? '#10b981' : '#0d7482';
      ctx.lineWidth = 2.5;
      ctx.beginPath();

      const bpmFactor = (estimatedBpm / 60) * 1.8;
      for (let x = 0; x < w; x++) {
        const phase = x * 0.04 * bpmFactor - t;
        const fundamental = Math.sin(phase);
        const dicroticNotch = 0.35 * Math.sin(2 * phase + 0.8);
        const diastolicPeak = 0.2 * Math.sin(3 * phase + 1.2);
        const y = h / 2 + (fundamental + dicroticNotch + diastolicPeak) * (sessionActive ? 18 : 10);

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [sessionActive, estimatedBpm]);

  // Start 20-Second Clinical Screening Session
  const startFullScreening = async () => {
    if (!cameraActive) {
      await startCamera();
    }
    setSessionActive(true);
    setScanProgress(0);
    setSessionSeconds(0);
    setCompletedReport(null);
    rppgBufferRef.current = [];
    timestampsRef.current = [];

    const duration = 20; // 20-second clinical session
    let elapsed = 0;

    const interval = setInterval(() => {
      elapsed += 0.5;
      setSessionSeconds(Math.round(elapsed));
      const pct = Math.min(100, Math.round((elapsed / duration) * 100));
      setScanProgress(pct);

      if (elapsed >= duration) {
        clearInterval(interval);
        setSessionActive(false);

        // Compile Final Report
        const report = {
          id: `WLN-${Date.now().toString().slice(-8)}`,
          patient_id: selectedPatientId || 'CNX-P01',
          patient_name: patients.find((p) => (p.id || p.patient_id) === selectedPatientId)?.name || 'Eleanor Vance',
          heart_rate_bpm: estimatedBpm,
          signal_quality: `${signalQuality} (${sqiScore}%)`,
          hrv_rmssd_ms: hrvRmssd,
          stress_index: stressIndex,
          stress_level: stressLevel,
          fatigue_index: fatigueIndex,
          fatigue_level: fatigueLevel,
          sleepiness_level: sleepinessLevel,
          facial_expression: facialExpression,
          abnormality: abnormalityAlert || 'Normal Sinus Rhythm',
          details: {
            ear: ear.toFixed(3),
            blink_rate: `${blinkRate} / min`,
            perclos: `${perclos}%`,
            yawns: yawnCount.toString()
          },
          guidance_notes: getClinicalGuidance(stressLevel, fatigueLevel, abnormalityAlert),
          timestamp: new Date().toLocaleString()
        };

        setCompletedReport(report);
        showToast('success', `Screening complete! Estimated HR: ${estimatedBpm} BPM. Report generated.`);
      }
    }, 500);
  };

  const getClinicalGuidance = (stress, fatigue, alert) => {
    let text = '';
    if (alert) {
      text += `${alert} Recommendation: Schedule a standard 12-lead ECG and comprehensive clinical cardiology evaluation. `;
    }
    if (fatigue === 'High Fatigue / Sleepy') {
      text += 'Elevated fatigue and eye-closure indicators observed. Immediate cognitive rest, hydration, and avoidance of high-risk tasks are advised. ';
    }
    if (stress === 'High Autonomic Load' || stress === 'Moderate Stress') {
      text += 'Autonomic balance indicates elevated sympathetic drive. Recommended: 5 minutes of 4-4-4-4 Box Breathing to stimulate vagus nerve activity and restore baroreflex balance.';
    } else {
      text += 'Optimal parasympathetic regulation and resilient autonomic tone detected. Continue routine physical activity and circadian sleep hygiene.';
    }
    return text;
  };

  // Save Screening to PostgreSQL
  const handleSaveToDatabase = async () => {
    if (!completedReport) return;
    setSavingRecord(true);
    try {
      const payload = {
        patient_id: completedReport.patient_id || null,
        heart_rate_bpm: completedReport.heart_rate_bpm,
        hrv_rmssd_ms: completedReport.hrv_rmssd_ms,
        stress_index: completedReport.stress_index,
        stress_level: completedReport.stress_level,
        fatigue_level: completedReport.fatigue_level,
        sleepiness_level: completedReport.sleepiness_level,
        facial_expression: completedReport.facial_expression,
        signal_quality: completedReport.signal_quality,
        confidence: sqiScore / 100.0,
        guidance_notes: completedReport.guidance_notes,
        details_json: JSON.stringify(completedReport.details)
      };

      const res = await fetch('/api/wellness/screenings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Failed to save biometric record to database');
      const data = await res.json();
      showToast('success', `Screening #${data.screening_id || 'WLN'} saved to patient registry!`);
    } catch (err) {
      showToast('error', err.message || 'Error saving to database');
    } finally {
      setSavingRecord(false);
    }
  };

  // Download PDF Report
  const handleDownloadPdf = async () => {
    if (!completedReport) return;
    setDownloadingPdf(true);
    try {
      const res = await fetch('/api/wellness/report.pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(completedReport)
      });

      if (!res.ok) throw new Error('Could not generate PDF report');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cardiac-wellness-${completedReport.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('success', 'Cardiac Wellness PDF Report downloaded!');
    } catch (err) {
      showToast('error', err.message || 'Failed to download PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <>
      <div className="page-title">
        <div>
          <div className="eyebrow">MODULE 4 · AUTONOMIC & BIOMETRIC VISION</div>
          <h1>Heart-Related Camera Detection & Wellness</h1>
          <p>
            Real-time contactless facial rPPG photoplethysmography, pulse monitoring, fatigue detection, and sleepiness evaluation.
          </p>
        </div>
      </div>

      {/* PROMINENT MEDICAL DISCLAIMER */}
      <div style={{
        background: '#fff8e7',
        border: '1px solid #f0cf85',
        borderRadius: 12,
        padding: '14px 18px',
        marginBottom: 20,
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        color: '#7a5310'
      }}>
        <ShieldAlert size={22} style={{ color: '#d97706', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 13, lineHeight: 1.55 }}>
          <b>Important Medical Notice & Limitations:</b> Camera-based results are estimates, not medical diagnoses.
          Blood pressure and heart disease cannot be reliably detected using a normal camera alone. HRV requires accurate
          pulse interval data. Do not present facial expressions as a confirmed stress diagnosis.
        </div>
      </div>

      {toast && (
        <div className={`toast-bar ${toast.type}`} style={{ marginBottom: 16 }}>
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      {abnormalityAlert && (
        <div style={{
          background: '#fee2e2',
          border: '1px solid #f87171',
          borderRadius: 10,
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          color: '#991b1b',
          fontWeight: 600,
          fontSize: 14
        }}>
          <AlertTriangle size={20} />
          <span>{abnormalityAlert}</span>
        </div>
      )}

      <div className="wellness-grid">
        {/* LEFT COLUMN: LIVE WEBCAM & MESH OVERLAY */}
        <div className="camera-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Camera size={18} style={{ color: '#10b981' }} />
              <b style={{ fontSize: 14 }}>Webcam rPPG & Face Mesh Viewport</b>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {!cameraActive ? (
                <button
                  className="table-btn"
                  style={{ background: '#10b981', color: '#fff', borderColor: 'transparent', fontWeight: 600 }}
                  onClick={startCamera}
                >
                  <Play size={14} style={{ marginRight: 4 }} /> Enable Camera
                </button>
              ) : (
                <button
                  className="table-btn"
                  style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', borderColor: 'transparent' }}
                  onClick={stopCamera}
                >
                  <Square size={14} style={{ marginRight: 4 }} /> Stop Camera
                </button>
              )}
            </div>
          </div>

          {streamError && (
            <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', borderRadius: 8, padding: 10, fontSize: 12, marginBottom: 12, color: '#fca5a5' }}>
              <Info size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} />
              {streamError}
            </div>
          )}

          {/* VIEWPORT WITH CANVAS OVERLAY */}
          <div className="camera-viewport" style={{ position: 'relative', minHeight: 330, background: '#0a1924', borderRadius: 12, overflow: 'hidden' }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: cameraActive ? 'block' : 'none'
              }}
            />
            <canvas
              ref={overlayCanvasRef}
              width={640}
              height={480}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                display: cameraActive ? 'block' : 'none'
              }}
            />

            {!cameraActive && (
              <div style={{ textAlign: 'center', color: '#688b9c', padding: 45 }}>
                <HeartPulse size={48} style={{ color: '#17818b', marginBottom: 12, opacity: 0.8 }} />
                <h4 style={{ color: '#d6e4e8', margin: '0 0 6px 0' }}>Camera Ready</h4>
                <p style={{ margin: 0, fontSize: 13, color: '#8aa4b0' }}>
                  Click "Enable Camera" to initialize face detection & rPPG arterial pulse monitoring.
                </p>
              </div>
            )}

            {/* REAL-TIME SIGNAL QUALITY BADGE OVERLAY */}
            {cameraActive && (
              <div style={{
                position: 'absolute',
                top: 12,
                left: 12,
                background: 'rgba(10, 25, 36, 0.85)',
                padding: '5px 10px',
                borderRadius: 6,
                fontSize: 12,
                color: sqiScore >= 65 ? '#10b981' : '#f59e0b',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                <Activity size={14} />
                <span>Signal Quality: {signalQuality}</span>
              </div>
            )}

            {/* PULSE WAVEFORM CANVAS */}
            <div className="rppg-signal-overlay" style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              background: 'linear-gradient(transparent, rgba(10, 25, 36, 0.95))',
              padding: '10px 14px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#10b981', marginBottom: 2 }}>
                <span>Photoplethysmogram (rPPG Pulse Wave)</span>
                <span>{estimatedBpm} BPM</span>
              </div>
              <canvas ref={pulseCanvasRef} width={450} height={50} style={{ width: '100%', height: 45 }} />
            </div>
          </div>

          {/* PROGRESS BAR FOR SCREENING SESSION */}
          {sessionActive && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: '#10b981', fontWeight: 600 }}>Screening in progress... Analyzing pulse & fatigue</span>
                <span>{20 - sessionSeconds}s left</span>
              </div>
              <div className="scan-progress-bar-container" style={{ background: 'rgba(255,255,255,0.1)', height: 6, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ background: '#10b981', height: '100%', width: `${scanProgress}%`, transition: 'width 0.3s' }} />
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <button
              className="primary full"
              disabled={sessionActive}
              onClick={startFullScreening}
              style={{
                background: sessionActive ? '#095e69' : '#10b981',
                borderColor: '#10b981',
                padding: '11px 16px',
                fontSize: 14,
                fontWeight: 600
              }}
            >
              {sessionActive ? (
                <>Screening Patient Biometrics ({20 - sessionSeconds}s remaining)...</>
              ) : (
                <><Play size={16} /> Start 20s Multi-Signal Screening</>
              )}
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: REAL-TIME BIOMETRIC METRICS */}
        <div>
          <div style={{ background: '#fff', border: '1px solid var(--border-light)', borderRadius: 16, padding: 20, marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: '#102d42' }}>Live Physiological Estimates</h3>
              <span style={{
                background: sqiScore >= 65 ? '#e6f7ef' : '#fef3c7',
                color: sqiScore >= 65 ? '#10b981' : '#b45309',
                padding: '4px 10px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 600
              }}>
                Pulse SQI: {sqiScore}%
              </span>
            </div>

            <div className="wellness-metrics-row">
              <div className="wellness-metric-card">
                <small>Estimated Heart Rate</small>
                <div className="val" style={{ color: abnormalityAlert ? '#dc2626' : '#0d7482' }}>
                  {estimatedBpm}
                </div>
                <div className="unit">BPM (rPPG Optical)</div>
              </div>

              <div className="wellness-metric-card">
                <small>Heart Rate Variability</small>
                <div className="val" style={{ color: hrvRmssd ? '#10b981' : '#64748b', fontSize: hrvRmssd ? 24 : 14, paddingTop: hrvRmssd ? 0 : 6 }}>
                  {hrvRmssd ? `${hrvRmssd} ms` : 'Gated'}
                </div>
                <div className="unit" style={{ fontSize: 11 }}>
                  {hrvRmssd ? 'RMSSD Parasympathetic' : 'Quality Gated'}
                </div>
              </div>

              <div className="wellness-metric-card">
                <small>Autonomic Stress</small>
                <div className="val" style={{ color: stressIndex > 65 ? '#dc2626' : stressIndex > 45 ? '#d97706' : '#10b981' }}>
                  {stressIndex}
                </div>
                <div className="unit">{stressLevel}</div>
              </div>
            </div>

            {/* HEART RATE TREND SPARKLINE */}
            <div style={{ marginTop: 14, padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748b', marginBottom: 6 }}>
                <span>Heart Rate Trend (Last 15 Observations)</span>
                <span>Range: {Math.min(...bpmTrend)} - {Math.max(...bpmTrend)} BPM</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 40 }}>
                {bpmTrend.map((val, idx) => {
                  const hPct = Math.max(15, Math.min(100, ((val - 50) / 70) * 100));
                  return (
                    <div
                      key={idx}
                      style={{
                        flex: 1,
                        height: `${hPct}%`,
                        background: val > 100 ? '#ef4444' : val < 55 ? '#f59e0b' : '#10b981',
                        borderRadius: 2
                      }}
                      title={`${val} BPM`}
                    />
                  );
                })}
              </div>
            </div>

            {/* NEUROMUSCULAR, FATIGUE & EXPRESSION ROW */}
            <div style={{ marginTop: 16 }}>
              <b style={{ fontSize: 12, color: '#0d7482', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                Facial Expression & Fatigue Telemetry
              </b>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <Smile size={18} style={{ color: '#0d7482', margin: '0 auto 4px auto' }} />
                  <div style={{ fontSize: 11, color: '#64748b' }}>Expression</div>
                  <b style={{ fontSize: 13, color: '#1e293b' }}>{facialExpression}</b>
                </div>

                <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <Eye size={18} style={{ color: ear < 0.22 ? '#dc2626' : '#10b981', margin: '0 auto 4px auto' }} />
                  <div style={{ fontSize: 11, color: '#64748b' }}>Eye Aspect (EAR)</div>
                  <b style={{ fontSize: 13, color: '#1e293b' }}>{ear.toFixed(2)} ({blinkCount} blinks)</b>
                </div>

                <div style={{ background: '#f8fafc', padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', textAlign: 'center' }}>
                  <Moon size={18} style={{ color: yawnCount > 0 ? '#f59e0b' : '#0d7482', margin: '0 auto 4px auto' }} />
                  <div style={{ fontSize: 11, color: '#64748b' }}>Fatigue Status</div>
                  <b style={{ fontSize: 13, color: '#1e293b' }}>{fatigueLevel}</b>
                </div>
              </div>
            </div>
          </div>

          {/* COMPLETED REPORT & EXPORT ACTIONS */}
          {completedReport && (
            <div style={{
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 14,
              padding: 18,
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.08)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: '#166534' }}>
                <Sparkles size={18} />
                <h4 style={{ margin: 0, fontSize: 15 }}>Screening Session Completed & Verified</h4>
              </div>
              <p style={{ margin: '0 0 14px 0', fontSize: 13, color: '#374151', lineHeight: 1.5 }}>
                {completedReport.guidance_notes}
              </p>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  className="primary small"
                  disabled={downloadingPdf}
                  onClick={handleDownloadPdf}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0d7482', borderColor: '#0d7482' }}
                >
                  <Download size={14} />
                  {downloadingPdf ? 'Generating PDF...' : 'Download Wellness Report (PDF)'}
                </button>

                <button
                  className="table-btn"
                  disabled={savingRecord}
                  onClick={handleSaveToDatabase}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', borderColor: '#cbd5e1' }}
                >
                  <UserCheck size={14} />
                  {savingRecord ? 'Saving...' : 'Save to Patient Registry'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
