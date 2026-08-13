import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  onSnapshot,
  Unsubscribe
} from 'firebase/firestore';
import { auth, firestoreDb, onFirebaseAuthStateChanged } from '../utils/firebase';
import { db } from '../db';

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'pending';

export interface SyncStatusState {
  status: SyncStatus;
  pendingCount: number;
  lastSyncedAt?: string;
  errorMessage?: string;
}

type SyncStatusListener = (state: SyncStatusState) => void;
type DataChangeListener = (entityType: string) => void;

const SYNCED_ENTITIES = [
  'topics',
  'tasks',
  'focus_sessions',
  'dsa_problems',
  'projects',
  'project_tasks',
  'timetable_blocks',
  'habits',
  'habit_logs',
  'notes',
  'flashcard_decks',
  'flashcards',
  'user_stats',
  'roadmaps'
];

class SyncServiceManager {
  private firestore = firestoreDb || getFirestore();
  private activeUid: string | null = null;
  private unsubscribers: Unsubscribe[] = [];
  private statusListeners: Set<SyncStatusListener> = new Set();
  private dataChangeListeners: Set<DataChangeListener> = new Set();

  private state: SyncStatusState = {
    status: 'synced',
    pendingCount: 0
  };

  private isProcessingQueue = false;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[SyncService] Network restored. Processing pending queue...');
        this.updateState({ status: 'syncing' });
        this.processQueue();
      });

      window.addEventListener('offline', () => {
        console.log('[SyncService] Network offline.');
        this.updateState({ status: 'offline' });
      });

      // Automatically listen to Firebase Auth state changes
      try {
        onFirebaseAuthStateChanged((user) => {
          if (user && user.uid) {
            console.log('[SyncService] Auth state changed. Active UID:', user.uid);
            this.init(user.uid);
          } else if (!user && this.activeUid) {
            this.cleanup();
          }
        });
      } catch (err) {
        console.warn('[SyncService] Failed to bind auth state listener:', err);
      }
    }
  }

  public getActiveUid(): string | null {
    const uid = auth.currentUser?.uid || this.activeUid;
    if (uid && isNaN(Number(uid))) {
      return uid;
    }
    return null;
  }

  /**
   * Subscribe to Sync Status changes (for UI status pill).
   */
  public subscribeStatus(listener: SyncStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.state);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * Subscribe to Data Change notifications (to trigger UI re-render when remote data arrives).
   */
  public subscribeDataChange(listener: DataChangeListener): () => void {
    this.dataChangeListeners.add(listener);
    return () => this.dataChangeListeners.delete(listener);
  }

  private updateState(newState: Partial<SyncStatusState>) {
    this.state = { ...this.state, ...newState };
    this.statusListeners.forEach((l) => l(this.state));
  }

  public notifyDataChange(entityType: string) {
    this.dataChangeListeners.forEach((l) => l(entityType));
  }

  /**
   * Initialize synchronization for the logged-in Firebase user.
   */
  public async init(inputUid?: string) {
    let resolvedUid = auth.currentUser?.uid || inputUid;

    // If inputUid is a local numeric SQLite ID (e.g. "1"), resolve actual firebase_uid from DB
    if (!resolvedUid || !isNaN(Number(resolvedUid))) {
      if (inputUid) {
        try {
          const userRec = await db.getUserById(Number(inputUid));
          if (userRec && userRec.firebase_uid) {
            resolvedUid = userRec.firebase_uid;
          }
        } catch (e) {}
      }
    }

    if (!resolvedUid || !isNaN(Number(resolvedUid))) {
      console.warn('[SyncService] Unable to resolve valid Firebase UID for sync initialization.');
      return;
    }

    if (this.activeUid === resolvedUid && this.unsubscribers.length > 0) {
      return;
    }

    this.cleanup();
    this.activeUid = resolvedUid;
    console.log(`[SyncService] Successfully initialized sync for Firebase UID: ${resolvedUid}`);

    this.updateState({ status: 'syncing' });

    try {
      // 1. Initial Migration & Merge from Firestore to local DB
      await this.performInitialSync(resolvedUid);

      // 2. Attach Real-time Listeners
      this.attachListeners(resolvedUid);

      // 3. Process any pending local changes
      await this.processQueue();

      this.updateState({
        status: navigator.onLine ? 'synced' : 'offline',
        lastSyncedAt: new Date().toISOString()
      });

      // Notify UI after initial sync finishes
      this.notifyDataChange('all');
    } catch (err: any) {
      console.error('[SyncService] Init failed:', err);
      this.updateState({
        status: 'pending',
        errorMessage: err.message || 'Failed to sync with cloud'
      });
    }
  }

  /**
   * Stop all listeners and clear active sync state on logout.
   */
  public cleanup() {
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];
    this.activeUid = null;
    this.updateState({ status: 'synced', pendingCount: 0 });
    console.log('[SyncService] Cleaned up listeners.');
  }

  /**
   * Attach Firestore Real-time listeners for all user entity collections.
   */
  private attachListeners(firebaseUid: string) {
    SYNCED_ENTITIES.forEach((entityType) => {
      const colRef = collection(this.firestore, `users/${firebaseUid}/${entityType}`);
      const unsub = onSnapshot(
        colRef,
        (snapshot) => {
          snapshot.docChanges().forEach(async (change) => {
            const data = change.doc.data();
            const docId = change.doc.id;

            if (change.type === 'removed' || data.is_deleted) {
              await this.applyRemoteDelete(entityType, docId, data);
            } else {
              await this.applyRemoteUpsert(entityType, docId, data);
            }

            this.notifyDataChange(entityType);
          });
        },
        (err) => {
          console.warn(`[SyncService] Firestore listener error on ${entityType}:`, err);
        }
      );

      this.unsubscribers.push(unsub);
    });
  }

  /**
   * Apply remote document insertion/update into local DB safely.
   */
  private async applyRemoteUpsert(entityType: string, docId: string, data: any) {
    const uid = this.getActiveUid();
    if (!uid) return;

    try {
      // Find local user ID corresponding to active Firebase UID
      const user = await db.getUserByFirebaseUid(uid);
      const userId = user ? user.id : 1;

      const record = { ...data, id: isNaN(Number(docId)) ? docId : Number(docId), user_id: userId };
      delete record.is_deleted;
      delete record.synced_at;

      // Upsert into local database using ON CONFLICT handling
      if (entityType === 'topics' || entityType === 'tasks') {
        await db.saveRemoteTopic?.(record);
      } else if (entityType === 'notes') {
        await db.saveRemoteNote?.(record);
      } else if (entityType === 'habits') {
        await db.saveRemoteHabit?.(record);
      } else if (entityType === 'projects') {
        await db.saveRemoteProject?.(record);
      } else if (entityType === 'dsa_problems') {
        await db.saveRemoteDsaProblem?.(record);
      } else if (entityType === 'timetable_blocks') {
        await db.saveRemoteTimetableBlock?.(record);
      } else if (entityType === 'focus_sessions') {
        await db.saveRemoteFocusSession?.(record);
      } else {
        await db.genericUpsert?.(entityType, record);
      }
    } catch (err) {
      console.warn(`[SyncService] Remote upsert error on ${entityType}:`, err);
    }
  }

  /**
   * Apply remote deletion to local DB.
   */
  private async applyRemoteDelete(entityType: string, docId: string, data: any) {
    try {
      const numericId = Number(docId);
      const targetId = isNaN(numericId) ? docId : numericId;
      const targetTable = entityType === 'tasks' ? 'topics' : entityType;
      await db.genericDelete?.(targetTable, targetId);
    } catch (err) {
      console.warn(`[SyncService] Remote delete error on ${entityType}:`, err);
    }
  }

  /**
   * Queue a local mutation to be uploaded to Firestore.
   */
  public async queueChange(
    entityType: string,
    entityId: string | number,
    operation: 'CREATE' | 'UPDATE' | 'DELETE',
    payload: any = {}
  ) {
    const uid = this.getActiveUid();
    if (!uid) {
      console.warn('[SyncService] Cannot queue change: No active Firebase UID.');
      return;
    }

    const docId = String(entityId);
    console.log(`[SyncService] CREATE TOPIC START -> Firebase UID: ${uid}, Doc ID: ${docId}, Entity: ${entityType}`);
    console.log(`[SyncService] FIRESTORE WRITE START -> users/${uid}/${entityType}/${docId}`);

    if (navigator.onLine && this.firestore) {
      const docRef = doc(this.firestore, `users/${uid}/${entityType}/${docId}`);
      try {
        if (operation === 'DELETE') {
          await setDoc(docRef, { is_deleted: true, updated_at: new Date().toISOString() }, { merge: true });
        } else {
          await setDoc(
            docRef,
            {
              ...payload,
              updated_at: payload.updated_at || new Date().toISOString(),
              is_deleted: false
            },
            { merge: true }
          );
        }
        console.log(`[SyncService] FIRESTORE WRITE SUCCESS -> users/${uid}/${entityType}/${docId}`);
      } catch (err: any) {
        console.error(`[SyncService] FIRESTORE WRITE FAILED -> users/${uid}/${entityType}/${docId} | Code: ${err.code || 'unknown'}, Message: ${err.message || err}`);
        throw new Error(`Firestore write failed (${err.code || 'error'}): ${err.message || err}`);
      }
    }

    const payloadStr = JSON.stringify({
      ...payload,
      updated_at: new Date().toISOString(),
      is_deleted: operation === 'DELETE'
    });

    try {
      await db.addSyncQueueItem?.(uid, entityType, docId, operation, payloadStr);
      this.updateState({ status: 'synced' });
    } catch (err) {
      console.warn('[SyncService] Failed to queue change locally:', err);
    }
  }

  /**
   * Direct Firestore write fallback.
   */
  private async directFirestoreWrite(
    uid: string,
    entityType: string,
    entityId: string,
    operation: 'CREATE' | 'UPDATE' | 'DELETE',
    payload: any
  ) {
    if (!navigator.onLine) return;
    const docRef = doc(this.firestore, `users/${uid}/${entityType}/${entityId}`);
    try {
      if (operation === 'DELETE') {
        await setDoc(docRef, { is_deleted: true, updated_at: new Date().toISOString() }, { merge: true });
      } else {
        await setDoc(
          docRef,
          {
            ...payload,
            updated_at: new Date().toISOString(),
            is_deleted: false
          },
          { merge: true }
        );
      }
    } catch (err) {
      console.warn('[SyncService] Direct Firestore write error:', err);
    }
  }

  /**
   * Process all PENDING queue items.
   */
  public async processQueue() {
    if (this.isProcessingQueue || !navigator.onLine) return;
    const uid = this.getActiveUid();
    if (!uid) return;

    this.isProcessingQueue = true;

    try {
      const pendingItems = (await db.getPendingSyncQueue?.(uid)) || [];
      if (pendingItems.length === 0) {
        this.updateState({ status: 'synced', pendingCount: 0 });
        this.isProcessingQueue = false;
        return;
      }

      this.updateState({ status: 'syncing', pendingCount: pendingItems.length });

      for (const item of pendingItems) {
        try {
          const payload = JSON.parse(item.payload || '{}');
          const docRef = doc(this.firestore, `users/${uid}/${item.entity_type}/${item.entity_id}`);

          if (item.operation === 'DELETE') {
            await setDoc(docRef, { is_deleted: true, updated_at: new Date().toISOString() }, { merge: true });
          } else {
            await setDoc(
              docRef,
              {
                ...payload,
                updated_at: payload.updated_at || new Date().toISOString(),
                is_deleted: false
              },
              { merge: true }
            );
          }

          await db.markSyncQueueItemSynced?.(item.id);
        } catch (err: any) {
          console.warn(`[SyncService] Failed to sync queue item #${item.id}:`, err);
        }
      }

      const remaining = (await db.getPendingSyncQueue?.(uid)) || [];
      this.updateState({
        status: remaining.length === 0 ? 'synced' : 'pending',
        pendingCount: remaining.length,
        lastSyncedAt: new Date().toISOString()
      });
    } catch (err) {
      console.warn('[SyncService] Queue processing exception:', err);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Perform initial migration of existing local records to Firestore, and merge remote records.
   */
  private async performInitialSync(firebaseUid: string) {
    if (!navigator.onLine) return;

    const user = await db.getUserByFirebaseUid(firebaseUid);
    const userId = user ? user.id : 1;

    for (const entityType of SYNCED_ENTITIES) {
      try {
        // 1. Fetch local records
        const localRecords = (await db.getAllRecordsForSync?.(entityType, userId)) || [];

        // 2. Upload local records to Firestore if not present
        for (const rec of localRecords) {
          if (!rec.id) continue;
          const docRef = doc(this.firestore, `users/${firebaseUid}/${entityType}/${rec.id}`);
          await setDoc(
            docRef,
            {
              ...rec,
              updated_at: rec.updated_at || new Date().toISOString(),
              is_deleted: false
            },
            { merge: true }
          );
        }

        // 3. Download remote Firestore records
        const colRef = collection(this.firestore, `users/${firebaseUid}/${entityType}`);
        const snapshot = await getDocs(colRef);
        for (const docSnap of snapshot.docs) {
          const data = docSnap.data();
          if (!data.is_deleted) {
            await this.applyRemoteUpsert(entityType, docSnap.id, data);
          }
        }
      } catch (err) {
        console.warn(`[SyncService] Initial sync error on ${entityType}:`, err);
      }
    }
  }
}

export const SyncService = new SyncServiceManager();
