import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { SCHEMA_STATEMENTS } from './schema';
import { IDatabaseAdapter } from './types';

let sqliteConnection: SQLiteConnection | null = null;
let dbInstance: SQLiteDBConnection | null = null;
let dbPromise: Promise<SQLiteDBConnection> | null = null;
let isWebStoreInitialized = false;

async function initWebStoreIfNeeded(): Promise<void> {
  if (isWebStoreInitialized) return;
  if (!sqliteConnection) {
    sqliteConnection = new SQLiteConnection(CapacitorSQLite);
  }
  let jeepEl = document.querySelector('jeep-sqlite');
  if (!jeepEl) {
    jeepEl = document.createElement('jeep-sqlite');
    document.body.appendChild(jeepEl);
  }
  await customElements.whenDefined('jeep-sqlite');
  try {
    // Timeout guard so initWebStore never hangs indefinitely
    await Promise.race([
      sqliteConnection.initWebStore(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('initWebStore timeout')), 2500))
    ]);
  } catch (e) {
    console.warn('[Capacitor SQLite] initWebStore skipped or timed out:', e);
  }
  isWebStoreInitialized = true;
}

async function ensureDb(): Promise<SQLiteDBConnection> {
  if (dbInstance) {
    try {
      const isOpen = await dbInstance.isDBOpen();
      if (isOpen.result) {
        return dbInstance;
      } else {
        await dbInstance.open();
        return dbInstance;
      }
    } catch (e) {
      // If check fails, reset instance to force re-initialization
      dbInstance = null;
    }
  }

  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = (async () => {
    try {
      if (!sqliteConnection) {
        sqliteConnection = new SQLiteConnection(CapacitorSQLite);
      }

      const platform = Capacitor.getPlatform();
      if (platform === 'web') {
        await initWebStoreIfNeeded();
      }

      const isConn = await sqliteConnection.isConnection('study_tracker', false);
      if (isConn.result) {
        dbInstance = await sqliteConnection.retrieveConnection('study_tracker', false);
      } else {
        dbInstance = await sqliteConnection.createConnection(
          'study_tracker',
          false,
          'no-encryption',
          1,
          false
        );
      }

      const isOpen = await dbInstance.isDBOpen();
      if (!isOpen.result) {
        await dbInstance.open();
      }

      // Execute initial DDL schema statements
      for (const statement of SCHEMA_STATEMENTS) {
        try {
          await dbInstance.execute(statement);
        } catch (err) {
          console.error('[Capacitor SQLite] Schema execution error:', err, 'Statement:', statement);
        }
      }

      if (platform === 'web' && sqliteConnection) {
        try {
          await sqliteConnection.saveToStore('study_tracker');
        } catch (e) {
          console.warn('[Capacitor SQLite] Initial saveToStore warning:', e);
        }
      }

      console.log('[Capacitor SQLite] Database initialized successfully.');
      return dbInstance;
    } catch (err) {
      dbPromise = null;
      dbInstance = null;
      console.error('[Capacitor SQLite] Initialization failed:', err);
      throw err;
    }
  })();

  return dbPromise;
}

export const capacitorAdapter: IDatabaseAdapter = {
  async initDb(): Promise<void> {
    await ensureDb();
  },

  async query(sql: string, params: any[] = []): Promise<any[]> {
    let db = await ensureDb();
    try {
      const res = await db.query(sql, params);
      return res.values || [];
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      if (errMsg.includes('not opened')) {
        console.warn('[Capacitor SQLite] DB not opened error detected, attempting to re-open...');
        dbInstance = null;
        dbPromise = null;
        db = await ensureDb();
        const res = await db.query(sql, params);
        return res.values || [];
      }
      console.error('[Capacitor SQLite] Query error:', err, sql, params);
      throw err;
    }
  },

  async run(sql: string, params: any[] = []): Promise<{ id: number; changes: number }> {
    let db = await ensureDb();
    try {
      const res = await db.run(sql, params);
      if (Capacitor.getPlatform() === 'web' && sqliteConnection) {
        await sqliteConnection.saveToStore('study_tracker');
      }
      const lastId = res.changes?.lastId !== undefined ? res.changes.lastId : 0;
      const changesCount = res.changes?.changes !== undefined ? res.changes.changes : 0;
      return { id: lastId, changes: changesCount };
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      if (errMsg.includes('not opened')) {
        console.warn('[Capacitor SQLite] DB not opened error detected, attempting to re-open...');
        dbInstance = null;
        dbPromise = null;
        db = await ensureDb();
        const res = await db.run(sql, params);
        if (Capacitor.getPlatform() === 'web' && sqliteConnection) {
          await sqliteConnection.saveToStore('study_tracker');
        }
        const lastId = res.changes?.lastId !== undefined ? res.changes.lastId : 0;
        const changesCount = res.changes?.changes !== undefined ? res.changes.changes : 0;
        return { id: lastId, changes: changesCount };
      }
      console.error('[Capacitor SQLite] Run error:', err, sql, params);
      throw err;
    }
  },

  async get(sql: string, params: any[] = []): Promise<any> {
    const rows = await this.query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }
};
