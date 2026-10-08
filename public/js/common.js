/**
 * Initialisation Firebase partagée par l'accueil, l'espace candidat et l'espace admin.
 * Tous les accès Firebase passent par ce fichier (aucun autre script n'importe gstatic).
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut,
         signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
         query, orderBy, serverTimestamp, writeBatch, deleteField } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

export const firebaseApp = initializeApp({
  apiKey: "AIzaSyAt7nmCKcfLkzfaKVnbg7DdrP_8gerDJIg",
  authDomain: "qcm-pole-sud-2.firebaseapp.com",
  projectId: "qcm-pole-sud-2",
  storageBucket: "qcm-pole-sud-2.firebasestorage.app",
  messagingSenderId: "248571572847",
  appId: "1:248571572847:web:f0d7f4f1c3a4f592fa139a"
});

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
