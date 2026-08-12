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

// Read Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

// Safe diagnostic logging (NEVER logs secret API keys)
console.log('[Firebase Auth] Configuration Status:');
console.log('  • API Key Configured:', !!firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('demo'));
console.log('  • Project ID:', firebaseConfig.projectId || 'Not set');
console.log('  • Auth Domain:', firebaseConfig.authDomain || 'Not set');

let appInstance: any = null;
let authInstance: Auth | null = null;

// Validate configuration
export function isFirebaseConfigured(): boolean {
  return (
    !!firebaseConfig.apiKey &&
    !firebaseConfig.apiKey.includes('demo') &&
    firebaseConfig.apiKey !== 'your_firebase_api_key' &&
    !!firebaseConfig.projectId &&
    !firebaseConfig.projectId.includes('demo')
  );
}

if (isFirebaseConfigured()) {
  try {
    appInstance = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    authInstance = getAuth(appInstance);
    setPersistence(authInstance, browserLocalPersistence).catch((err) => {
      console.warn('[Firebase Auth] Failed to set persistence:', err);
    });
  } catch (err) {
    console.error('[Firebase Auth] Initialization error:', err);
  }
} else {
  console.warn(
    '[Firebase Auth] Valid credentials not detected. Please add real Firebase keys to your .env file and Netlify settings.'
  );
}

export const auth = authInstance as Auth;

/**
 * Sign up a new user with email and password via Firebase Auth.
 */
export async function signUpWithFirebase(
  email: string,
  pass: string,
  displayName: string
): Promise<FirebaseUser> {
  if (!isFirebaseConfigured() || !authInstance) {
    throw new Error(
      'Firebase API key is missing or invalid. Please update VITE_FIREBASE_API_KEY in your .env file and Netlify settings with your credentials from Firebase Console.'
    );
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
  if (!isFirebaseConfigured() || !authInstance) {
    throw new Error(
      'Firebase API key is missing or invalid. Please update VITE_FIREBASE_API_KEY in your .env file and Netlify settings with your credentials from Firebase Console.'
    );
  }
  const cleanEmail = email.trim().toLowerCase();
  const userCredential = await signInWithEmailAndPassword(authInstance, cleanEmail, pass);
  return userCredential.user;
}

/**
 * Send a password reset email via Firebase Auth.
 */
export async function sendFirebasePasswordReset(email: string): Promise<void> {
  if (!isFirebaseConfigured() || !authInstance) {
    throw new Error(
      'Firebase API key is missing or invalid. Please update VITE_FIREBASE_API_KEY in your .env file and Netlify settings.'
    );
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
