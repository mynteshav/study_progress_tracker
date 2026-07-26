import React, { useState } from 'react';
import { db } from '../db';
import { User } from '../App';

interface AuthProps {
  setUser: (user: User) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

function Auth({ setUser, showToast }: AuthProps) {
  const [isLogin, setIsLogin] = useState<boolean>(true);
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || (!isLogin && !name)) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        // Handle login
        const userRecord = await db.getUserByEmail(email);
        if (!userRecord) {
          showToast('Invalid email or password.', 'error');
          setLoading(false);
          return;
        }

        const isValid = window.electronAPI
          ? await window.electronAPI.bcryptCompare(password, userRecord.password_hash)
          : (password === userRecord.password_hash);

        if (!isValid) {
          showToast('Invalid email or password.', 'error');
          setLoading(false);
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
        const existing = await db.getUserByEmail(email);
        if (existing) {
          showToast('A user with this email already exists.', 'error');
          setLoading(false);
          return;
        }

        const hash = window.electronAPI
          ? await window.electronAPI.bcryptHash(password)
          : password;

        const result = await db.createUser(name, email, hash);
        
        const newUser: User = {
          id: result.id,
          name: name.trim(),
          email: email.toLowerCase().trim(),
          daily_goal_minutes: 60,
          timezone: '',
          isNew: true
        };

        localStorage.setItem('user', JSON.stringify(newUser));
        showToast('Account created successfully!', 'success');
        setUser(newUser);
      }
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'An error occurred during authentication.', 'error');
    } finally {
      setLoading(false);
    }
  };

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
            />
          </div>

          <div className="form-group">
            <label htmlFor="auth-password">Password</label>
            <input
              type="password"
              id="auth-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
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
