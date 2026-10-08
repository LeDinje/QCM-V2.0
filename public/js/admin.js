/**
 * Espace admin v2
 * - Questionnaires : création, paramètres, visibilité, duplication, lien direct, réordonnancement.
 * - Questions : éditeur en fenêtre, bonne réponse cochée (stockée à part dans answerKeys, invisible des candidats).
 * - Résultats : tableau filtrable, indicateurs, export CSV, analyse par question, détail candidat.
 * Tout est en temps réel (onSnapshot).
 */
import { auth, db, collection, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy,
         serverTimestamp, writeBatch, deleteField, onAuthStateChanged, adminLogin, adminLogout, uploadImage } from "./common.js";
import { esc, icon, initPage, toast, confirmDialog, fmtDuration, toDate, levelClass } from "./ui.js";

initPage();

const $ = (id) => document.getElementById(id);
const LETTERS = "ABCD";

// ---------- État ----------
let quizzes = [];              // [{ id, title, description, timerMinutes, active, orderIndex }]
const questionsByQuiz = {};    // quizId -> [{ id, text, options, otherEnabled, imageUrl, orderIndex, legacyCorrect }]
const keysByQuiz = {};         // quizId -> { questionId: indexBonneRéponse }
let results = [];              // [{ id, ...data }]
let currentQuizId = null;
const unsubs = [];             // écoutes globales
const questionUnsubs = {};     // quizId -> écoute des questions
let booted = false;

// ---------- Connexion ----------
const AUTH_ERRORS = {
  "auth/invalid-credential": "E-mail ou mot de passe incorrect.",
  "auth/wrong-password": "E-mail ou mot de passe incorrect.",
  "auth/user-not-found": "E-mail ou mot de passe incorrect.",
  "auth/invalid-email": "Adresse e-mail invalide.",
  "auth/too-many-requests": "Trop de tentatives. Réessayez dans quelques minutes.",
  "auth/network-request-failed": "Problème de connexion réseau.",
};

function showView(name) {
  ["auth", "loading", "quizzes", "results"].forEach((v) => $("view-" + v).classList.toggle("hidden", v !== name));
  const inApp = name === "quizzes" || name === "results";
  $("tabs").classList.toggle("hidden", !inApp);
  $("logoutBtn").classList.toggle("hidden", !inApp);
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", t.dataset.view === name ? "true" : "false"));
  if (inApp) history.replaceState(null, "", name === "results" ? "#resultats" : "#");
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("email").value.trim(), password = $("password").value;
  $("authError").textContent = "";
  if (!email || !password) { $("authError").textContent = "Renseignez votre e-mail et votre mot de passe."; return; }
  $("loginBtn").disabled = true;
  try { await adminLogin(email, password); }
  catch (err) { $("authError").textContent = AUTH_ERRORS[err && err.code] || "Connexion impossible (" + ((err && err.code) || err) + ")."; }
  finally { $("loginBtn").disabled = false; }
});
$("logoutBtn").addEventListener("click", () => adminLogout());

onAuthStateChanged(auth, async (user) => {
  if (!user || user.isAnonymous) { teardown(); $("whoami").textContent = ""; showView("auth"); return; }
  showView("loading");
  let ok = false;
  try { ok = (await getDoc(doc(db, "admins", user.uid))).exists(); } catch (e) { console.warn("[isAdmin]", e); }
  if (!ok) {
    await adminLogout();
    showView("auth");
    $("authError").textContent = "Ce compte n'a pas les droits administrateur.";
    return;
  }
  $("whoami").textContent = user.email || "";
  boot();
  showView(location.hash === "#resultats" ? "results" : "quizzes");
});

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  showView(t.dataset.view);
  if (t.dataset.view === "results") renderResults();
}));

function teardown() {
  unsubs.splice(0).forEach((u) => u());
  Object.keys(questionUnsubs).forEach((k) => { questionUnsubs[k](); delete questionUnsubs[k]; });
  booted = false;
}

// ---------- Abonnements temps réel ----------
function boot() {
  if (booted) return;
  booted = true;

  unsubs.push(onSnapshot(collection(db, "quizzes"), (snap) => {
    quizzes = snap.docs.map((d) => {
      const q = d.data() || {};
      return { id: d.id, title: q.title || "(Sans titre)", description: q.description || "", timerMinutes: Number(q.timerMinutes || 0),
               active: q.active !== false, orderIndex: typeof q.orderIndex === "number" ? q.orderIndex : 1e9 };
    });
    quizzes.sort((a, b) => a.orderIndex - b.orderIndex || a.title.localeCompare(b.title));
    // une écoute de questions par QCM (compteurs, analyse, détection des anciennes questions)
    quizzes.forEach((q) => { if (!questionUnsubs[q.id]) questionUnsubs[q.id] = watchQuestions(q.id); });
    Object.keys(questionUnsubs).forEach((id) => {
      if (!quizzes.some((q) => q.id === id)) { questionUnsubs[id](); delete questionUnsubs[id]; delete questionsByQuiz[id]; }
    });
    if (!currentQuizId || !quizzes.some((q) => q.id === currentQuizId)) selectQuiz(quizzes[0] ? quizzes[0].id : null);
    renderSidebar();
    renderResultsFilter();
    renderResults();
  }, onListenError));

  unsubs.push(onSnapshot(collection(db, "answerKeys"), (snap) => {
    snap.docs.forEach((d) => { keysByQuiz[d.id] = (d.data() || {}).keys || {}; });
    Object.keys(keysByQuiz).forEach((id) => { if (!snap.docs.some((d) => d.id === id)) delete keysByQuiz[id]; });
    renderQuestions();
    renderResults();
  }, onListenError));

  unsubs.push(onSnapshot(query(collection(db, "results"), orderBy("createdAt", "desc")), (snap) => {
    results = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    renderSidebar();
    renderResults();
  }, onListenError));
}

function onListenError(e) {
  console.error("[snapshot]", e);
  toast("Lecture des données impossible : " + (e.code || e.message), "error");
}

function watchQuestions(quizId) {
  return onSnapshot(collection(db, "quizzes", quizId, "questions"), (snap) => {
    const arr = snap.docs.map((d) => {
      const q = d.data() || {};
      const created = q.createdAt && typeof q.createdAt.seconds === "number" ? q.createdAt.seconds : (typeof q.createdAt === "number" ? q.createdAt / 1000 : 0);
      return { id: d.id, text: q.text || q.title || "(Sans intitulé)", options: q.options || q.answers || [], otherEnabled: !!q.otherEnabled,
               imageUrl: q.imageUrl || null, orderIndex: typeof q.orderIndex === "number" ? q.orderIndex : 1e9, created,
               legacyCorrect: typeof q.correctIndex === "number" ? q.correctIndex : null };
    });
    arr.sort((a, b) => a.orderIndex - b.orderIndex || a.created - b.created || (a.id > b.id ? 1 : -1));
    questionsByQuiz[quizId] = arr;
    renderSidebar();
    renderBanner();
    if (quizId === currentQuizId) renderQuestions();
    renderResults();
  }, onListenError);
}

/** Bonne réponse d'une question : clé sécurisée en priorité, sinon ancien champ public (avant migration). */
function correctOf(quizId, questionId) {
  const k = keysByQuiz[quizId] && keysByQuiz[quizId][questionId];
  if (typeof k === "number") return k;
  const q = (questionsByQuiz[quizId] || []).find((x) => x.id === questionId);
  return q && typeof q.legacyCorrect === "number" ? q.legacyCorrect : null;
}

// ---------- Bandeau de sécurité (migration des anciennes questions) ----------
function legacyQuestions() {
  const out = [];
  Object.keys(questionsByQuiz).forEach((qid) => questionsByQuiz[qid].forEach((q) => { if (q.legacyCorrect !== null) out.push({ quizId: qid, q }); }));
  return out;
}
function renderBanner() {
  const legacy = legacyQuestions();
  $("securityBanner").classList.toggle("hidden", !legacy.length);
  $("securityText").textContent = legacy.length + " question" + (legacy.length > 1 ? "s stockent" : " stocke") +
    " encore la bonne réponse dans un champ lisible par n'importe quel candidat. Un clic suffit pour la déplacer dans un espace réservé aux administrateurs.";
}
$("migrateBtn").addEventListener("click", async () => {
  const legacy = legacyQuestions();
  if (!legacy.length) return;
  const ok = await confirmDialog({
    title: "Sécuriser les bonnes réponses ?",
    message: "Les bonnes réponses seront retirées des questions et rangées dans un espace réservé aux administrateurs.<br><br>" +
             "<b>À ne faire qu'une fois la v2 en production</b> : l'ancienne version du site, si elle est encore en ligne, ne pourra plus noter ces questions.",
    confirmText: "Sécuriser",
  });
  if (!ok) return;
  $("migrateBtn").disabled = true;
  try {
    for (let i = 0; i < legacy.length; i += 200) {           // lots de 200 (limite Firestore : 500 opérations)
      const batch = writeBatch(db);
      const keys = {};
      legacy.slice(i, i + 200).forEach(({ quizId, q }) => {
        (keys[quizId] = keys[quizId] || {})[q.id] = q.legacyCorrect;
        batch.update(doc(db, "quizzes", quizId, "questions", q.id), { correctIndex: deleteField() });
      });
      Object.keys(keys).forEach((quizId) => batch.set(doc(db, "answerKeys", quizId), { keys: keys[quizId] }, { merge: true }));
      await batch.commit();
    }
    toast("Bonnes réponses sécurisées.", "success");
  } catch (e) {
    console.error("[migrate]", e);
    toast("Migration impossible : " + (e.code || e.message) + ". Les règles Firestore v2 sont-elles déployées ?", "error");
  } finally { $("migrateBtn").disabled = false; }
});

// ---------- Barre latérale : liste des QCM ----------
function resultCount(quizId) { return results.filter((r) => r.quizId === quizId).length; }
function renderSidebar() {
  const nav = $("quizNav");
  if (!quizzes.length) { nav.innerHTML = '<div class="empty">' + icon("clipboard") + "<div>Aucun questionnaire.</div></div>"; return; }
  nav.innerHTML = quizzes.map((q) => {
    const nq = (questionsByQuiz[q.id] || []).length, nr = resultCount(q.id);
    return '<div role="button" tabindex="0" class="quiz-nav-item' + (q.id === currentQuizId ? " active" : "") + '" data-id="' + esc(q.id) + '" draggable="true">' +
      '<span class="status-dot' + (q.active ? "" : " off") + '" title="' + (q.active ? "Visible par les candidats" : "Masqué aux candidats") + '"></span>' +
      '<span class="grow"><span class="qn-title" style="display:block">' + esc(q.title) + "</span>" +
      '<span class="qn-meta">' + nq + " question" + (nq > 1 ? "s" : "") + " · " + nr + " résultat" + (nr > 1 ? "s" : "") + (q.timerMinutes ? " · " + q.timerMinutes + " min" : "") + "</span></span>" +
      "</div>";
  }).join("");
  enableDragSort(nav, ".quiz-nav-item", async (ids) => {
    const batch = writeBatch(db);
    ids.forEach((id, k) => batch.update(doc(db, "quizzes", id), { orderIndex: k }));
    await batch.commit();
  });
}
$("quizNav").addEventListener("click", (e) => {
  const item = e.target.closest(".quiz-nav-item");
  if (item) selectQuiz(item.dataset.id);
});
$("quizNav").addEventListener("keydown", (e) => {
  const item = e.target.closest(".quiz-nav-item");
  if (item && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); selectQuiz(item.dataset.id); }
});

// ---------- Éditeur de QCM ----------
function currentQuiz() { return quizzes.find((q) => q.id === currentQuizId) || null; }

function selectQuiz(id) {
  currentQuizId = id;
  $("editor").classList.toggle("hidden", !id);
  const q = currentQuiz();
  if (q) {
    $("qTitle").value = q.title;
    $("qDesc").value = q.description;
    $("qTimerEnabled").checked = q.timerMinutes > 0;
    $("qTimer").value = q.timerMinutes > 0 ? q.timerMinutes : 15;
    $("qTimer").disabled = !(q.timerMinutes > 0);
    $("qActive").checked = q.active;
    $("editorTitle").textContent = q.title;
    $("editorMeta").textContent = q.active ? "Visible par les candidats" : "Masqué aux candidats";
  }
  renderSidebar();
  renderQuestions();
}

$("qTimerEnabled").addEventListener("change", () => { $("qTimer").disabled = !$("qTimerEnabled").checked; });

$("quizForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentQuizId) return;
  const title = $("qTitle").value.trim();
  if (!title) { toast("Le titre est obligatoire.", "error"); $("qTitle").focus(); return; }
  const minutes = Math.max(1, Math.min(600, Number($("qTimer").value) || 0));
  try {
    await updateDoc(doc(db, "quizzes", currentQuizId), {
      title, description: $("qDesc").value.trim(),
      timerMinutes: $("qTimerEnabled").checked ? minutes : 0,
      active: $("qActive").checked, updatedAt: serverTimestamp(),
    });
    $("editorTitle").textContent = title;
    $("editorMeta").textContent = $("qActive").checked ? "Visible par les candidats" : "Masqué aux candidats";
    toast("Questionnaire enregistré.", "success");
  } catch (err) { console.error(err); toast("Enregistrement impossible : " + (err.code || err.message), "error"); }
});

$("newQuizBtn").addEventListener("click", async () => {
  const taken = new Set(quizzes.map((q) => q.title));
  let title = "Nouveau questionnaire", n = 2;
  while (taken.has(title)) title = "Nouveau questionnaire (" + n++ + ")";
  try {
    const ref = await addDoc(collection(db, "quizzes"), {
      title, description: "", timerMinutes: 0, active: false, orderIndex: quizzes.length,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    currentQuizId = ref.id;
    // la sélection effective se fait quand le snapshot arrive
    setTimeout(() => { selectQuiz(ref.id); $("qTitle").select(); }, 50);
    toast("Questionnaire créé (masqué aux candidats tant que vous ne l'activez pas).", "success");
  } catch (err) { toast("Création impossible : " + (err.code || err.message), "error"); }
});

$("duplicateBtn").addEventListener("click", async () => {
  const src = currentQuiz();
  if (!src) return;
  try {
    const ref = await addDoc(collection(db, "quizzes"), {
      title: src.title + " (copie)", description: src.description, timerMinutes: src.timerMinutes, active: false,
      orderIndex: quizzes.length, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    const batch = writeBatch(db);
    const keys = {};
    (questionsByQuiz[src.id] || []).forEach((q, i) => {
      const nref = doc(collection(db, "quizzes", ref.id, "questions"));
      const data = { text: q.text, options: q.options, otherEnabled: q.otherEnabled, orderIndex: i, createdAt: serverTimestamp() };
      if (q.imageUrl) data.imageUrl = q.imageUrl;
      batch.set(nref, data);
      const k = correctOf(src.id, q.id);
      if (typeof k === "number") keys[nref.id] = k;
    });
    batch.set(doc(db, "answerKeys", ref.id), { keys });
    await batch.commit();
    setTimeout(() => selectQuiz(ref.id), 50);
    toast("Questionnaire dupliqué.", "success");
  } catch (err) { console.error(err); toast("Duplication impossible : " + (err.code || err.message), "error"); }
});

$("deleteQuizBtn").addEventListener("click", async () => {
  const q = currentQuiz();
  if (!q) return;
  const nr = resultCount(q.id);
  const ok = await confirmDialog({
    title: "Supprimer ce questionnaire ?",
    message: "« " + esc(q.title) + " » et ses " + (questionsByQuiz[q.id] || []).length + " questions seront supprimés définitivement." +
             (nr ? "<br><br>Les " + nr + " résultats déjà enregistrés sont conservés." : ""),
    confirmText: "Supprimer", danger: true,
  });
  if (!ok) return;
  try {
    const batch = writeBatch(db);
    (questionsByQuiz[q.id] || []).forEach((x) => batch.delete(doc(db, "quizzes", q.id, "questions", x.id)));
    batch.delete(doc(db, "answerKeys", q.id));
    batch.delete(doc(db, "quizzes", q.id));
    await batch.commit();
    currentQuizId = null;
    toast("Questionnaire supprimé.", "success");
  } catch (err) { toast("Suppression impossible : " + (err.code || err.message), "error"); }
});

$("copyLinkBtn").addEventListener("click", async () => {
  if (!currentQuizId) return;
  const url = new URL("candidate.html?quiz=" + encodeURIComponent(currentQuizId), location.href).href;
  try { await navigator.clipboard.writeText(url); toast("Lien copié : à envoyer au candidat.", "success"); }
  catch (e) { await confirmDialog({ title: "Lien candidat", message: '<input class="input" readonly value="' + esc(url) + '" onclick="this.select()">', confirmText: "Fermer", cancelText: null }); }
});

// ---------- Questions ----------
function renderQuestions() {
  const list = $("questionsList");
  const qs = questionsByQuiz[currentQuizId] || [];
  $("qCount").textContent = qs.length;
  if (!currentQuizId) { list.innerHTML = ""; return; }
  if (!qs.length) {
    list.innerHTML = '<div class="empty">' + icon("list") + "<div>Aucune question pour l'instant.</div>" +
      '<div class="small" style="margin-top:4px">Cliquez sur « Ajouter une question » pour commencer.</div></div>';
    return;
  }
  list.innerHTML = qs.map((q, i) => {
    const k = correctOf(currentQuizId, q.id);
    const chips = q.options.map((o, j) => {
      const other = q.otherEnabled && j === q.options.length - 1;
      return '<span class="chip' + (j === k ? " correct" : "") + '">' + LETTERS[j] + ". " + esc(other ? "Autre réponse (libre)" : o) + "</span>";
    }).join("") + (typeof k !== "number" ? '<span class="chip missing">Bonne réponse non définie</span>' : "");
    return '<div class="list-row q-row" data-id="' + esc(q.id) + '" draggable="true">' +
      '<span class="drag-handle" title="Glisser pour réordonner">' + icon("grip") + "</span>" +
      '<span class="q-row-num">' + (i + 1) + "</span>" +
      '<div class="grow"><div class="title">' + esc(q.text) + (q.imageUrl ? ' <span class="badge" style="margin-left:4px">' + icon("image", "icon-sm") + " image</span>" : "") +
      (q.legacyCorrect !== null ? ' <span class="badge badge-warn" title="Bonne réponse encore visible par les candidats">' + icon("alert", "icon-sm") + " non sécurisée</span>" : "") +
      '</div><div class="chips">' + chips + "</div></div>" +
      '<div class="actions">' +
        '<button class="btn btn-ghost btn-icon btn-sm" type="button" data-edit="' + esc(q.id) + '" title="Modifier" aria-label="Modifier">' + icon("pencil", "icon-sm") + "</button>" +
        '<button class="btn btn-ghost btn-icon btn-sm btn-danger" type="button" data-del="' + esc(q.id) + '" title="Supprimer" aria-label="Supprimer">' + icon("trash", "icon-sm") + "</button>" +
      "</div></div>";
  }).join("");
  enableDragSort(list, ".q-row", async (ids) => {
    const batch = writeBatch(db);
    ids.forEach((id, k) => batch.update(doc(db, "quizzes", currentQuizId, "questions", id), { orderIndex: k }));
    await batch.commit();
  });
}

$("questionsList").addEventListener("click", async (e) => {
  const ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
  const qs = questionsByQuiz[currentQuizId] || [];
  if (ed) openQuestionDialog(qs.find((q) => q.id === ed.dataset.edit));
  if (del) {
    const q = qs.find((x) => x.id === del.dataset.del);
    if (!q) return;
    const ok = await confirmDialog({ title: "Supprimer cette question ?", message: "« " + esc(q.text) + " »", confirmText: "Supprimer", danger: true });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "quizzes", currentQuizId, "questions", q.id));
      if (keysByQuiz[currentQuizId] && q.id in keysByQuiz[currentQuizId]) {
        await updateDoc(doc(db, "answerKeys", currentQuizId), { ["keys." + q.id]: deleteField() });
      }
      toast("Question supprimée.", "success");
    } catch (err) { toast("Suppression impossible : " + (err.code || err.message), "error"); }
  }
});

// Fenêtre d'édition d'une question
let editing = null;       // question en cours d'édition (null = ajout)
let removeImage = false;
const qDialog = $("questionDialog");

function renderAnswerInputs(options, correct) {
  $("answerInputs").innerHTML = [0, 1, 2, 3].map((i) =>
    '<div class="answer-edit">' +
      '<input type="radio" name="correct" value="' + i + '"' + (i === correct ? " checked" : "") + ' aria-label="Bonne réponse : ' + LETTERS[i] + '">' +
      '<span class="key">' + LETTERS[i] + "</span>" +
      '<input class="input" id="opt' + i + '" maxlength="500" placeholder="Réponse ' + LETTERS[i] + '" value="' + esc(options[i] || "") + '">' +
    "</div>").join("");
}
function applyOtherToggle() {
  const on = $("otherEnabled").checked;
  const input = $("opt3"), radio = $("answerInputs").querySelector('input[value="3"]');
  input.disabled = on;
  radio.disabled = on;
  if (on) { input.value = "Autres"; if (radio.checked) $("answerInputs").querySelector('input[value="0"]').checked = true; }
  else if (input.value === "Autres") input.value = "";
}
$("otherEnabled").addEventListener("change", applyOtherToggle);

function openQuestionDialog(q) {
  if (!currentQuizId) return;
  editing = q || null;
  removeImage = false;
  $("questionDialogTitle").textContent = q ? "Modifier la question" : "Nouvelle question";
  $("qText").value = q ? q.text : "";
  const correct = q ? correctOf(currentQuizId, q.id) : null;
  renderAnswerInputs(q ? q.options : [], typeof correct === "number" ? correct : -1);
  $("otherEnabled").checked = !!(q && q.otherEnabled);
  applyOtherToggle();
  $("qImage").value = "";
  setPreview(q && q.imageUrl);
  $("questionError").textContent = "";
  qDialog.showModal();
  $("qText").focus();
}
function setPreview(url) {
  $("imgPreview").classList.toggle("hidden", !url);
  if (url) $("imgPreviewImg").src = url;
}
$("addQuestionBtn").addEventListener("click", () => openQuestionDialog(null));
$("qImage").addEventListener("change", () => {
  const f = $("qImage").files[0];
  if (f) { removeImage = false; setPreview(URL.createObjectURL(f)); }
});
$("imgRemoveBtn").addEventListener("click", () => { $("qImage").value = ""; removeImage = true; setPreview(null); });

$("questionForm").setAttribute("novalidate", "");
$("questionForm").addEventListener("submit", async (e) => {
  if (!e.submitter || e.submitter.value !== "save") return;   // « Annuler » ferme simplement la fenêtre
  e.preventDefault();
  const text = $("qText").value.trim();
  const options = [0, 1, 2, 3].map((i) => $("opt" + i).value.trim());
  const picked = $("answerInputs").querySelector('input[name="correct"]:checked');
  const otherEnabled = $("otherEnabled").checked;
  const err = !text ? "Saisissez l'intitulé de la question."
            : options.some((o) => !o) ? "Renseignez les 4 réponses."
            : !picked ? "Cochez la bonne réponse." : "";
  if (err) { $("questionError").textContent = err; return; }
  const correct = Number(picked.value);
  const quizId = currentQuizId;
  $("saveQuestionBtn").disabled = true;
  try {
    let qid;
    if (editing) {
      qid = editing.id;
      const data = { text, options, otherEnabled, correctIndex: deleteField() };   // supprime aussi l'ancien champ public
      if (removeImage) data.imageUrl = deleteField();
      await updateDoc(doc(db, "quizzes", quizId, "questions", qid), data);
    } else {
      const qs = questionsByQuiz[quizId] || [];
      const ref = await addDoc(collection(db, "quizzes", quizId, "questions"), {
        text, options, otherEnabled, orderIndex: qs.length ? Math.max(...qs.map((x) => (x.orderIndex < 1e9 ? x.orderIndex : 0))) + 1 : 0,
        createdAt: serverTimestamp(),
      });
      qid = ref.id;
    }
    await setDoc(doc(db, "answerKeys", quizId), { keys: { [qid]: correct } }, { merge: true });
    const file = $("qImage").files[0];
    if (file) {
      try {
        const url = await uploadImage("question-images/" + quizId + "/" + qid, file);
        await updateDoc(doc(db, "quizzes", quizId, "questions", qid), { imageUrl: url });
      } catch (e2) { console.error("[image]", e2); toast("Question enregistrée, mais l'envoi de l'image a échoué.", "error"); }
    }
    qDialog.close();
    toast(editing ? "Question mise à jour." : "Question ajoutée.", "success");
  } catch (e3) {
    console.error("[saveQuestion]", e3);
    $("questionError").textContent = "Enregistrement impossible : " + (e3.code || e3.message);
  } finally { $("saveQuestionBtn").disabled = false; }
});

// ---------- Glisser-déposer générique ----------
function enableDragSort(container, selector, onSave) {
  let src = null;
  container.querySelectorAll(selector).forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      if (e.target.closest && e.target.closest("button, input, a")) { e.preventDefault(); return; }
      src = row; row.classList.add("dragging"); e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", async () => {
      row.classList.remove("dragging");
      if (!src) return;
      src = null;
      const ids = Array.from(container.querySelectorAll(selector)).map((el) => el.dataset.id);
      try { await onSave(ids); } catch (e) { toast("Réorganisation impossible : " + (e.code || e.message), "error"); }
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!src || row === src) return;
      const r = row.getBoundingClientRect();
      container.insertBefore(src, e.clientY - r.top < r.height / 2 ? row : row.nextSibling);
    });
  });
}

// ---------- Résultats ----------
/** Score d'un résultat : calculé à partir des clés pour la v2, valeur enregistrée pour les anciens résultats. */
function scoreOf(r) {
  if (r.v === 2) {
    let ok = 0;
    (r.answers || []).forEach((a) => { const k = correctOf(r.quizId, a.questionId); if (typeof k === "number" && a.chosenIndex === k) ok++; });
    return { score: ok, total: r.total || (r.answers || []).length };
  }
  return { score: Number(r.score || 0), total: Number(r.total || 0) };
}
function pct(sc) { return sc.total ? Math.round((sc.score / sc.total) * 100) : 0; }
function trustBadge(r) {
  const t = r.trust && typeof r.trust.score === "number" ? r.trust.score : null;
  if (t === null) return '<span class="badge">—</span>';
  const cls = t >= 90 ? "badge-success" : t >= 70 ? "badge-warn" : "badge-danger";
  const lost = (r.trust && r.trust.lostCount) || 0;
  return '<span class="badge ' + cls + '" title="' + lost + " sortie(s) de fenêtre" + '"><span class="dot"></span>' + t + "/100</span>";
}
function fmtDate(r) {
  const d = toDate(r.createdAt);
  return d ? d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) + " · " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—";
}

function renderResultsFilter() {
  const sel = $("resultsQuiz");
  const cur = sel.value;
  sel.innerHTML = '<option value="">Tous les questionnaires</option>' + quizzes.map((q) => '<option value="' + esc(q.id) + '">' + esc(q.title) + "</option>").join("");
  if (cur && quizzes.some((q) => q.id === cur)) sel.value = cur;
}
$("resultsQuiz").addEventListener("change", renderResults);
$("resultsSearch").addEventListener("input", renderResults);

function filteredResults() {
  const qz = $("resultsQuiz").value;
  const term = $("resultsSearch").value.trim().toLowerCase();
  return results.filter((r) => (!qz || r.quizId === qz) && (!term || String(r.candidateName || "").toLowerCase().includes(term)));
}

function renderResults() {
  if ($("view-results").classList.contains("hidden")) return;
  const rows = filteredResults();
  // Indicateurs
  const scores = rows.map((r) => pct(scoreOf(r)));
  const trusts = rows.map((r) => r.trust && r.trust.score).filter((x) => typeof x === "number");
  const durations = rows.map((r) => r.durationMs).filter((x) => x > 0);
  const avg = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
  const kpi = (label, value) => '<div class="kpi"><div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + "</div></div>";
  $("kpis").innerHTML = kpi("Candidats", rows.length) +
    kpi("Score moyen", avg(scores) === null ? "—" : avg(scores) + " %") +
    kpi("Confiance moyenne", avg(trusts) === null ? "—" : avg(trusts) + "/100") +
    kpi("Durée moyenne", durations.length ? fmtDuration(avg(durations)) : "—");

  // Tableau
  $("resultsBody").innerHTML = rows.length ? rows.map((r) => {
    const sc = scoreOf(r), p = pct(sc);
    return '<tr class="clickable" data-open="' + esc(r.id) + '">' +
      "<td><b>" + esc(r.candidateName || "(Inconnu)") + "</b>" + (r.trust && r.trust.reloads ? ' <span class="badge badge-warn" title="Page rechargée pendant le test">' + r.trust.reloads + " recharg.</span>" : "") + "</td>" +
      '<td class="muted">' + esc(r.quizTitle || "") + "</td>" +
      '<td class="muted" style="white-space:nowrap">' + fmtDate(r) + "</td>" +
      '<td><div class="meter"><div class="meter-track"><div class="meter-fill ' + levelClass(p) + '" style="width:' + p + '%"></div></div>' +
        '<span class="meter-label">' + sc.score + "/" + sc.total + "</span></div></td>" +
      '<td class="num muted">' + fmtDuration(r.durationMs) + "</td>" +
      "<td>" + trustBadge(r) + "</td>" +
      '<td class="num" style="white-space:nowrap">' +
        '<button class="btn btn-ghost btn-icon btn-sm" type="button" data-open="' + esc(r.id) + '" title="Voir le détail" aria-label="Voir le détail">' + icon("eye", "icon-sm") + "</button>" +
        '<button class="btn btn-ghost btn-icon btn-sm btn-danger" type="button" data-delres="' + esc(r.id) + '" title="Supprimer" aria-label="Supprimer">' + icon("trash", "icon-sm") + "</button></td>" +
      "</tr>";
  }).join("") : '<tr><td colspan="7"><div class="empty" style="border:none">' + icon("chart") + "<div>Aucun résultat pour cette sélection.</div></div></td></tr>";

  renderStats(rows);
}

$("resultsBody").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-delres]");
  if (del) {
    e.stopPropagation();
    const r = results.find((x) => x.id === del.dataset.delres);
    const ok = await confirmDialog({ title: "Supprimer ce résultat ?", message: "Le résultat de <b>" + esc(r && r.candidateName) + "</b> sera supprimé définitivement.", confirmText: "Supprimer", danger: true });
    if (!ok) return;
    try { await deleteDoc(doc(db, "results", del.dataset.delres)); toast("Résultat supprimé.", "success"); }
    catch (err) { toast("Suppression impossible : " + (err.code || err.message), "error"); }
    return;
  }
  const open = e.target.closest("[data-open]");
  if (open) openDetail(results.find((x) => x.id === open.dataset.open));
});

// Analyse par question (uniquement quand un QCM est sélectionné)
function renderStats(rows) {
  const qz = $("resultsQuiz").value;
  const qs = questionsByQuiz[qz] || [];
  const card = $("statsCard");
  if (!qz || !rows.length || !qs.length) { card.classList.add("hidden"); return; }
  const st = {};
  rows.forEach((r) => {
    if (r.v === 2) {
      (r.answers || []).forEach((a) => {
        const k = correctOf(r.quizId, a.questionId);
        if (typeof k !== "number") return;
        const x = st[a.questionId] || (st[a.questionId] = { n: 0, ok: 0, t: 0 });
        x.n++; if (a.chosenIndex === k) x.ok++; x.t += a.timeMs || 0;
      });
    } else {
      (r.answersDetails || []).forEach((a) => {
        if (!a.questionId) return;
        const x = st[a.questionId] || (st[a.questionId] = { n: 0, ok: 0, t: 0 });
        x.n++; if (a.chosenIndex === a.correctIndex) x.ok++;
      });
    }
  });
  card.classList.remove("hidden");
  $("statsBody").innerHTML = qs.map((q, i) => {
    const x = st[q.id];
    const p = x && x.n ? Math.round((x.ok / x.n) * 100) : null;
    return '<div class="stat-row"><span class="q-row-num">' + (i + 1) + "</span>" +
      '<div style="min-width:0"><div style="overflow-wrap:anywhere">' + esc(q.text) + "</div>" +
      '<div class="small">' + (x ? x.ok + " / " + x.n + " bonnes réponses" + (x.t ? " · " + fmtDuration(x.t / x.n) + " en moyenne" : "") : "Pas encore de réponse") + "</div></div>" +
      (p === null ? '<span class="small">—</span>' :
        '<div class="meter"><div class="meter-track"><div class="meter-fill ' + levelClass(p) + '" style="width:' + p + '%"></div></div><span class="meter-label">' + p + " %</span></div>") +
      "</div>";
  }).join("");
}

// Export CSV (séparateur « ; » et BOM pour une ouverture directe dans Excel)
$("exportBtn").addEventListener("click", () => {
  const rows = filteredResults();
  if (!rows.length) { toast("Rien à exporter.", "error"); return; }
  const cell = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const lines = [["Candidat", "Questionnaire", "Date", "Score", "Total", "Pourcentage", "Durée (s)", "Confiance /100", "Sorties de fenêtre", "Rechargements", "Fin"].map(cell).join(";")];
  rows.forEach((r) => {
    const sc = scoreOf(r), d = toDate(r.createdAt);
    lines.push([r.candidateName, r.quizTitle, d ? d.toLocaleString("fr-FR") : "", sc.score, sc.total, pct(sc),
      r.durationMs ? Math.round(r.durationMs / 1000) : "", r.trust ? r.trust.score : "", r.trust ? r.trust.lostCount : "",
      r.trust ? r.trust.reloads || 0 : "", r.endedBy === "timer" ? "Temps écoulé" : "Envoyé"].map(cell).join(";"));
  });
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "resultats-qcm-" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

// ---------- Détail d'un candidat ----------
const dDialog = $("detailDialog");
$("detailClose").addEventListener("click", () => dDialog.close());
dDialog.addEventListener("click", (e) => { if (e.target === dDialog) dDialog.close(); });

function openDetail(r) {
  if (!r) return;
  const sc = scoreOf(r), p = pct(sc);
  $("detailHead").innerHTML =
    '<span class="eyebrow">' + esc(r.quizTitle || "") + " · " + fmtDate(r) + "</span>" +
    '<h2 style="margin-top:4px">' + esc(r.candidateName || "(Inconnu)") + "</h2>" +
    '<div class="row" style="gap:8px;margin-top:12px">' +
      '<span class="badge badge-brand">Score ' + sc.score + "/" + sc.total + " · " + p + " %</span>" +
      trustBadge(r) +
      (r.durationMs ? '<span class="badge">' + icon("clock", "icon-sm") + fmtDuration(r.durationMs) + "</span>" : "") +
      (r.trust && r.trust.lostCount ? '<span class="badge">' + r.trust.lostCount + " sortie(s) de fenêtre</span>" : "") +
      (r.trust && r.trust.reloads ? '<span class="badge badge-warn">' + r.trust.reloads + " rechargement(s)</span>" : "") +
      (r.endedBy === "timer" ? '<span class="badge badge-warn">Temps écoulé</span>' : "") +
    "</div>";

  const v2 = r.v === 2;
  const list = v2 ? r.answers || [] : r.answersDetails || [];
  const label = (opts, i, otherText) =>
    i === "other" ? "<i>Autre :</i> " + esc(otherText || "(vide)") : typeof i === "number" && i >= 0 && opts[i] != null ? esc(opts[i]) : '<span class="muted">Sans réponse</span>';
  const body = list.map((a, i) => {
    const opts = a.options || [];
    const k = v2 ? correctOf(r.quizId, a.questionId) : a.correctIndex;
    const good = typeof k === "number" && a.chosenIndex === k;
    const status = a.chosenIndex === "other" ? '<span class="badge">À évaluer</span>'
                 : typeof k !== "number" ? '<span class="badge">?</span>'
                 : good ? '<span class="badge badge-success">' + icon("check", "icon-sm") + "</span>"
                 : '<span class="badge badge-danger">' + icon("x", "icon-sm") + "</span>";
    return "<tr><td class=\"muted\">" + (i + 1) + "</td>" +
      '<td style="min-width:220px">' + esc(a.questionText || "(?)") + (a.flagged ? ' <span class="badge badge-warn">' + icon("flag", "icon-sm") + "</span>" : "") + "</td>" +
      "<td>" + label(opts, a.chosenIndex, a.otherText) + "</td>" +
      "<td" + (good ? ' class="muted"' : "") + ">" + (typeof k === "number" ? esc(opts[k]) : "—") + "</td>" +
      '<td class="num muted">' + (a.timeMs ? fmtDuration(a.timeMs) : "—") + "</td>" +
      '<td class="num">' + (a.focusLosses ? '<span class="badge badge-warn">' + a.focusLosses + " · " + Math.round((a.offWindowMs || 0) / 1000) + " s</span>" : '<span class="muted">0</span>') + "</td>" +
      "<td>" + status + "</td></tr>";
  }).join("");
  $("detailBody").innerHTML = '<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Question</th><th>Réponse donnée</th><th>Bonne réponse</th><th class="num">Temps</th><th class="num">Sorties</th><th></th></tr></thead><tbody>' +
    (body || '<tr><td colspan="7" class="muted">Aucun détail enregistré.</td></tr>') + "</tbody></table></div>";
  dDialog.showModal();
}
