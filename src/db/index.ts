import { IDatabaseAdapter } from './types';
import { electronAdapter } from './electronAdapter';
import { capacitorAdapter } from './capacitorAdapter';
import { webAdapter } from './webAdapter';

export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && !!window.electronAPI;
};

export const isCapacitor = (): boolean => {
  return typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform();
};

export const getDbAdapter = (): IDatabaseAdapter => {
  if (isElectron()) {
    return electronAdapter;
  }
  if (isCapacitor()) {
    return capacitorAdapter;
  }
  return webAdapter;
};

export const initPlatformDb = async (): Promise<void> => {
  const adapter = getDbAdapter();
  if (adapter.initDb) {
    await adapter.initDb();
  }
};

export * from './types';
export * from './schema';
