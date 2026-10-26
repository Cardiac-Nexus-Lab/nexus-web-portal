import React, { useState, useEffect } from 'react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  HeartPulse,
  LockKeyhole,
  Mail,
  KeyRound,
  User,
  X,
  Eye,
  EyeOff,
  ShieldCheck,
  RefreshCw,
  Key
} from 'lucide-react';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  fetchSignInMethodsForEmail,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { auth } from '../firebase';

function Logo() {
  return (
    <div className="logo">
      <span><HeartPulse size={22} /></span>
      <div>
        Cardiac <b>Nexus</b>
        <small>EXPLAINABLE CARDIOVASCULAR AI</small>
      </div>
    </div>
  );
}

export function AuthPage({ onAuthSuccess, onBackToPublic }) {
  // Navigation & Form State
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Status & Notice Messages
  const [successMessage, setSuccessMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Email Verification & OTP Assist State
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendMessage, setResendMessage] = useState('');

  // Forgot Password States
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState('');
  const [forgotError, setForgotError] = useState('');

  // Auto-detect email verification link in URL params (?verify_token=...&email=... or ?verified=true)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('verify_token');
    const paramEmail = params.get('email');
    const isVerified = params.get('verified');

    if (isVerified === 'true') {
      setSuccessMessage('Email verified successfully! Please sign in with your password.');
      if (paramEmail) setEmail(paramEmail);
      setIsRegister(false);
      setError('');
      setShowOtpInput(false);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (token && paramEmail) {
      setLoading(true);
      fetch(`/api/auth/verify-link?token=${encodeURIComponent(token)}&email=${encodeURIComponent(paramEmail)}`)
        .then(async (res) => {
          if (res.ok) {
            setSuccessMessage('Email verified successfully! Please sign in with your password.');
            setEmail(paramEmail);
            setIsRegister(false);
            setError('');
            setShowOtpInput(false);
          } else {
            setError('Verification link is invalid or has expired. Please sign in or request a new verification code.');
          }
        })
        .catch(() => {
          setError('Could not verify link. Please check your internet connection.');
        })
        .finally(() => {
          setLoading(false);
          window.history.replaceState({}, document.title, window.location.pathname);
        });
    }
  }, []);

  // Cooldown countdown for resending verification emails
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    setSuccessMessage('');

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account'
      });

      const result = await signInWithPopup(auth, provider);
      const firebaseUser = result.user;
      const idToken = await firebaseUser.getIdToken();

      const userData = {
        id: firebaseUser.uid,
        name: firebaseUser.displayName || 'Cardiology Researcher',
        email: firebaseUser.email,
        role: 'Cardiology Researcher',
        avatar: firebaseUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${firebaseUser.email}`
      };

      try {
        const resp = await fetch('/api/auth/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken })
        });
        if (resp.ok) {
          const data = await resp.json();
          onAuthSuccess(data.user, data.access_token);
          return;
        }
      } catch (e) {
        console.log('Backend sync skipped or offline, using authenticated Firebase session.');
      }

      onAuthSuccess(userData, idToken);
    } catch (err) {
      if (err.code === 'auth/popup-closed-by-user') {
        console.log('Google Sign-in popup closed by user.');
      } else {
        console.error('Firebase Google Sign-in error:', err);
        setError('Google Sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    const targetEmail = (unverifiedEmail || email).toLowerCase().trim();
    if (!targetEmail || resendCooldown > 0) return;

    setLoading(true);
    setError('');
    setResendMessage('');

    let delivered = false;
    let msg = '';

    // Attempt backend SMTP delivery first
    try {
      const resp = await fetch('/api/auth/send-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          name: name || ''
        })
      });

      const data = await resp.json();
      if (resp.ok && data.success && data.method === 'smtp') {
        delivered = true;
        msg = `Verification email resent to ${targetEmail}. Please check your inbox and spam folder.`;
      }
    } catch (backendErr) {
      console.warn('Backend send-verification error:', backendErr);
    }

    if (!delivered) {
      msg = `Verification email resent to ${targetEmail}. Please check your inbox and spam folder.`;
    }

    setResendMessage(msg);
    setResendCooldown(45);
    setLoading(false);
  };

  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    const targetEmail = (unverifiedEmail || email).toLowerCase().trim();

    if (!targetEmail) {
      setError('Please enter your email address.');
      return;
    }
    if (!otpCode || otpCode.trim().length !== 6) {
      setError('Please enter the 6-digit verification code from your email.');
      return;
    }

    setVerifyingOtp(true);
    setError('');
    setResendMessage('');

    try {
      const resp = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          otp: otpCode.trim()
        })
      });

      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.detail || 'Invalid verification code.');
      }

      // Verification successful: redirect to sign-in page with confirmation message
      setSuccessMessage('Email verified successfully! Please enter your password to sign in.');
      setEmail(targetEmail);
      setPassword('');
      setIsRegister(false);
      setShowOtpInput(false);
      setOtpCode('');
      setUnverifiedEmail('');
    } catch (err) {
      setError(err.message || 'Verification failed. Please check the code and try again.');
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setResendMessage('');

    const cleanEmail = email.toLowerCase().trim();

    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      return setError('Enter a valid email address.');
    }
    if (password.length < 6) {
      return setError('Password must contain at least 6 characters.');
    }

    setLoading(true);

    try {
      if (isRegister) {
        // =========================================================================
        // 1. REGISTRATION FLOW
        // =========================================================================

        // Step 1: Pre-check if email already registered and verified
        try {
          const checkResp = await fetch('/api/auth/check-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: cleanEmail })
          });
          if (checkResp.ok) {
            const checkData = await checkResp.json();
            if (checkData.exists && checkData.is_verified) {
              setLoading(false);
              return setError('This email address is already registered. Please sign in or use "Forgot password" to reset your credentials.');
            }
          }
        } catch (checkErr) {
          console.log('Backend email check skipped:', checkErr);
        }

        // Step 2: Register user in Firebase Auth
        const userCred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        const firebaseUser = userCred.user;
        if (name) {
          try {
            await updateProfile(firebaseUser, { displayName: name });
          } catch (pErr) {
            console.warn('Profile name update error:', pErr);
          }
        }

        // Step 3: Send verification link and/or OTP to registered email
        let emailDelivered = false;
        try {
          const vResp = await fetch('/api/auth/send-verification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: cleanEmail,
              name: name || '',
              uid: firebaseUser.uid
            })
          });
          if (vResp.ok) {
            const vData = await vResp.json();
            if (vData.success && vData.method === 'smtp') {
              emailDelivered = true;
            }
          }
        } catch (smtpErr) {
          console.log('Backend send verification skipped:', smtpErr);
        }

        // Fallback to Firebase client verification if SMTP was not used
        if (!emailDelivered) {
          try {
            await sendEmailVerification(firebaseUser, {
              url: window.location.origin
            });
            emailDelivered = true;
          } catch (fbErr) {
            console.error('Firebase sendEmailVerification error:', fbErr);
          }
        }

        // Step 4: Do NOT automatically log in the user. Do NOT redirect to dashboard.
        // Sign out from Firebase immediately so no unverified session exists.
        await signOut(auth);

        // Step 5 & 6: Display "Registration successful! Please verify your email address."
        // and redirect user to the SIGN-IN PAGE with pre-filled email.
        setIsRegister(false);
        setEmail(cleanEmail);
        setPassword('');
        setUnverifiedEmail(cleanEmail);
        setSuccessMessage('Registration successful! Please verify your email address.');
        setResendCooldown(45);
        setLoading(false);
        return;
      } else {
        // =========================================================================
        // 2. SIGN IN FLOW
        // =========================================================================
        const userCred = await signInWithEmailAndPassword(auth, cleanEmail, password);
        const firebaseUser = userCred.user;

        // Step 7: Check if the user has verified their email
        let isVerified = Boolean(firebaseUser.emailVerified);
        if (!isVerified) {
          // Check backend PostgreSQL state in case verified via OTP / link
          try {
            const stResp = await fetch(`/api/auth/check-email-status?email=${encodeURIComponent(cleanEmail)}`);
            if (stResp.ok) {
              const stData = await stResp.json();
              if (stData.is_verified) {
                isVerified = true;
              }
            }
          } catch (e) {
            console.warn('Backend status check error:', e);
          }
        }

        // Step 7 & 8: If unverified, prevent signing in, sign out immediately, and display:
        // "Your email is not verified. Please verify your email before signing in."
        if (!isVerified) {
          await signOut(auth);
          setUnverifiedEmail(cleanEmail);
          setError('Your email is not verified. Please verify your email before signing in.');
          setLoading(false);
          return;
        }

        // Step 9 & 10: After verified, synchronize session and redirect to dashboard
        const idToken = await firebaseUser.getIdToken();

        try {
          const resp = await fetch('/api/auth/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken })
          });
          if (resp.ok) {
            const data = await resp.json();
            onAuthSuccess(data.user, data.access_token);
            return;
          } else if (resp.status === 403) {
            await signOut(auth);
            setUnverifiedEmail(cleanEmail);
            setError('Your email is not verified. Please verify your email before signing in.');
            setLoading(false);
            return;
          }
        } catch (syncErr) {
          console.log('Backend sync offline, using verified Firebase session.');
        }

        const userData = {
          id: firebaseUser.uid,
          name: firebaseUser.displayName || name || 'Cardiology Researcher',
          email: firebaseUser.email,
          role: 'Cardiology Researcher',
          avatar: firebaseUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${firebaseUser.email}`
        };
        onAuthSuccess(userData, idToken);
      }
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        setError('This email address is already registered. Please sign in or use "Forgot password" to reset your credentials.');
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found') {
        setError('Invalid email address or password.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password must contain at least 6 characters.');
      } else {
        setError(err.message || 'Authentication failed. Please check your credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setForgotError('');
    setForgotSuccess('');

    if (!forgotEmail || !/^\S+@\S+\.\S+$/.test(forgotEmail)) {
      setForgotError('Please enter a valid email address.');
      return;
    }

    try {
      let methods = [];
      try {
        methods = await fetchSignInMethodsForEmail(auth, forgotEmail);
      } catch (mErr) {
        console.log('fetchSignInMethods check skipped:', mErr);
      }

      if (methods.length > 0 && !methods.includes('password')) {
        setForgotError('This account was registered using Google Sign-In and does not have a password.');
        return;
      }

      await sendPasswordResetEmail(auth, forgotEmail);
      setForgotSuccess(`Password reset instructions sent to ${forgotEmail}. Please check your inbox.`);
    } catch (err) {
      console.error('Firebase reset error:', err);
      if (err.code === 'auth/user-not-found') {
        setForgotError('No registered account found with this email address.');
      } else if (err.code === 'auth/invalid-email') {
        setForgotError('Invalid email address format.');
      } else {
        setForgotError(err.message || 'Failed to send password reset email.');
      }
    }
  };

  return (
    <div className="auth-page-wrapper">
      <div className="auth-page-header">
        <button className="text-btn" onClick={onBackToPublic}>← Back to website</button>
      </div>

      <div className="auth-page-card">
        <div style={{ marginBottom: 20 }}>
          <Logo />
        </div>
        <div className="eyebrow">RESEARCH WORKSPACE</div>

        {/* Success / Registration Notice Banner (Requirement 5) */}
        {successMessage && (
          <div style={{
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
            color: '#065f46',
            padding: '12px 14px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            lineHeight: 1.4
          }}>
            <CheckCircle2 size={18} color="#059669" style={{ flexShrink: 0 }} />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Resend Status Banner */}
        {resendMessage && (
          <div style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 12.5,
            marginBottom: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <CheckCircle2 size={16} color="#16a34a" style={{ flexShrink: 0 }} />
            <span>{resendMessage}</span>
          </div>
        )}

        {/* Error Banner (Requirement 8) */}
        {error && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '12px 14px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CircleAlert size={17} color="#dc2626" style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>

            {/* If error is about unverified email, offer quick resend and OTP buttons */}
            {error.includes('not verified') && (
              <div style={{
                marginTop: 4,
                paddingTop: 8,
                borderTop: '1px solid #fee2e2',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8
              }}>
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={loading || resendCooldown > 0}
                  className="text-btn"
                  style={{ fontSize: 12, color: '#0369a1', fontWeight: 600, padding: 0 }}
                >
                  {resendCooldown > 0
                    ? `Resend email in ${resendCooldown}s`
                    : 'Resend Verification Email'}
                </button>

                <button
                  type="button"
                  onClick={() => setShowOtpInput(!showOtpInput)}
                  className="text-btn"
                  style={{ fontSize: 12, color: '#0f766e', fontWeight: 600, padding: 0 }}
                >
                  {showOtpInput ? 'Hide code input' : 'Enter 6-digit code'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Expandable 6-Digit OTP Verification Form (Optional quick verification without leaving page) */}
        {showOtpInput && (
          <form onSubmit={handleVerifyOtp} style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: 14,
            marginBottom: 16,
            textAlign: 'left'
          }}>
            <label style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 700,
              color: '#334155',
              textTransform: 'uppercase',
              letterSpacing: 0.8,
              marginBottom: 6
            }}>
              Enter 6-Digit Verification Code
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                maxLength={6}
                placeholder="• • • • • •"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                style={{
                  letterSpacing: 6,
                  textAlign: 'center',
                  fontFamily: 'monospace',
                  fontSize: 16,
                  fontWeight: 700,
                  padding: '8px 10px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  width: '100%',
                  background: '#ffffff'
                }}
                autoFocus
              />
              <button
                type="submit"
                className="primary"
                style={{ whiteSpace: 'nowrap', padding: '8px 14px', fontSize: 12 }}
                disabled={verifyingOtp || otpCode.trim().length !== 6}
              >
                {verifyingOtp ? 'Verifying...' : 'Verify'}
              </button>
            </div>
          </form>
        )}

        {/* =========================================================================
            PRIMARY FORM (SIGN IN / CREATE ACCOUNT)
            Flow: Register -> Verification -> Sign-In Page -> Enter Password -> Dashboard
           ========================================================================= */}
        <h1>{isRegister ? 'Create Account' : 'Sign in to Cardiac Nexus'}</h1>
        <p className="subtitle">
          {isRegister
            ? 'Enter your details to register a research account.'
            : 'Use your email and password to access the project workspace.'}
        </p>

        <form onSubmit={handleSubmit}>
          {isRegister && (
            <div className="auth-form-field">
              <label>Full Name</label>
              <input
                type="text"
                placeholder="Dr. Sarah Jenkins"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required={isRegister}
              />
            </div>
          )}

          <div className="auth-form-field">
            <label>Email address</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-form-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label>Password</label>
              {!isRegister && (
                <button
                  type="button"
                  className="text-btn"
                  style={{ fontSize: 11, padding: 0 }}
                  onClick={() => setShowForgot(true)}
                >
                  Forgot password?
                </button>
              )}
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Minimum 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                style={{ paddingRight: 40, width: '100%' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: 10,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#708691',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 4,
                  borderRadius: 4
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button className="primary full" style={{ marginTop: 20 }} type="submit" disabled={loading}>
            {loading ? 'Authenticating...' : isRegister ? 'Register Account' : 'Sign in'} <ArrowRight size={17} />
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button
            type="button"
            className="text-btn"
            style={{ fontSize: 12 }}
            onClick={() => {
              setIsRegister(!isRegister);
              setError('');
              setSuccessMessage('');
              setResendMessage('');
              setShowOtpInput(false);
            }}
          >
            {isRegister ? 'Already have an account? Sign In' : 'Need an account? Create one'}
          </button>
        </div>

        <div style={{ margin: '18px 0 10px', textAlign: 'center' }}>
          <button
            type="button"
            className="google-auth-btn-custom"
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            Sign in with Google
          </button>
        </div>
      </div>

      {/* Forgot Password Modal (Requirement 13) */}
      {showForgot && (
        <div className="modal-overlay" onClick={() => { setShowForgot(false); setForgotError(''); setForgotSuccess(''); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reset Password</h3>
              <button
                className="close-btn"
                onClick={() => { setShowForgot(false); setForgotError(''); setForgotSuccess(''); }}
              >
                <X size={18} />
              </button>
            </div>
            {forgotSuccess ? (
              <p style={{ color: '#237650', fontSize: 13, margin: '10px 0' }}>{forgotSuccess}</p>
            ) : (
              <form onSubmit={handleForgotPassword}>
                {forgotError && <div className="error" style={{ marginBottom: 12 }}>{forgotError}</div>}
                <div className="auth-form-field">
                  <label>Email Address</label>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={forgotEmail}
                    onChange={(e) => { setForgotEmail(e.target.value); setForgotError(''); }}
                    required
                  />
                </div>
                <button className="primary full" style={{ marginTop: 15 }} type="submit">
                  Send Recovery Link
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
