// candidate-dropdown.js (SAFE for v4.1)
// Ne change NI le CSS NI le HTML : juste la logique du dropdown + démarrage.
// Suppose que la page possède: #quizSelect, #startBtn, #candidateName, #msg (optionnel), #refreshBtn (optionnel).

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- Init Firebase ---
let app;
const apps = getApps();
if (apps.length) {
  app = apps[0];
} else {
  if (!window.firebaseConfig) {
    console.error("[candidate-dropdown] window.firebaseConfig manquant.");
    const msgEl = document.getElementById('msg');
    if (msgEl) { msgEl.textContent = "Configuration Firebase manquante (window.firebaseConfig)."; msgEl.className = "msg error"; }
    throw new Error("Firebase config missing");
  }
  app = initializeApp(window.firebaseConfig);
}
const db  = getFirestore(app);

// --- Elements ---
const selectEl   = document.getElementById('quizSelect');
const startBtn   = document.getElementById('startBtn');
const refreshBtn = document.getElementById('refreshBtn');
const nameInput  = document.getElementById('candidateName');
const msgEl      = document.getElementById('msg');

function setMessage(text, type){
  if (!msgEl) return;
  msgEl.textContent = text || "";
  msgEl.className = "msg" + (type ? " " + type : "");
}
function setLoading(){
  if (!selectEl) return;
  selectEl.disabled = true;
  selectEl.innerHTML = '<option value="">Chargement des QCM…</option>';
}
function setEmpty(){
  if (!selectEl) return;
  selectEl.disabled = true;
  selectEl.innerHTML = '<option value="">Aucun QCM disponible</option>';
}
function setReady(){
  if (!selectEl) return;
  selectEl.disabled = false;
  if (!selectEl.value && selectEl.options.length){ selectEl.selectedIndex = 0; }
}

// --- Charger les QCM depuis 'quizzes' ---
async function loadQuizzes(){
  try{
    setLoading();
    const snap = await getDocs(collection(db, 'quizzes'));
    console.log("[v4.1] quizzes count =", snap.size);

    if (!selectEl) return;
    selectEl.innerHTML = "";
    if (snap.empty){ setEmpty(); return; }

    const items = [];
    snap.forEach(doc => {
      const data = doc.data() || {};
      const quizName = (typeof data.name === 'string' && data.name.trim()) ? data.name.trim() : doc.id;
      items.push({ id: doc.id, name: quizName });
    });

    items.sort((a,b)=> a.name.localeCompare(b.name, 'fr'));

    const placeholder = document.createElement('option');
    placeholder.value = "";
    placeholder.textContent = "— Sélectionnez un QCM —";
    selectEl.appendChild(placeholder);

    for (const it of items){
      const opt = document.createElement('option');
      opt.value = it.id;
      opt.textContent = it.name;
      selectEl.appendChild(opt);
    }

    setReady();
    setMessage("");
  }catch(err){
    console.error("[v4.1] Erreur chargement QCM:", err);
    setMessage("Impossible de charger la liste des QCM. Vérifiez Firestore (rules/collection/projet).", "error");
    setEmpty();
  }
}

// --- Démarrage du QCM ---
function startQuiz(){
  const candidateName = (nameInput?.value || "").trim();
  const selectedQuizId = selectEl?.value || "";

  if (!candidateName){
    setMessage("Merci d’indiquer votre prénom.", "error");
    nameInput?.focus();
    return;
  }
  if (!selectedQuizId){
    setMessage("Merci de sélectionner un QCM.", "error");
    selectEl?.focus();
    return;
  }
  const url = `quiz.html?quizId=${encodeURIComponent(selectedQuizId)}&name=${encodeURIComponent(candidateName)}`;
  window.location.href = url;
}

// --- Events ---
window.addEventListener('DOMContentLoaded', loadQuizzes);
startBtn?.addEventListener('click', startQuiz);
refreshBtn?.addEventListener('click', loadQuizzes);
nameInput?.addEventListener('keydown', (e)=>{
  if (e.key === 'Enter'){ e.preventDefault(); startQuiz(); }
});
