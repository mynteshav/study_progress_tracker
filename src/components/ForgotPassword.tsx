import React, { useState } from 'react';
import { db } from '../db';
import { authHelper } from '../utils/auth';
import { sendPasswordResetEmail, isEmailConfigured } from '../utils/emailService';
import { sendFirebasePasswordReset } from '../utils/firebase';

interface ForgotPasswordProps {
  onBackToLogin: () => void;
  onNavigateReset?: (token: string) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

function ForgotPassword({ onBackToLogin, onNavigateReset, showToast }: ForgotPasswordProps) {
  const [email, setEmail] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [submittedEmail, setSubmittedEmail] = useState<string>('');
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      showToast('Please enter your email address.', 'error');
      return;
    }

    if (!authHelper.validateEmail(cleanEmail)) {
      showToast('Please enter a valid email address format.', 'error');
      return;
    }

    setLoading(true);

    try {
      // 1. Dispatch Firebase Auth Password Reset Email
      let firebaseSent = false;
      try {
        await sendFirebasePasswordReset(cleanEmail);
        firebaseSent = true;
        console.log('[Firebase Auth] Password reset email dispatched for:', cleanEmail);
      } catch (fbErr: any) {
        console.warn('[Firebase Auth] Password reset email failed:', fbErr);
      }

      // 2. Generate local 1-hour expiration token for in-app desktop reset fallback
      const token = authHelper.generateSecureToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const result = await db.createPasswordResetToken(cleanEmail, token, expiresAt);

      if (!result && !firebaseSent) {
        // User not found — show generic notice
        setSubmittedEmail(cleanEmail);
        setIsSuccess(true);
        setEmailSent(false);
        setGeneratedLink(null);
        showToast('If an account exists with this email, a reset link will be sent.', 'info');
        return;
      }

      // Construct reset URL for web/electron
      const baseUrl = window.location.origin + window.location.pathname;
      const resetUrl = `${baseUrl}#/reset-password?token=${token}`;
      setGeneratedLink(resetUrl);

      // Attempt to send email via EmailJS as secondary backup if configured
      let didSendEmail = firebaseSent;
      if (isEmailConfigured()) {
        const emailJsSuccess = await sendPasswordResetEmail({
          toEmail: cleanEmail,
          userName: result ? result.email : cleanEmail,
          resetLink: resetUrl,
        });
        didSendEmail = didSendEmail || emailJsSuccess;
      }

      setEmailSent(didSendEmail);
      setSubmittedEmail(cleanEmail);
      setIsSuccess(true);

      showToast('Password reset link sent to your email address!', 'success');
    } catch (err: any) {
      console.error('Forgot Password error:', err);
      showToast(err.message || 'An error occurred while sending reset link.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = () => {
    setIsSuccess(false);
    setGeneratedLink(null);
    setEmailSent(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card glass-panel">
        <div className="auth-header">
          <div className="auth-logo">
            <i className="fa-solid fa-key"></i>
          </div>
          <h2 className="auth-title">Forgot Password?</h2>
          <p className="auth-subtitle">
            {isSuccess
              ? emailSent
                ? 'Password reset link sent! Check your email inbox.'
                : 'A reset link has been generated for you.'
              : "Enter your email address and we'll help you reset your password."}
          </p>
        </div>

        {!isSuccess ? (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="reset-email">Email Address</label>
              <input
                type="email"
                id="reset-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>

            <div className="form-group form-actions" style={{ marginTop: '15px' }}>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={loading}
              >
                {loading ? 'Processing...' : 'Send Reset Link'}
              </button>
            </div>
          </form>
        ) : (
          <div className="success-state-container" style={{ textAlign: 'center', margin: '15px 0' }}>
            {/* Email sent successfully */}
            {emailSent && (
              <div
                style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '10px',
                  padding: '16px',
                  marginBottom: '20px'
                }}
              >
                <i
                  className="fa-solid fa-paper-plane"
                  style={{ fontSize: '2rem', color: '#10b981', marginBottom: '10px' }}
                ></i>
                <p style={{ margin: '8px 0', fontSize: '0.95rem' }}>
                  We sent a password reset link to:
                </p>
                <strong style={{ color: '#6366f1', fontSize: '1rem' }}>
                  {authHelper.maskEmail(submittedEmail)}
                </strong>
                <p style={{ margin: '10px 0 0', fontSize: '0.82rem', color: '#94a3b8' }}>
                  Check your inbox and spam folder. The link expires in 1 hour.
                </p>
              </div>
            )}

            {/* Direct reset link button (Always available when token generated) */}
            {generatedLink && (
              <div
                style={{
                  background: 'rgba(99, 102, 241, 0.1)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  borderRadius: '10px',
                  padding: '16px',
                  marginBottom: '20px'
                }}
              >
                <p style={{ margin: '0 0 10px', fontSize: '0.88rem', color: '#cbd5e1' }}>
                  {emailSent
                    ? 'Or reset your password directly inside this app:'
                    : 'Email service is not configured yet. Reset your password directly:'}
                </p>
                <a
                  href={generatedLink}
                  onClick={(e) => {
                    e.preventDefault();
                    const tokenMatch = generatedLink.match(/token=([^&]+)/);
                    if (tokenMatch && onNavigateReset) {
                      onNavigateReset(tokenMatch[1]);
                    } else {
                      window.location.hash = `#/reset-password?token=${generatedLink.split('token=')[1]}`;
                    }
                  }}
                  style={{
                    display: 'inline-block',
                    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '10px 20px',
                    color: '#ffffff',
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <i className="fa-solid fa-arrow-right" style={{ marginRight: '8px' }}></i>
                  Reset Password Now
                </a>
              </div>
            )}

            {/* No account found message */}
            {!emailSent && !generatedLink && (
              <div
                style={{
                  background: 'rgba(99, 102, 241, 0.1)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  borderRadius: '10px',
                  padding: '16px',
                  marginBottom: '20px'
                }}
              >
                <i
                  className="fa-solid fa-envelope-circle-check"
                  style={{ fontSize: '2rem', color: '#6366f1', marginBottom: '10px' }}
                ></i>
                <p style={{ margin: '8px 0', fontSize: '0.95rem' }}>
                  If an account exists for <strong style={{ color: '#818cf8' }}>{authHelper.maskEmail(submittedEmail)}</strong>, a reset link will be sent.
                </p>
              </div>
            )}

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleResend}
              style={{ width: '100%', marginBottom: '10px' }}
            >
              <i className="fa-solid fa-rotate-right" style={{ marginRight: '6px' }}></i>
              {emailSent ? 'Resend Email' : 'Try Again'}
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

export default ForgotPassword;
