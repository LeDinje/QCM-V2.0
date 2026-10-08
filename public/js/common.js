/**
 * Initialisation Firebase partagée par l'accueil, l'espace candidat et l'espace admin.
 * Tous les accès Firebase passent par ce fichier (aucun autre script n'importe gstatic).
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut, signInWithEmailAndPassword,
         createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
         query, orderBy, serverTimestamp, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAt7nmCKcfLkzfaKVnbg7DdrP_8gerDJIg",
  authDomain: "qcm-pole-sud-2.firebaseapp.com",
  projectId: "qcm-pole-sud-2",
  storageBucket: "qcm-pole-sud-2.firebasestorage.app",
  messagingSenderId: "248571572847",
  appId: "1:248571572847:web:f0d7f4f1c3a4f592fa139a"
};

export const firebaseApp = initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

// Helpers
export async function ensureAnonAuth() {
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  return auth.currentUser;
}

export async function adminLogin(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}
export async function adminLogout() {
  return signOut(auth);
}

/**
 * Crée un compte e-mail / mot de passe SANS déconnecter l'utilisateur courant :
 * la création passe par une seconde instance Firebase, aussitôt déconnectée. Retourne l'uid du nouveau compte.
 */
export async function createAccount(email, password) {
  const secondary = initializeApp(firebaseConfig, "account-creator-" + Date.now());
  const secondaryAuth = getAuth(secondary);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    return cred.user.uid;
  } finally {
    await signOut(secondaryAuth).catch(() => {});
  }
}

/** Envoie l'e-mail Firebase « Réinitialiser votre mot de passe ». */
export async function sendPasswordReset(email) {
  auth.languageCode = "fr";
  return sendPasswordResetEmail(auth, email);
}

/** Envoie une image dans Firebase Storage et retourne son URL publique. */
export async function uploadImage(path, file) {
  const sRef = storageRef(getStorage(firebaseApp), path);
  await uploadBytes(sRef, file);
  return getDownloadURL(sRef);
}

export {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy,
  serverTimestamp, writeBatch, deleteField, onAuthStateChanged
};
