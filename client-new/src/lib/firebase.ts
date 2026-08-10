// src/lib/firebase.ts
// Real email/password auth via Firebase. This config is safe to expose
// publicly — it's not a secret, unlike the backend's service account key.
// Values come from Project Settings → General → Your apps → Web app.

import { initializeApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  deleteUser,
  type User,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export async function signUp(email: string, password: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logIn(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logOut(): Promise<void> {
  await firebaseSignOut(auth);
}

// Deletes the actual Firebase auth account. Firebase requires a "recent"
// login for this — if it's been a while since sign-in, this throws
// auth/requires-recent-login and the person needs to log in again first.
export async function deleteFirebaseAccount(): Promise<void> {
  if (!auth.currentUser) throw new Error("Not signed in");
  await deleteUser(auth.currentUser);
}