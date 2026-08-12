import bcrypt from 'bcryptjs';
import { isElectron } from '../db/index';

export const authHelper = {
  async hashPassword(password: string): Promise<string> {
    if (isElectron() && window.electronAPI?.bcryptHash) {
      return window.electronAPI.bcryptHash(password);
    }
    return bcrypt.hashSync(password, 10);
  },

  async comparePassword(password: string, hash: string): Promise<boolean> {
    if (isElectron() && window.electronAPI?.bcryptCompare) {
      return window.electronAPI.bcryptCompare(password, hash);
    }
    return bcrypt.compareSync(password, hash);
  },

  validateEmail(email: string): boolean {
    if (!email) return false;
    const cleanEmail = email.trim();
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(cleanEmail);
  },

  maskEmail(email: string): string {
    const clean = email.trim();
    const parts = clean.split('@');
    if (parts.length !== 2) return clean;
    const name = parts[0];
    const domain = parts[1];
    if (name.length <= 2) {
      return `${name.charAt(0)}***@${domain}`;
    }
    return `${name.charAt(0)}***${name.charAt(name.length - 1)}@${domain}`;
  },

  generateSecureToken(): string {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const arr = new Uint8Array(24);
      crypto.getRandomValues(arr);
      return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  },

  evaluatePasswordStrength(password: string): { score: number; label: 'Weak' | 'Medium' | 'Strong'; color: string } {
    if (!password || password.length < 6) {
      return { score: 1, label: 'Weak', color: '#ef4444' };
    }
    let points = 1;
    if (password.length >= 8) points++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) points++;
    if (/[0-9]/.test(password)) points++;
    if (/[^A-Za-z0-9]/.test(password)) points++;

    if (points <= 2) {
      return { score: 1, label: 'Weak', color: '#ef4444' };
    } else if (points <= 3) {
      return { score: 2, label: 'Medium', color: '#f59e0b' };
    } else {
      return { score: 3, label: 'Strong', color: '#10b981' };
    }
  }
};
