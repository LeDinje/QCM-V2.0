/**
 * Firebase init shared by admin & candidate
 * Replace with your Firebase config (Project settings → General → Web App SDK config)
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signOut,
         createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
export async function adminRegister(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}
export async function adminLogout() {
  return signOut(auth);
}

export {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, writeBatch, onAuthStateChanged
};