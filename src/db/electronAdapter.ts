import { IDatabaseAdapter } from './types';

export const electronAdapter: IDatabaseAdapter = {
  async query(sql: string, params: any[] = []): Promise<any[]> {
    if (!window.electronAPI?.dbQuery) {
      throw new Error('Electron API dbQuery is not available in renderer process.');
    }
    return window.electronAPI.dbQuery(sql, params);
  },

  async run(sql: string, params: any[] = []): Promise<{ id: number; changes: number }> {
    if (!window.electronAPI?.dbRun) {
      throw new Error('Electron API dbRun is not available in renderer process.');
    }
    return window.electronAPI.dbRun(sql, params);
  },

  async get(sql: string, params: any[] = []): Promise<any> {
    if (!window.electronAPI?.dbGet) {
      throw new Error('Electron API dbGet is not available in renderer process.');
    }
    return window.electronAPI.dbGet(sql, params);
  }
};
