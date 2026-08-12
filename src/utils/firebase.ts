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
  browserLocalPersistence
} from 'firebase/auth';

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

// Check if Firebase is properly configured
export function isFirebaseConfigured(): boolean {
  return (
    !!firebaseConfig.apiKey &&
    firebaseConfig.apiKey !== 'your_firebase_api_key' &&
    !!firebaseConfig.projectId
  );
}

// Initialize Firebase App singleton
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Ensure local persistence for Web & Electron
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('[Firebase Auth] Failed to set persistence:', err);
});

/**
 * Sign up a new user with email and password via Firebase Auth.
 */
export async function signUpWithFirebase(
  email: string,
  pass: string,
  displayName: string
): Promise<FirebaseUser> {
  const cleanEmail = email.trim().toLowerCase();
  const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, pass);
  
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
  const cleanEmail = email.trim().toLowerCase();
  const userCredential = await signInWithEmailAndPassword(auth, cleanEmail, pass);
  return userCredential.user;
}

/**
 * Send a password reset email via Firebase Auth.
 */
export async function sendFirebasePasswordReset(email: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  await firebaseSendPasswordResetEmail(auth, cleanEmail);
}

/**
 * Sign out current user from Firebase Auth.
 */
export async function logoutFirebase(): Promise<void> {
  await firebaseSignOut(auth);
}

/**
 * Listen for Firebase Auth state changes.
 */
export function onFirebaseAuthStateChanged(
  callback: (user: FirebaseUser | null) => void
) {
  return onAuthStateChanged(auth, callback);
}

export type { FirebaseUser };
