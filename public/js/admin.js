import { auth, db, firebaseApp, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, writeBatch,
         adminLogin, adminRegister, adminLogout, onAuthStateChanged, serverTimestamp } from "./common.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const ui = {
  cardAuth: document.getElementById('card-auth'),
  cardAdmin: document.getElementById('card-admin'),
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  loginBtn: document.getElementById('loginBtn'),
  registerBtn: document.getElementById('registerBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  whoami: document.getElementById('whoami'),

  quizSelectAdmin: document.getElementById('quizSelectAdmin'),
  newQuizBtn: document.getElementById('newQuizBtn'),

  qTitle: document.getElementById('qTitle'),
  qDesc: document.getElementById('qDesc'),
  qTimerEnabled: document.getElementById('qTimerEnabled'),
  qTimer: document.getElementById('qTimer'),
  saveQuizBtn: document.getElementById('saveQuizBtn'),

  quizzesSummary: document.getElementById('quizzesSummary'),
  questionsList: document.getElementById('questionsList'),
  qText: document.getElementById('qText'),
  opt0: document.getElementById('opt0'),
  opt1: document.getElementById('opt1'),
  opt2: document.getElementById('opt2'),
  opt3: document.getElementById('opt3'),
  correctIndex: document.getElementById('correctIndex'),
  addQuestionBtn: document.getElementById('addQuestionBtn'),
  otherEnabled: document.getElementById('otherEnabled'),

  resultsList: document.getElementById('resultsList'),
  candidateDetail: document.getElementById('candidateDetail'),
};

let currentQuizId = null;
let currentQuestions = [];
let editingQuestionId = null; // id de la question en cours d'edition (null = mode ajout)
let unsubQuestions = null;
let unsubResults = null;

// === Autres : verrouille la réponse D ===
if (ui.otherEnabled && ui.opt3 && ui.correctIndex) {
  const lockAutres = () => {
    ui.opt3.value = 'Autres';
    ui.opt3.disabled = true;
    if (Number(ui.correctIndex.value) === 3) ui.correctIndex.value = 0;
  };
  const unlockAutres = () => {
    ui.opt3.disabled = false;
    if (ui.opt3.value === 'Autres') ui.opt3.value = '';
  };
  ui.otherEnabled.addEventListener('change', () => {
    ui.otherEnabled.checked ? lockAutres() : unlockAutres();
  });
}

let unsubQuizzes = null;

// === Results collapsible + live counter (collapsed by default) ===
let resultsCollapsed = true;
let resultsToggleBtn = null;
function updateResultsToggleLabel(){
  try{
    const list = ui.resultsList;
    if (!resultsToggleBtn || !list) return;
    const n = list ? list.querySelectorAll('.item').length : 0;
    resultsToggleBtn.textContent =
      (resultsCollapsed ? 'Afficher les résultats ' : 'Masquer les résultats ')
      + '(' + n + ') '
      + (resultsCollapsed ? '▼' : '▲');
  }catch(e){}
}
(function setupResultsToggle(){
  try{
    const list = ui.resultsList;
    const detail = ui.candidateDetail;
    if (!list || !detail) return;
    // Create the button once, with light-blue gradient style
    resultsToggleBtn = document.getElementById('toggleResults');
    if (!resultsToggleBtn){
      const btn = document.createElement('button');
      btn.id = 'toggleResults';
      btn.type = 'button';
      btn.style.padding = '8px 12px';
      btn.style.borderRadius = '12px';
      btn.style.border = '1px solid #b6d4fe';
      btn.style.background = 'linear-gradient(180deg, #eaf2ff, #d8e7ff)';
      btn.style.color = '#0b5ed7';
      btn.style.fontWeight = '600';
      btn.style.boxShadow = '0 1px 0 rgba(255,255,255,.6) inset, 0 1px 2px rgba(0,0,0,.08)';
      btn.style.cursor = 'pointer';
      btn.style.margin = '6px 0 10px 0';
      btn.addEventListener('mouseenter', function(){
        btn.style.background = 'linear-gradient(180deg, #e2ecff, #cfe1ff)';
      });
      btn.addEventListener('mouseleave', function(){
        btn.style.background = 'linear-gradient(180deg, #eaf2ff, #d8e7ff)';
      });
      btn.addEventListener('click', function(){
        resultsCollapsed = !resultsCollapsed;
        list.style.display = resultsCollapsed ? 'none' : '';
        detail.style.display = resultsCollapsed ? 'none' : '';
        updateResultsToggleLabel();
      });
      list.insertAdjacentElement('beforebegin', btn);
      resultsToggleBtn = btn;
    }
    // Default collapsed
    list.style.display = 'none';
    detail.style.display = 'none';
    // Observe changes to update (N)
    try{
      const mo = new MutationObserver(updateResultsToggleLabel);
      mo.observe(list, { childList: true, subtree: false });
    }catch(e){}
    updateResultsToggleLabel();
  }catch(e){ console.warn('[results toggle]', e); }
})();

// === Quizzes summary highlight (subtle blue, readable text, no default selection) ===
(function setupSummaryHighlight(){
  try{
    const root = ui.quizzesSummary;
    if (!root) return;
    function clearActive(){
      const items = root.querySelectorAll('.item');
      for (let i=0;i<items.length;i++){
        const el = items[i];
        el.classList.remove('is-active');
        el.style.background = '';
        el.style.backgroundColor = '';
        el.style.borderColor = '';
        el.style.boxShadow = '';
        el.style.color = '';
        // reset typical inner text colors
        const t = el.querySelector('.title, h3, h4, .name');
        if (t) t.style.color = '';
        const subs = el.querySelectorAll('.muted, .small, small, p, .subtitle');
        subs.forEach(s => s.style.color = '');
      }
    }
    function setActive(el){
      if (!el) return;
      el.classList.add('is-active');
      el.style.background = '#e7f1ff';
      el.style.backgroundColor = '#e7f1ff';
      el.style.borderColor = '#b6cfff';
      el.style.boxShadow = '0 0 0 1px #d9e8ff inset, 0 1px 2px rgba(0,0,0,.03)';
      el.style.color = '#0b2244'; // ensure readable default
      const t = el.querySelector('.title, h3, h4, .name');
      if (t) t.style.color = '#0b2244';
      const subs = el.querySelectorAll('.muted, .small, small, p, .subtitle');
      subs.forEach(s => s.style.color = '#345c8a');
    }
    // Do not select any by default on initial render
    // If some other code set a "currentQuizId", try to nullify it
    try{
      if (typeof currentQuizId !== 'undefined') currentQuizId = null;
    }catch(e){}
    // Clear any pre-set highlight once the list is rendered
    try{
      const mo = new MutationObserver(function(){
        clearActive();
      });
      mo.observe(root, { childList:true, subtree:false });
    }catch(e){}

    // Click to highlight one item
    root.addEventListener('click', function(e){
      const item = e.target.closest('.item');
      if (!item) return;
      clearActive();
      setActive(item);
    }, true);
  }catch(e){ console.warn('[summary highlight]', e); }
})();



function showAuth() { ui.cardAuth.style.display = 'block'; ui.cardAdmin.style.display = 'none'; }
function showAdmin() { ui.cardAuth.style.display = 'none'; ui.cardAdmin.style.display = 'block'; }

async function isAdmin(uid) {
  try {
    const snap = await getDoc(doc(db, 'admins', uid));
    return snap.exists();
  } catch (err) {
    console.warn('isAdmin() read failed:', err);
    return false;
  }
}

// Auth handlers with error feedback
ui.loginBtn.addEventListener('click', async () => {
  try {
    await adminLogin(ui.email.value.trim(), ui.password.value);
  } catch (err) {
    console.error(err);
    alert('Connexion impossible: ' + (err && (err.code || err.message) ? (err.code || err.message) : err));
  }
});

ui.registerBtn.addEventListener('click', async () => {
  try {
    await adminRegister(ui.email.value.trim(), ui.password.value);
    alert('Compte cree. Connectez-vous.');
  } catch (err) {
    console.error(err);
    if (err && err.code === 'auth/operation-not-allowed') {
      alert('Activez Email/Mot de passe dans Firebase > Authentication > Methodes de connexion.');
    } else {
      alert('Creation impossible: ' + (err && (err.code || err.message) ? (err.code || err.message) : err));
    }
  }
});

ui.logoutBtn.addEventListener('click', async () => {
  try {
    await adminLogout();
  } catch (err) {
    console.error(err);
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) { showAuth(); return; }
  ui.whoami.textContent = user.email || user.uid;
  const ok = await isAdmin(user.uid);
  if (ok) { showAdmin(); bootData(); }
  else { showAuth(); }
});

// Helpers for creating a "Nouveau QCM" with unique suffix
async function generateNewQuizTitle() {
  const snap = await getDocs(collection(db, 'quizzes'));
  const base = 'Nouveau QCM';
  const titles = snap.docs.map(d => (d.data().title || '').trim());
  if (!titles.includes(base)) return base;
  // find highest (n) pattern
  let n = 1;
  const re = /^Nouveau QCM \((\d+)\)$/;
  const taken = new Set(titles);
  while (taken.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

async function createNewQuizAndLoad() {
  const title = await generateNewQuizTitle();
  const payload = {
    title,
    description: '',
    timerMinutes: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'quizzes'), payload);
  // insert option and select it
  const opt = document.createElement('option');
  opt.value = ref.id;
  opt.textContent = `${title} (0 min)`;
  ui.quizSelectAdmin.appendChild(opt);
  ui.quizSelectAdmin.value = ref.id;
  await loadQuiz(ref.id);
}

// Load dropdown and summary
async function bootData() {
  if (unsubQuizzes) unsubQuizzes();
  unsubQuizzes = onSnapshot(collection(db, 'quizzes'), async (snap) => {
    // Build options without placeholder
    const opts = [];
    const summaryRows = [];
    for (const d of snap.docs) {
      const q = d.data(); q.id = d.id;
      opts.push({ id: d.id, title: q.title || '(Sans titre)', timer: q.timerMinutes || 0, description: q.description || '', orderIndex: (typeof q.orderIndex === 'number') ? q.orderIndex : null });
    }

    // Tri par ordre personnalise (orderIndex) ; les QCM sans ordre defini passent a la fin (tries par titre)
    opts.sort((a, b) => {
      const ao = (typeof a.orderIndex === 'number') ? a.orderIndex : 1e9;
      const bo = (typeof b.orderIndex === 'number') ? b.orderIndex : 1e9;
      if (ao !== bo) return ao - bo;
      return a.title.localeCompare(b.title);
    });

    // If none exist: create one automatically and return (next snapshot will handle UI)
    if (opts.length === 0) {
      await createNewQuizAndLoad();
      return;
    }

    // Populate dropdown
    ui.quizSelectAdmin.innerHTML = '';
    for (const o of opts) {
      const option = document.createElement('option');
      option.value = o.id;
      option.textContent = `${o.title} (${o.timer} min)`;
      ui.quizSelectAdmin.appendChild(option);
    }

    // If nothing selected yet, select first and load
    if (!currentQuizId) {
      ui.quizSelectAdmin.selectedIndex = 0;
      await loadQuiz(opts[0].id);
    } else {
      // Ensure dropdown reflects current selection if it still exists
      const idx = opts.findIndex(x => x.id === currentQuizId);
      if (idx >= 0) ui.quizSelectAdmin.selectedIndex = idx;
    }

    // Summary rows (needs counts)
    // On lit TOUS les resultats une seule fois (au lieu d'une fois par QCM) -> beaucoup plus rapide
    const allResults = await getDocs(collection(db, 'results'));
    for (const o of opts) {
      const qs = await getDocs(collection(db, 'quizzes', o.id, 'questions'));
      const resCount = allResults.docs.filter(x => (x.data().quizId === o.id)).length;
      const qCount = qs.size;
      summaryRows.push(`<div class="item quizrow" data-id="${o.id}" draggable="true" style="cursor:move">
        <div style="min-width:0">
          <b>⠿ ${o.title}</b>
          <div class="small">${o.description}</div>
          <div class="small">Timer: ${o.timer > 0 ? 'Oui (' + o.timer + ' min)' : 'Non'}</div>
          <div class="small">Questions: ${qCount} • Resultats: ${resCount}</div>
        </div>
        <div class="row" style="flex-wrap:nowrap; flex-shrink:0">
          <button data-action="select" data-id="${o.id}">Editer</button>
          <button class="btn-danger" data-action="delete" data-id="${o.id}">Supprimer</button>
        </div>
      </div>`);
    }
    ui.quizzesSummary.innerHTML = summaryRows.join('') || '<div class="small">Aucun QCM.</div>';
    enableQuizDragAndDrop();
  });

  // Immediate load on change
  ui.quizSelectAdmin.addEventListener('change', () => {
    const id = ui.quizSelectAdmin.value;
    if (id) loadQuiz(id);
  });
}

// New quiz button: create immediately then load
ui.newQuizBtn.addEventListener('click', async () => {
  await createNewQuizAndLoad();
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button,a');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === 'select') {
    loadQuiz(id);
  }
  if (action === 'editQuestion') {
    const q = currentQuestions.find(x => x.id === id);
    if (q) startEditQuestion(q);
  }
  if (action === 'delete') {
    if (!confirm('Supprimer ce QCM et toutes ses questions ?')) return;
    const qs = await getDocs(collection(db, 'quizzes', id, 'questions'));
    for (const qdoc of qs.docs) await deleteDoc(doc(db, 'quizzes', id, 'questions', qdoc.id));
    await deleteDoc(doc(db, 'quizzes', id));
    if (currentQuizId === id) {
      currentQuizId = null;
      // Selecting first will be handled by snapshot refresh
    }
  }
  if (action === 'delQuestion') {
    const pair = id.split('::');
    const qid = pair[0]; const qdoc = pair[1];
    await deleteDoc(doc(db, 'quizzes', qid, 'questions', qdoc));
  }
  if (action === 'viewCandidate') {
    e.preventDefault();
    const resId = id;
    const resDoc = await getDoc(doc(db, 'results', resId));
    renderCandidateDetail(resDoc.data());
  }
});

// Load a quiz by id (or clear for new)
async function loadQuiz(id) {
  currentQuizId = id;
  if (!id) {
    ui.qTitle.value = '';
    ui.qDesc.value = '';
    ui.qTimerEnabled.checked = false;
    ui.qTimer.value = 10;
    ui.qTimer.disabled = true;
    ui.questionsList.innerHTML = '<div class="small">Creez/enregistrez un nouveau QCM, puis ajoutez des questions.</div>';
    ui.resultsList.innerHTML = '<div class="small">Selectionnez un QCM pour voir ses resultats.</div>';
    if (unsubQuestions) unsubQuestions();
    if (unsubResults) unsubResults();
    return;
  }
  const dataSnap = await getDoc(doc(db, 'quizzes', id));
  const data = dataSnap.data() || {};
  ui.qTitle.value = data.title || '';
  ui.qDesc.value = data.description || '';
  const t = Number(data.timerMinutes || 0);
  ui.qTimerEnabled.checked = t > 0;
  ui.qTimer.disabled = !ui.qTimerEnabled.checked;
  ui.qTimer.value = t > 0 ? t : 10;

  function renderQuestionsList(){
  if (!ui || !ui.questionsList) return;
  if (!Array.isArray(currentQuestions)) return;
  if (!currentQuestions.length){
    ui.questionsList.innerHTML = '<div class="small">Aucune question.</div>';
    return;
  }
  const rows = currentQuestions.map(q => {
    const opts = (q.options || []).map((o, i) => i === q.correctIndex ? ('<b>' + o + '</b>') : o).join(' • ');
    return `<div class="item qrow" data-id="${q.id}" draggable="true">
      <div style="min-width:0"><b>${q.text}</b><div class="small">${opts}</div></div>
      <div class="row" style="gap:6px; flex-wrap:nowrap; flex-shrink:0">
        <button data-action="editQuestion" data-id="${q.id}">Éditer</button>
        <button class="btn-danger" data-action="delQuestion" data-id="${currentQuizId}::${q.id}">Supprimer</button>
      </div>
    </div>`;
  }).join('');
  ui.questionsList.innerHTML = rows;
  if (typeof enableDragAndDropAutoSave === 'function') enableDragAndDropAutoSave();
}

// Watch questions
  const quizIdForQuestions = currentQuizId || ui.quizSelectAdmin.value;
  if (unsubQuestions) unsubQuestions();
  unsubQuestions = onSnapshot(collection(db, 'quizzes', quizIdForQuestions, 'questions'), (snap) => {
    const arr = [];
    snap.forEach(d => {
      const q = d.data();
      arr.push({
        id: d.id,
        text: q.text || q.title || '(Sans titre)',
        options: q.options || q.answers || [],
        correctIndex: (typeof q.correctIndex === 'number') ? q.correctIndex : 0,
        orderIndex: (typeof q.orderIndex === 'number') ? q.orderIndex : null,
        createdAt: q.createdAt || 0,
      });
    });
    arr.sort((a,b)=>{
      const ao=a.orderIndex, bo=b.orderIndex;
      if (ao==null && bo!=null) return 1;
      if (ao!=null && bo==null) return -1;
      if (ao!=null && bo!=null && ao!==bo) return ao-bo;
      const ac=a.createdAt?.seconds||a.createdAt||0, bc=b.createdAt?.seconds||b.createdAt||0;
      if (ac!==bc) return ac-bc;
      return (a.id>b.id)?1:-1;
    });
    currentQuestions = arr;
    renderQuestionsList();;
  });

  // Watch results
  const resultsQuizId = currentQuizId || ui.quizSelectAdmin.value;
if (unsubResults) unsubResults();
  unsubResults = onSnapshot(query(collection(db, 'results'), orderBy('createdAt', 'desc')), (snap) => {
    const items = [];
    snap.forEach(d => {
      const r = d.data();
      if (r.quizId !== resultsQuizId) return;
      const date = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate() : new Date();
      items.push(`<div class="item">
        <div>
          <b><a href="#" data-action="viewCandidate" data-id="${d.id}">${r.candidateName || '(Inconnu)'}</a></b>
          <div class="small">${r.quizTitle || ''} • ${date.toLocaleString()}</div>
        </div>
        <div class="badge">Score ${r.score}/${r.total}</div>
        ${ (r.trust && typeof r.trust.score==='number') ? (function(){ 
            var s=r.trust.score;
            var col = s>=90?'#16a34a':(s>=70?'#f59e0b':'#ef4444');
            return `<div class="badge" style="border-color:${col};color:${col}">Trust ${s}/100</div>`;
          })() : '' }
      </div>`);
    });
    ui.resultsList.innerHTML = items.join('') || '<div class="small">Aucun resultat pour ce QCM.</div>';
    // Inject delete ❌ button per result item (safe)
    try {
      Array.from(ui.resultsList.querySelectorAll('.item')).forEach((el) => {
        if (el.querySelector('.delete-result')) return;

        const link = el.querySelector('[data-action="viewCandidate"]');
        const resId = link ? link.getAttribute('data-id') : null;
        if (!resId) return;

        const btn = document.createElement('button');
        btn.className = 'delete-result';
        btn.type = 'button';
        btn.textContent = '✖';
        btn.title = 'Supprimer ce résultat';

        btn.style.marginLeft = '8px';
        btn.style.border = 'none';
        btn.style.background = 'transparent';
        btn.style.color = '#dc3545';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '16px';
        btn.style.fontWeight = '700';

        btn.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();

          const name = el.querySelector('b')?.textContent || 'ce candidat';
          const ok = confirm(`Supprimer définitivement le résultat de ${name} ?\n\nCette action est irréversible.`);
          if (!ok) return;

          try {
            await deleteDoc(doc(db, 'results', resId));
          } catch (err) {
            console.error('[admin] delete result error', err);
            alert('Suppression impossible.');
          }
        });

        const badge = el.querySelector('.badge');
        if (badge && badge.insertAdjacentElement) {
          badge.insertAdjacentElement('afterend', btn);
        } else {
          el.appendChild(btn);
        }
      });
    } catch(e) { console.warn('[delete result inject]', e); }

  });
}

// Timer checkbox behavior
ui.qTimerEnabled.addEventListener('change', () => {
  ui.qTimer.disabled = !ui.qTimerEnabled.checked;
});

// Save or create quiz
ui.saveQuizBtn.addEventListener('click', async () => {
  const enabled = ui.qTimerEnabled.checked;
  const minutes = Number(ui.qTimer.value || 0);
  const payload = {
    title: ui.qTitle.value.trim(),
    description: ui.qDesc.value.trim(),
    timerMinutes: enabled ? Math.max(1, minutes) : 0,
    updatedAt: serverTimestamp(),
  };
  if (!payload.title) { alert('Titre requis'); return; }

  if (currentQuizId) {
    await updateDoc(doc(db, 'quizzes', currentQuizId), payload);
  } else {
    payload.createdAt = serverTimestamp();
    const ref = await addDoc(collection(db, 'quizzes'), payload);
    currentQuizId = ref.id;
    const opt = document.createElement('option');
    opt.value = ref.id;
    opt.textContent = `${payload.title} (${payload.timerMinutes || 0} min)`;
    ui.quizSelectAdmin.appendChild(opt);
    ui.quizSelectAdmin.value = ref.id;
    await loadQuiz(ref.id);
  }
  alert('QCM enregistre.');
});

// Add question
ui.addQuestionBtn.addEventListener('click', async () => {
  if (!currentQuizId) { alert('Creez/enregistrez d\'abord un QCM.'); return; }

  const text = ui.qText.value.trim();
  const options = [ui.opt0.value, ui.opt1.value, ui.opt2.value, ui.opt3.value].map(s => s.trim());
  const correctIndex = Number(ui.correctIndex.value);
  const otherEnabled = ui.otherEnabled && ui.otherEnabled.checked;

  if (!text || options.some(o => !o) || !(correctIndex >= 0 && correctIndex < options.length)) {
    alert('Remplissez la question, les 4 reponses et l\'index correct (0-3).');
    return;
  }

  // === MODE EDITION : mettre a jour la question existante ===
  if (editingQuestionId) {
    try {
      const qDocRef = doc(db, 'quizzes', currentQuizId, 'questions', editingQuestionId);
      // on ne touche qu'au texte, aux reponses et a l'index : otherEnabled/imageUrl sont preserves
      await updateDoc(qDocRef, { text, options, correctIndex });
      const imgInputE = document.getElementById('qImage');
      const fileE = imgInputE && imgInputE.files && imgInputE.files[0];
      if (fileE) {
        try {
          const storage = getStorage(firebaseApp);
          const sRef = storageRef(storage, `question-images/${currentQuizId}/${editingQuestionId}`);
          await uploadBytes(sRef, fileE);
          const imageUrl = await getDownloadURL(sRef);
          await updateDoc(qDocRef, { imageUrl });
        } catch (e) { console.error('[IMAGE UPDATE FAILED]', e); }
      }
      cancelEditMode();
      alert('Question mise a jour.');
    } catch (e) {
      console.error('[update question]', e);
      alert('Mise a jour impossible : ' + (e && (e.code || e.message) ? (e.code || e.message) : e));
    }
    return;
  }

  const imgInput = document.getElementById('qImage');
  const file = imgInput && imgInput.files && imgInput.files[0];

  const qRef = await addDoc(collection(db, 'quizzes', currentQuizId, 'questions'), {
    text,
    options,
    correctIndex,
    otherEnabled,
    createdAt: serverTimestamp()
  });

  if (file) {
    try {
      const storage = getStorage(firebaseApp);
      const sRef = storageRef(storage, `question-images/${currentQuizId}/${qRef.id}`);
      await uploadBytes(sRef, file);
      const imageUrl = await getDownloadURL(sRef);
      await updateDoc(qRef, { imageUrl });
    } catch (e) {
      console.error('[IMAGE UPLOAD FAILED]', e);
      // Question is kept without imageUrl to avoid breaking flow
    }
  }

  ui.qText.value = '';
  ui.opt0.value = '';
  ui.opt1.value = '';
  ui.opt2.value = '';
  ui.opt3.value = '';
  ui.correctIndex.value = 0;
  if (ui.otherEnabled) ui.otherEnabled.checked = false;
  ui.opt3.disabled = false;
  if (imgInput) imgInput.value = '';
});

function renderCandidateDetail(r){
  const modal = document.getElementById('modalResults');
  const body = document.getElementById('modalBody');
  const closeBtn = document.getElementById('modalClose');
  if (!modal || !body){ return; }
  if (!r){ body.innerHTML = ''; modal.classList.add('hidden'); return; }

  const answers = r.answersDetails && Array.isArray(r.answersDetails) ? r.answersDetails : [];
  const header = `<div class="row" style="justify-content:space-between;align-items:center">
      <h2 style="margin:0">${r.candidateName || '(Inconnu)'}</h2>
      <div class="small">${r.quizTitle || ''} &nbsp; • &nbsp; Score ${r.score||0}/${r.total||0}
      ${ (r.trust && typeof r.trust.score==='number') ? (function(){ 
          var s=r.trust.score;
          var col = s>=90?'#16a34a':(s>=70?'#f59e0b':'#ef4444');
          return `<span class="badge" style="margin-left:8px;border-color:${col};color:${col}">Trust ${s}/100</span>`;
        })() : '' }
    </div>
    </div>`;
  const table = `<table class="table" style="width:100%;margin-top:12px">
    <thead><tr><th>#</th><th>Question</th><th>Réponse</th><th>Bonne</th><th>Focus perdus</th><th>Hors fenêtre (s)</th><th></th></tr></thead>
    <tbody>${
      answers.map((a,i)=>{
        const opts = a.options||[];
        let chosen;
        if (a.chosenIndex === 'other') {
          chosen = '<i>Autres :</i> ' + (a.otherText ? a.otherText : '(vide)');
        } else if (typeof a.chosenIndex === 'number') {
          chosen = opts[a.chosenIndex] ?? '(?)';
        } else {
          chosen = '(?)';
        }
        const good   = typeof a.correctIndex==='number' ? opts[a.correctIndex] : '(?)';
        const mark = (typeof a.chosenIndex==='number' && typeof a.correctIndex==='number' && a.chosenIndex===a.correctIndex) ? '✅' : '❌';
        return `<tr>
          <td>${i+1}</td>
          <td>${a.questionText || '(?)'}</td>
          <td>${chosen}</td>
          <td>${good}</td>
          <td>${(a.focusLosses||0)}</td>
          <td>${Math.round(((a.offWindowMs||0)/1000))}</td>
          <td>${mark}</td>
        </tr>`;
      }).join('')
    }</tbody></table>`;
  body.innerHTML = header + table;
  modal.classList.remove('hidden');
  if (closeBtn && !closeBtn._wired){
    closeBtn.addEventListener('click', ()=> modal.classList.add('hidden'));
    document.querySelector('.modal-backdrop')?.addEventListener('click', ()=> modal.classList.add('hidden'));
    closeBtn._wired = true;
  }
}

// === Edition d'une question : remplit le formulaire et bascule en mode "mise a jour" ===
function startEditQuestion(q){
  editingQuestionId = q.id;
  ui.qText.value = q.text || '';
  const opts = q.options || [];
  ui.opt0.value = opts[0] || '';
  ui.opt1.value = opts[1] || '';
  ui.opt2.value = opts[2] || '';
  ui.opt3.value = opts[3] || '';
  ui.opt3.disabled = false;
  if (ui.otherEnabled) ui.otherEnabled.checked = false;
  ui.correctIndex.value = (typeof q.correctIndex === 'number') ? q.correctIndex : 0;
  ui.addQuestionBtn.textContent = 'Mettre à jour la question';
  const title = document.getElementById('qFormTitle'); if (title) title.textContent = '✏️ Modifier la question';
  const cancel = document.getElementById('cancelEditBtn'); if (cancel) cancel.style.display = '';
  if (ui.qText.scrollIntoView) ui.qText.scrollIntoView({ behavior: 'smooth', block: 'center' });
  ui.qText.focus();
}

// === Annule l'edition et remet le formulaire en mode "ajout" ===
function cancelEditMode(){
  editingQuestionId = null;
  ui.qText.value = '';
  ui.opt0.value = ''; ui.opt1.value = ''; ui.opt2.value = ''; ui.opt3.value = '';
  ui.opt3.disabled = false;
  if (ui.otherEnabled) ui.otherEnabled.checked = false;
  ui.correctIndex.value = 0;
  const imgInput = document.getElementById('qImage'); if (imgInput) imgInput.value = '';
  ui.addQuestionBtn.textContent = 'Ajouter';
  const title = document.getElementById('qFormTitle'); if (title) title.textContent = 'Ajouter une question';
  const cancel = document.getElementById('cancelEditBtn'); if (cancel) cancel.style.display = 'none';
}

const cancelEditBtn = document.getElementById('cancelEditBtn');
if (cancelEditBtn) cancelEditBtn.addEventListener('click', cancelEditMode);

// === Reorganisation des QCM par glisser-deposer dans la liste synthese ===
function enableQuizDragAndDrop(){
  const list = ui.quizzesSummary;
  if (!list) return;
  const rows = Array.from(list.querySelectorAll('.quizrow'));
  let dragSrc = null;

  const saveOrder = async () => {
    const ids = Array.from(list.querySelectorAll('.quizrow')).map(el => el.getAttribute('data-id'));
    try {
      const batch = writeBatch(db);
      ids.forEach((qid, k) => batch.update(doc(db, 'quizzes', qid), { orderIndex: k }));
      await batch.commit(); // une seule ecriture -> l'affichage se rafraichit via onSnapshot
    } catch (e) {
      console.error('[reorder quizzes]', e);
      alert('Reorganisation impossible : ' + (e && (e.code || e.message) ? (e.code || e.message) : e));
    }
  };

  rows.forEach(row => {
    row.addEventListener('dragstart', (e) => {
      dragSrc = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', async () => {
      row.classList.remove('dragging');
      await saveOrder();
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (row === dragSrc) return;
      const rect = row.getBoundingClientRect();
      const before = (e.clientY - rect.top) < (rect.height / 2);
      list.insertBefore(dragSrc, before ? row : row.nextSibling);
    });
  });
}

// Boot
bootData();

function enableDragAndDropAutoSave(){
  const list = ui.questionsList;
  const rows = Array.from(list.querySelectorAll('.qrow'));
  let dragSrc = null;

  const saveOrder = async () => {
    if (!currentQuizId) return;
    const order = Array.from(list.querySelectorAll('.qrow')).map((el, idx) => ({ id: el.getAttribute('data-id'), idx }));
    for (const o of order){
      try{ await updateDoc(doc(db, 'quizzes', currentQuizId, 'questions', o.id), { orderIndex: o.idx }); }
      catch(e){ console.error('orderIndex update failed', o.id, e); }
    }
  };

  rows.forEach(row => {
    row.addEventListener('dragstart', (e)=>{
      dragSrc = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', async ()=>{
      row.classList.remove('dragging');
      await saveOrder();
    });
    row.addEventListener('dragover', (e)=>{
      e.preventDefault();
      const target = row;
      if (target === dragSrc) return;
      const rect = target.getBoundingClientRect();
      const before = (e.clientY - rect.top) < (rect.height / 2);
      list.insertBefore(dragSrc, before ? target : target.nextSibling);
    });
  });
}

