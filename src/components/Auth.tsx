import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { authHelper } from '../utils/auth';
import { User } from '../App';
import ForgotPassword from './ForgotPassword';
import ResetPassword from './ResetPassword';

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
        // Handle login
        const userRecord = await db.getUserByEmail(cleanEmail);
        if (!userRecord) {
          showToast('Invalid email or password.', 'error');
          return;
        }

        const isValid = await authHelper.comparePassword(password, userRecord.password_hash);

        if (!isValid) {
          showToast('Invalid email or password.', 'error');
          return;
        }

        const sessionUser: User = {
          id: userRecord.id,
          name: userRecord.name,
          email: userRecord.email,
          daily_goal_minutes: userRecord.daily_goal_minutes,
          timezone: userRecord.timezone,
          isNew: userRecord.daily_goal_minutes === 60 && !userRecord.timezone
        };

        localStorage.setItem('user', JSON.stringify(sessionUser));
        showToast(`Welcome back, ${sessionUser.name}!`, 'success');
        setUser(sessionUser);
      } else {
        // Handle signup
        const existing = await db.getUserByEmail(cleanEmail);
        if (existing) {
          showToast('A user with this email already exists.', 'error');
          return;
        }

        const hash = await authHelper.hashPassword(password);
        const result = await db.createUser(name, cleanEmail, hash);
        
        const newUser: User = {
          id: result.id,
          name: name.trim(),
          email: cleanEmail,
          daily_goal_minutes: 60,
          timezone: '',
          isNew: true
        };

        localStorage.setItem('user', JSON.stringify(newUser));
        showToast('Account created successfully!', 'success');
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
      </div>
    </div>
  );
}

export default Auth;
