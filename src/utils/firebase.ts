import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  signOut as firebaseSignOut,
  updateProfile,
  onAuthStateChanged,
  User as FirebaseUser,
  setPersistence,
  browserLocalPersistence,
  Auth
} from 'firebase/auth';

// Firebase configuration from environment variables with safe defaults
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyB_demo_study_tracker_key_2026",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "study-tracker-app-2026.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "study-tracker-app-2026",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "study-tracker-app-2026.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "10892749281",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:10892749281:web:a8f9c7b6d5e4f3a2",
};

let appInstance: any = null;
let authInstance: Auth | null = null;

try {
  appInstance = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  authInstance = getAuth(appInstance);
  setPersistence(authInstance, browserLocalPersistence).catch((err) => {
    console.warn('[Firebase Auth] Failed to set persistence:', err);
  });
} catch (err) {
  console.error('[Firebase Auth] Failed to initialize Firebase App:', err);
}

export const auth = authInstance as Auth;

export function isFirebaseConfigured(): boolean {
  return !!authInstance;
}

/**
 * Sign up a new user with email and password via Firebase Auth.
 */
export async function signUpWithFirebase(
  email: string,
  pass: string,
  displayName: string
): Promise<FirebaseUser> {
  if (!authInstance) {
    throw new Error('Firebase Auth is not initialized. Please check your configuration.');
  }
  const cleanEmail = email.trim().toLowerCase();
  const userCredential = await createUserWithEmailAndPassword(authInstance, cleanEmail, pass);
  
  if (displayName && userCredential.user) {
    try {
      await updateProfile(userCredential.user, { displayName: displayName.trim() });
    } catch (err) {
      console.warn('[Firebase Auth] Failed to set displayName:', err);
    }
  }

  return userCredential.user;
}

/**
 * Log in an existing user with email and password via Firebase Auth.
 */
export async function loginWithFirebase(
  email: string,
  pass: string
): Promise<FirebaseUser> {
  if (!authInstance) {
    throw new Error('Firebase Auth is not initialized. Please check your configuration.');
  }
  const cleanEmail = email.trim().toLowerCase();
  const userCredential = await signInWithEmailAndPassword(authInstance, cleanEmail, pass);
  return userCredential.user;
}

/**
 * Send a password reset email via Firebase Auth.
 */
export async function sendFirebasePasswordReset(email: string): Promise<void> {
  if (!authInstance) {
    throw new Error('Firebase Auth is not initialized.');
  }
  const cleanEmail = email.trim().toLowerCase();
  await firebaseSendPasswordResetEmail(authInstance, cleanEmail);
}

/**
 * Sign out current user from Firebase Auth.
 */
export async function logoutFirebase(): Promise<void> {
  if (!authInstance) return;
  await firebaseSignOut(authInstance);
}

/**
 * Listen for Firebase Auth state changes.
 */
export function onFirebaseAuthStateChanged(
  callback: (user: FirebaseUser | null) => void
) {
  if (!authInstance) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(authInstance, callback);
}

export type { FirebaseUser };
