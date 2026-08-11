export interface IDatabaseAdapter {
  query(sql: string, params?: any[]): Promise<any[]>;
  run(sql: string, params?: any[]): Promise<{ id: number; changes: number }>;
  get(sql: string, params?: any[]): Promise<any>;
  initDb?(): Promise<void>;
}
