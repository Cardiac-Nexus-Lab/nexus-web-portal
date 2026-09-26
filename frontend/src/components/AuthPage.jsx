import React, { useState } from 'react';
import { Activity, ArrowRight, CheckCircle2, CircleAlert, HeartPulse, LockKeyhole, Mail, KeyRound, User, X, Eye, EyeOff } from 'lucide-react';
import {
  GoogleAuthProvider,
  signInWithPopup,
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
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [unverifiedUser, setUnverifiedUser] = useState(null);
  const [verifyMessage, setVerifyMessage] = useState('');

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');

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
      }
    } finally {
      setLoading(false);
    }
  };

  const checkEmailVerification = async () => {
    if (!unverifiedUser) return;
    setLoading(true);
    setVerifyMessage('');
    try {
      await unverifiedUser.reload();
      if (unverifiedUser.emailVerified) {
        const idToken = await unverifiedUser.getIdToken();
        const userData = {
          id: unverifiedUser.uid,
          name: unverifiedUser.displayName || name || 'Cardiology Researcher',
          email: unverifiedUser.email,
          role: 'Cardiology Researcher',
          avatar: unverifiedUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${unverifiedUser.email}`
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
        } catch (syncErr) {
          console.log('Backend sync offline, using authenticated Firebase session.');
        }

        onAuthSuccess(userData, idToken);
      } else {
        setError('Email not verified yet. Please check your inbox and click the verification link.');
      }
    } catch (err) {
      setError(err.message || 'Failed to check email verification status.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!unverifiedUser) return;
    try {
      await sendEmailVerification(unverifiedUser);
      setVerifyMessage('Verification email resent! Please check your inbox.');
    } catch (err) {
      setError(err.message || 'Failed to resend verification email.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setVerifyMessage('');

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return setError('Enter a valid email address.');
    }
    if (password.length < 6) {
      return setError('Password must contain at least 6 characters.');
    }

    setLoading(true);

    try {
      let firebaseUser;
      if (isRegister) {
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        firebaseUser = userCred.user;
        if (name) {
          await updateProfile(firebaseUser, { displayName: name });
        }
        await sendEmailVerification(firebaseUser);
        setUnverifiedUser(firebaseUser);
        setVerifyMessage(`Verification email sent to ${email}. Please verify your email before continuing.`);
        return;
      } else {
        const userCred = await signInWithEmailAndPassword(auth, email, password);
        firebaseUser = userCred.user;
      }

      if (!firebaseUser.emailVerified) {
        setUnverifiedUser(firebaseUser);
        setError('Please verify your email before continuing.');
        return;
      }

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
        }
      } catch (syncErr) {
        console.log('Backend sync offline, using authenticated Firebase session.');
      }

      const userData = {
        id: firebaseUser.uid,
        name: firebaseUser.displayName || name || 'Cardiology Researcher',
        email: firebaseUser.email,
        role: 'Cardiology Researcher',
        avatar: firebaseUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${firebaseUser.email}`
      };
      onAuthSuccess(userData, idToken);
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        setError('An account with this email address already exists.');
      } else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found') {
        setError('Invalid email or password.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password must contain at least 6 characters.');
      } else {
        setError(err.message || 'Authentication failed.');
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

        {unverifiedUser ? (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <Mail size={40} color="#176b87" style={{ marginBottom: 12 }} />
            <h2 style={{ fontSize: 20, marginBottom: 8 }}>Please verify your email before continuing</h2>
            <p style={{ color: '#637b86', fontSize: 13, margin: '8px 0 16px' }}>
              We sent a verification link to <b>{unverifiedUser.email}</b>. Please check your inbox and click the link to activate your workspace access.
            </p>

            {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
            {verifyMessage && <p style={{ color: '#2e7d32', fontSize: 13, marginBottom: 12 }}>{verifyMessage}</p>}

            <button className="primary full" onClick={checkEmailVerification} disabled={loading} style={{ marginBottom: 10 }}>
              {loading ? 'Checking...' : "I've Verified My Email"} <ArrowRight size={16} />
            </button>
            <button className="secondary full" onClick={handleResendVerification} disabled={loading} style={{ marginBottom: 10 }}>
              Resend Verification Email
            </button>
            <button type="button" className="text-btn" style={{ fontSize: 12, marginTop: 10 }} onClick={() => { setUnverifiedUser(null); setError(''); setVerifyMessage(''); }}>
              ← Back to Sign In
            </button>
          </div>
        ) : (
          <>
            <h1>{isRegister ? 'Create Account' : 'Sign in to Cardiac Nexus'}</h1>
            <p className="subtitle">
              {isRegister
                ? 'Enter your details to register a research account.'
                : 'Use your email and password to access the project workspace.'}
            </p>

            {error && <div className="error">{error}</div>}
            {verifyMessage && <p style={{ color: '#2e7d32', fontSize: 13, marginBottom: 12 }}>{verifyMessage}</p>}

            <form onSubmit={handleSubmit}>
              {isRegister && (
                <div className="auth-form-field">
                  <label>Full Name</label>
                  <input
                    type="text"
                    placeholder="Dr. Sarah Jenkins"
                    value={name}
                    onChange={e => setName(e.target.value)}
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
                  onChange={e => setEmail(e.target.value)}
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
                    onChange={e => setPassword(e.target.value)}
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
                onClick={() => { setIsRegister(!isRegister); setError(''); setVerifyMessage(''); }}
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
          </>
        )}
      </div>

      {showForgot && (
        <div className="modal-overlay" onClick={() => { setShowForgot(false); setForgotError(''); setForgotSuccess(''); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reset Password</h3>
              <button className="close-btn" onClick={() => { setShowForgot(false); setForgotError(''); setForgotSuccess(''); }}><X size={18} /></button>
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
                    onChange={e => { setForgotEmail(e.target.value); setForgotError(''); }}
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
