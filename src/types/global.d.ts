export {};

declare global {
  interface ElectronAPI {
    dbQuery: (sql: string, params?: any[]) => Promise<any[]>;
    dbRun: (sql: string, params?: any[]) => Promise<{ id: number; changes: number }>;
    dbGet: (sql: string, params?: any[]) => Promise<any>;
    bcryptHash: (password: string) => Promise<string>;
    bcryptCompare: (password: string, hash: string) => Promise<boolean>;
  }

  interface Window {
    electronAPI: ElectronAPI;
  }
}
