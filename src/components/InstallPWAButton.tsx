import React from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface InstallPWAButtonProps {
  showToast?: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  className?: string;
}

export const InstallPWAButton: React.FC<InstallPWAButtonProps> = ({ showToast, className }) => {
  const { isInstallable, promptInstall } = usePWAInstall();

  if (!isInstallable) {
    return null;
  }

  const handleInstallClick = async () => {
    const installed = await promptInstall();
    if (installed && showToast) {
      showToast('Study Tracker installed successfully!', 'success');
    }
  };

  return (
    <button
      className={className || 'install-pwa-btn'}
      onClick={handleInstallClick}
      title="Install Study Tracker as an application"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 14px',
        borderRadius: '20px',
        fontSize: '0.85rem',
        fontWeight: 600,
        background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
        color: '#ffffff',
        border: 'none',
        cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        marginRight: '12px'
      }}
    >
      <i className="fa-solid fa-mobile-screen-button"></i>
      <span>Install App</span>
    </button>
  );
};

export default InstallPWAButton;
