import React, { useState, useEffect } from 'react';
import { db } from '../db';
import { authHelper } from '../utils/auth';

interface ResetPasswordProps {
  tokenProp?: string;
  onBackToLogin: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

function ResetPassword({ tokenProp, onBackToLogin, showToast }: ResetPasswordProps) {
  const [token, setToken] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const [verifyingToken, setVerifyingToken] = useState<boolean>(true);
  const [tokenValid, setTokenValid] = useState<boolean>(false);
  const [tokenErrorMsg, setTokenErrorMsg] = useState<string>('');

  const [loading, setLoading] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  // Extract and verify token on mount
  useEffect(() => {
    let extractedToken = tokenProp || '';

    if (!extractedToken) {
      // Extract token from URL hash e.g. #/reset-password?token=XYZ
      const hashStr = window.location.hash || '';
      const queryStr = window.location.search || '';
      const fullUrl = hashStr + queryStr;

      const match = fullUrl.match(/token=([^&]+)/);
      if (match) {
        extractedToken = decodeURIComponent(match[1]);
      }
    }

    setToken(extractedToken);

    if (!extractedToken) {
      setVerifyingToken(false);
      setTokenValid(false);
      setTokenErrorMsg('No password reset token was provided in the URL link.');
      return;
    }

    // Verify token validity in database
    db.getPasswordResetToken(extractedToken)
      .then((record: any) => {
        setVerifyingToken(false);
        if (!record) {
          setTokenValid(false);
          setTokenErrorMsg('Invalid or non-existent password reset link.');
        } else if (record.used === 1) {
          setTokenValid(false);
          setTokenErrorMsg('This password reset link has already been used.');
        } else if (new Date() > new Date(record.expires_at)) {
          setTokenValid(false);
          setTokenErrorMsg('This password reset link has expired. Please request a new link.');
        } else {
          setTokenValid(true);
        }
      })
      .catch((err: any) => {
        setVerifyingToken(false);
        setTokenValid(false);
        setTokenErrorMsg(err.message || 'Failed to verify reset token.');
      });
  }, [tokenProp]);

  const passwordStrength = authHelper.evaluatePasswordStrength(newPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword) {
      showToast('Please enter a new password.', 'error');
      return;
    }

    if (newPassword.length < 6) {
      showToast('Password must be at least 6 characters long.', 'error');
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast('New passwords do not match.', 'error');
      return;
    }

    setLoading(true);

    try {
      const hash = await authHelper.hashPassword(newPassword);
      await db.resetPasswordWithToken(token, hash);

      setIsSuccess(true);
      showToast('Password reset successful!', 'success');
    } catch (err: any) {
      console.error('Reset Password error:', err);
      showToast(err.message || 'Failed to reset password.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card glass-panel">
        <div className="auth-header">
          <div className="auth-logo">
            <i className="fa-solid fa-[#10b981] fa-lock"></i>
          </div>
          <h2 className="auth-title">
            {isSuccess ? 'Password Reset Successful' : 'Set New Password'}
          </h2>
          <p className="auth-subtitle">
            {isSuccess
              ? 'Your password has been changed successfully. You can now log in.'
              : 'Choose a strong new password for your account.'}
          </p>
        </div>

        {verifyingToken ? (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: '2rem', color: '#6366f1' }}></i>
            <p style={{ marginTop: '10px', color: 'var(--text-secondary)' }}>Verifying reset token...</p>
          </div>
        ) : !tokenValid && !isSuccess ? (
          <div style={{ textAlign: 'center', margin: '15px 0' }}>
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '10px',
                padding: '16px',
                marginBottom: '20px'
              }}
            >
              <i
                className="fa-solid fa-triangle-exclamation"
                style={{ fontSize: '2rem', color: '#ef4444', marginBottom: '10px' }}
              ></i>
              <p style={{ margin: '8px 0', fontSize: '0.95rem', color: '#f87171' }}>
                {tokenErrorMsg || 'Invalid or expired password reset link.'}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onBackToLogin}
              style={{ width: '100%' }}
            >
              Back to Login
            </button>
          </div>
        ) : !isSuccess ? (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="new-password">New Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  style={{ paddingRight: '40px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer'
                  }}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>

              {/* Password Strength Indicator */}
              {newPassword.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.75rem',
                      marginBottom: '4px',
                      color: passwordStrength.color,
                      fontWeight: 600
                    }}
                  >
                    <span>Strength:</span>
                    <span>{passwordStrength.label}</span>
                  </div>
                  <div
                    style={{
                      height: '4px',
                      borderRadius: '2px',
                      background: '#374151',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${(passwordStrength.score / 3) * 100}%`,
                        background: passwordStrength.color,
                        transition: 'all 0.3s ease'
                      }}
                    ></div>
                  </div>
                </div>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="confirm-password">Confirm New Password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                id="confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                required
              />
              {confirmPassword && newPassword !== confirmPassword && (
                <span style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
                  Passwords do not match
                </span>
              )}
            </div>

            <div className="form-group form-actions" style={{ marginTop: '15px' }}>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={loading}
              >
                {loading ? 'Processing...' : 'Reset Password'}
              </button>
            </div>
          </form>
        ) : (
          <div style={{ textAlign: 'center', margin: '15px 0' }}>
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '10px',
                padding: '20px',
                marginBottom: '20px'
              }}
            >
              <i
                className="fa-solid fa-circle-check"
                style={{ fontSize: '2.5rem', color: '#10b981', marginBottom: '10px' }}
              ></i>
              <h3 style={{ margin: '6px 0', fontSize: '1.1rem', color: '#fff' }}>
                Password Reset Successful!
              </h3>
              <p style={{ margin: '8px 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                You can now log in using your new password.
              </p>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={onBackToLogin}
              style={{ width: '100%' }}
            >
              Back to Login
            </button>
          </div>
        )}

        <div className="auth-toggle" style={{ marginTop: '20px', textAlign: 'center' }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onBackToLogin();
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <i className="fa-solid fa-arrow-left"></i>
            <span>Back to Login</span>
          </a>
        </div>
      </div>
    </div>
  );
}

export default ResetPassword;
