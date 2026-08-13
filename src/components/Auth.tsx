import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { authHelper } from '../utils/auth';
import { User } from '../App';
import ForgotPassword from './ForgotPassword';
import ResetPassword from './ResetPassword';

import { signUpWithFirebase, loginWithFirebase } from '../utils/firebase';
import InstallPWAButton from './InstallPWAButton';

interface AuthProps {
  setUser: (user: User) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

type AuthViewMode = 'auth' | 'forgot-password' | 'reset-password';

function Auth({ setUser, showToast }: AuthProps) {
  const [viewMode, setViewMode] = useState<AuthViewMode>('auth');
  const [resetToken, setResetToken] = useState<string>('');
  
  const [isLogin, setIsLogin] = useState<boolean>(true);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // Sync hash routing and URL parameters
  useEffect(() => {
    const parseUrlHash = () => {
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      const combined = hash + search;

      if (combined.includes('reset-password') || combined.includes('token=')) {
        const match = combined.match(/token=([^&]+)/);
        if (match) {
          setResetToken(decodeURIComponent(match[1]));
        }
        setViewMode('reset-password');
      } else if (combined.includes('forgot-password')) {
        setViewMode('forgot-password');
      } else {
        setViewMode('auth');
      }
    };

    parseUrlHash();
    window.addEventListener('hashchange', parseUrlHash);
    return () => window.removeEventListener('hashchange', parseUrlHash);
  }, []);

  const handleBackToLogin = () => {
    setViewMode('auth');
    setIsLogin(true);
    window.location.hash = '';
  };

  const handleNavigateReset = (token: string) => {
    setResetToken(token);
    setViewMode('reset-password');
    window.location.hash = `#/reset-password?token=${token}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const cleanEmail = email.toLowerCase().trim();

    if (!cleanEmail || !password || (!isLogin && !name.trim())) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }

    if (!authHelper.validateEmail(cleanEmail)) {
      showToast('Please enter a valid email address.', 'error');
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        // Authenticate with Firebase Auth
        let fbUser;
        try {
          fbUser = await loginWithFirebase(cleanEmail, password);
        } catch (fbErr: any) {
          console.warn('[Firebase Auth] Primary login failed:', fbErr);

          // Legacy desktop fallback: Check local SQLite DB
          const localUser = await db.getUserByEmail(cleanEmail);
          if (localUser && localUser.password_hash) {
            const isValid = await authHelper.comparePassword(password, localUser.password_hash);
            if (isValid) {
              try {
                fbUser = await signUpWithFirebase(cleanEmail, password, localUser.name);
              } catch (e) {
                try {
                  fbUser = await loginWithFirebase(cleanEmail, password);
                } catch (e2) {}
              }
            }
          }

          if (!fbUser) {
            let errorMsg = 'Invalid email or password.';
            if (fbErr.code === 'auth/user-not-found' || fbErr.code === 'auth/invalid-credential') {
              errorMsg = 'No Firebase account found with these credentials. Please click "Sign Up" below to register across Desktop & Web!';
            } else if (fbErr.code === 'auth/wrong-password') {
              errorMsg = 'Incorrect password. Please try again or click "Forgot Password?".';
            } else if (fbErr.code === 'auth/unauthorized-domain') {
              errorMsg = 'Netlify domain is not authorized in Firebase Console -> Authentication -> Settings -> Authorized domains.';
            } else if (fbErr.code === 'auth/invalid-api-key' || fbErr.code === 'auth/api-key-not-valid') {
              errorMsg = 'Invalid Firebase API Key. Please verify your environment variables in Netlify Dashboard.';
            } else if (fbErr.message) {
              errorMsg = fbErr.message;
            }

            showToast(errorMsg, 'error');
            return;
          }
        }

        // Synchronize Firebase User with local SQLite DB
        const syncedUser = await db.syncFirebaseUser(
          fbUser.uid,
          fbUser.email || cleanEmail,
          fbUser.displayName || undefined
        );

        const sessionUser: User = {
          id: syncedUser.id,
          firebase_uid: fbUser.uid,
          name: syncedUser.name,
          email: syncedUser.email,
          daily_goal_minutes: syncedUser.daily_goal_minutes || 60,
          timezone: syncedUser.timezone || '',
          isNew: syncedUser.daily_goal_minutes === 60 && !syncedUser.timezone
        };

        localStorage.setItem('user', JSON.stringify(sessionUser));
        showToast(`Welcome back, ${sessionUser.name}!`, 'success');
        setUser(sessionUser);
      } else {
        // Create new account via Firebase Auth
        let fbUser;
        try {
          fbUser = await signUpWithFirebase(cleanEmail, password, name);
        } catch (fbErr: any) {
          console.error('[Firebase Auth] Signup error:', fbErr);
          let errorMsg = fbErr.message || 'Failed to create account.';
          if (fbErr.code === 'auth/email-already-in-use') {
            errorMsg = 'An account with this email already exists on Firebase. Please click "Log In" below.';
          } else if (fbErr.code === 'auth/unauthorized-domain') {
            errorMsg = 'Netlify domain is not authorized in Firebase Console -> Authentication -> Settings -> Authorized domains.';
          } else if (fbErr.code === 'auth/weak-password') {
            errorMsg = 'Password should be at least 6 characters.';
          }
          showToast(errorMsg, 'error');
          return;
        }

        // Sync new Firebase user to local SQLite DB
        const syncedUser = await db.syncFirebaseUser(
          fbUser.uid,
          fbUser.email || cleanEmail,
          name.trim()
        );

        const newUser: User = {
          id: syncedUser.id,
          firebase_uid: fbUser.uid,
          name: name.trim(),
          email: cleanEmail,
          daily_goal_minutes: 60,
          timezone: '',
          isNew: true
        };

        localStorage.setItem('user', JSON.stringify(newUser));
        showToast('Account created successfully across Desktop & Web!', 'success');
        setUser(newUser);
      }
    } catch (err: any) {
      console.error('Authentication error:', err);
      showToast(err.message || 'An error occurred during authentication.', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (viewMode === 'forgot-password') {
    return (
      <ForgotPassword
        onBackToLogin={handleBackToLogin}
        onNavigateReset={handleNavigateReset}
        showToast={showToast}
      />
    );
  }

  if (viewMode === 'reset-password') {
    return (
      <ResetPassword
        tokenProp={resetToken}
        onBackToLogin={handleBackToLogin}
        showToast={showToast}
      />
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card glass-panel">
        <div className="auth-header">
          <div className="auth-logo"><i className="fa-solid fa-graduation-cap"></i></div>
          <h2 className="auth-title">{isLogin ? 'Welcome to Study Tracker' : 'Create Your Account'}</h2>
          <p className="auth-subtitle">
            {isLogin ? 'Log in to track your learning metrics' : 'Start syncing and measuring your study performance'}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <div className="form-group">
              <label htmlFor="auth-name">Name</label>
              <input
                type="text"
                id="auth-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your display name"
                required
                autoComplete="name"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="auth-email">Email Address</label>
            <input
              type="email"
              id="auth-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="auth-password">Password</label>
              {isLogin && (
                <a
                  href="#/forgot-password"
                  onClick={(e) => {
                    e.preventDefault();
                    setViewMode('forgot-password');
                    window.location.hash = '#/forgot-password';
                  }}
                  style={{
                    fontSize: '0.8rem',
                    color: '#818cf8',
                    textDecoration: 'none',
                    fontWeight: 500
                  }}
                >
                  Forgot Password?
                </a>
              )}
            </div>
            <input
              type="password"
              id="auth-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
          </div>

          <div className="form-group form-actions" style={{ marginTop: '10px' }}>
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Processing...' : isLogin ? 'Log In' : 'Create Account'}
            </button>
          </div>
        </form>

        <div className="auth-toggle">
          <span>{isLogin ? "Don't have an account? " : 'Already have an account? '}</span>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setIsLogin(!isLogin);
            }}
          >
            {isLogin ? 'Sign Up' : 'Log In'}
          </a>
        </div>

        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <InstallPWAButton showToast={showToast} />
        </div>
      </div>
    </div>
  );
}

export default Auth;
