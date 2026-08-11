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
  }
};
