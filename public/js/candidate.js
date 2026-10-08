/**
 * Espace candidat v2
 * - Les bonnes réponses ne sont JAMAIS chargées côté candidat (elles sont dans answerKeys, réservé aux admins).
 *   Le score est calculé dans l'espace admin.
 * - Progression sauvegardée sur le poste : un rechargement accidentel ne fait rien perdre.
 * - Indice de confiance « Trust » silencieux (sorties de fenêtre), rechargements comptés.
 */
import { auth, db, collection, getDocs, addDoc, ensureAnonAuth, serverTimestamp } from "./common.js";
import { esc, icon, initPage, fmtDuration } from "./ui.js";

initPage();

const DEBUG_TRUST = /[?&]debug=1\b/.test(location.search);
const SESSION_KEY = "qcm.session.v2";
const LETTERS = "ABCDEFGHIJ";
const $ = (id) => document.getElementById(id);

const els = {
  name: $("candidateName"), quizList: $("quizList"), startBtn: $("startBtn"), setupError: $("setupError"),
  resumeBox: $("resumeBox"), resumeText: $("resumeText"), resumeBtn: $("resumeBtn"),
  quizBar: $("quizBar"), quizTitle: $("quizTitle"), progressText: $("progressText"), progressFill: $("progressFill"), timer: $("timer"),
  qCounter: $("qCounter"), flagBtn: $("flagBtn"), questionBox: $("questionBox"), prevBtn: $("prevBtn"), nextBtn: $("nextBtn"),
  navBox: $("navBox"), qNav: $("qNav"), navSummary: $("navSummary"),
  reviewText: $("reviewText"), reviewNav: $("reviewNav"), backToQuizBtn: $("backToQuizBtn"), submitBtn: $("submitBtn"),
  doneTitle: $("doneTitle"), doneText: $("doneText"), retryBtn: $("retryBtn"),
  prestart: $("prestart"), prestartTitle: $("prestartTitle"), prestartList: $("prestartList"),
  prestartCancel: $("prestartCancel"), prestartGo: $("prestartGo"),
};

// Nom d'exemple aléatoire (figures connues de l'informatique), change à chaque chargement
(function setRandomNamePlaceholder() {
  const famous = ["Jane Doe", "Ada Lovelace", "Alan Turing", "Grace Hopper", "Linus Torvalds", "Dennis Ritchie",
    "Ken Thompson", "Tim Berners-Lee", "Margaret Hamilton", "Donald Knuth", "Guido van Rossum", "Brian Kernighan",
    "Vint Cerf", "Edsger Dijkstra", "Claude Shannon", "Bjarne Stroustrup", "James Gosling", "Richard Stallman",
    "Steve Wozniak", "Katherine Johnson", "Radia Perlman", "Barbara Liskov", "John von Neumann", "Hedy Lamarr",
    "Anita Borg", "Larry Wall"];
  els.name.placeholder = "Ex : " + famous[Math.floor(Math.random() * famous.length)];
})();

let quizzes = [];   // QCM disponibles
let s = null;       // session de test en cours (sauvegardée dans localStorage)
let tick = null;
let qEnteredAt = 0; // pour mesurer le temps passé par question

// ---------- Utilitaires ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function show(step) {
  ["setup", "quiz", "review", "done", "error"].forEach((n) => $("step-" + n).classList.toggle("hidden", n !== step));
  els.quizBar.classList.toggle("hidden", !(step === "quiz" || step === "review"));
  window.scrollTo({ top: 0 });
}
function save() { try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }
function loadSaved() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; } }
function clearSaved() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
function isOther(q, i) { return q.options[i] === "Autres" || (q.otherEnabled && i === q.options.length - 1); }
function answeredCount() { return s.questions.filter((q) => q.id in s.chosen).length; }

// ---------- Chargement des QCM ----------
async function loadQuizzes() {
  try {
    const snap = await getDocs(collection(db, "quizzes"));
    quizzes = snap.docs.map((d) => {
      const q = d.data() || {};
      return { id: d.id, title: q.title || "Sans titre", desc: q.description || "", timer: Number(q.timerMinutes || 0),
               orderIndex: typeof q.orderIndex === "number" ? q.orderIndex : 1e9, active: q.active !== false };
    }).filter((q) => q.active);
    quizzes.sort((a, b) => a.orderIndex - b.orderIndex || a.title.localeCompare(b.title));
    renderQuizList();
  } catch (e) {
    console.error("[loadQuizzes]", e);
    els.quizList.innerHTML = '<div class="alert alert-danger">' + icon("alert") + '<div class="alert-body">Impossible de charger les questionnaires. Vérifiez votre connexion puis rechargez la page.</div></div>';
  }
}

function renderQuizList() {
  if (!quizzes.length) {
    els.quizList.innerHTML = '<div class="empty">' + icon("clipboard") + "<div>Aucun questionnaire n'est disponible pour le moment.</div></div>";
    return;
  }
  // Lien direct : candidate.html?quiz=ID présélectionne (et met en avant) un QCM
  const wanted = new URLSearchParams(location.search).get("quiz");
  els.quizList.innerHTML = quizzes.map((q) =>
    '<label class="quiz-option">' +
      '<input type="radio" name="quiz" value="' + esc(q.id) + '"' + (q.id === wanted ? " checked" : "") + ">" +
      '<span class="qo-radio"></span>' +
      '<span style="min-width:0"><span class="qo-title" style="display:block">' + esc(q.title) + "</span>" +
      (q.desc ? '<span class="qo-desc" style="display:block">' + esc(q.desc) + "</span>" : "") + "</span>" +
      (q.timer > 0 ? '<span class="badge">' + icon("clock", "icon-sm") + q.timer + " min</span>"
                   : '<span class="badge">Sans limite</span>') +
    "</label>").join("");
}

// ---------- Démarrage ----------
function startClicked() {
  const name = els.name.value.trim();
  const picked = els.quizList.querySelector('input[name="quiz"]:checked');
  els.setupError.textContent = "";
  if (!name) { els.setupError.textContent = "Indiquez votre prénom et votre nom."; els.name.focus(); return; }
  if (!picked) { els.setupError.textContent = "Choisissez un questionnaire."; return; }
  const quiz = quizzes.find((q) => q.id === picked.value);
  if (!quiz) return;

  els.prestartTitle.textContent = quiz.title;
  const li = (ic, html) => '<li class="row" style="flex-wrap:nowrap;align-items:flex-start;gap:12px">' + icon(ic) + "<span>" + html + "</span></li>";
  els.prestartList.innerHTML =
    li("clock", quiz.timer > 0 ? "Ce test est <b>chronométré : " + quiz.timer + " minute" + (quiz.timer > 1 ? "s" : "") + "</b>. À la fin du temps, vos réponses sont envoyées automatiquement."
                               : "Ce test <b>n'est pas chronométré</b>. Prenez le temps nécessaire.") +
    li("list", "Vous pouvez naviguer librement entre les questions et en marquer certaines <b>« à revoir »</b>.") +
    li("rotate", "En cas de rechargement accidentel, votre progression est conservée.") +
    li("lock", "Restez sur cette fenêtre pendant toute la durée du test.");
  els.prestart.showModal();
  els.prestartGo.onclick = () => { els.prestart.close(); beginQuiz(quiz, name); };
}

async function beginQuiz(quiz, name) {
  els.prestartGo.disabled = true;
  try {
    const snap = await getDocs(collection(db, "quizzes", quiz.id, "questions"));
    const list = snap.docs.map((d) => {
      const q = d.data() || {};
      const options = Array.isArray(q.options) ? q.options.slice() : Array.isArray(q.answers) ? q.answers.slice() : [];
      const created = q.createdAt && typeof q.createdAt.seconds === "number" ? q.createdAt.seconds : (typeof q.createdAt === "number" ? q.createdAt / 1000 : 0);
      return { id: d.id, text: q.text || q.title || q.question || "(sans intitulé)", options, otherEnabled: !!q.otherEnabled,
               imageUrl: q.imageUrl || null, orderIndex: typeof q.orderIndex === "number" ? q.orderIndex : 1e9, created };
    });
    if (!list.length) { els.setupError.textContent = "Ce questionnaire ne contient encore aucune question."; return; }
    list.sort((a, b) => a.orderIndex - b.orderIndex || a.created - b.created);
    // Ordre d'affichage des réponses mélangé (la réponse « Autres » reste en dernier)
    list.forEach((q) => {
      const idx = q.options.map((_, i) => i);
      const other = idx.filter((i) => isOther(q, i));
      q.order = shuffle(idx.filter((i) => !isOther(q, i))).concat(other);
      delete q.orderIndex; delete q.created;
    });
    s = {
      quizId: quiz.id, quizTitle: quiz.title, name, timerMinutes: quiz.timer,
      startedAt: Date.now(), endAt: quiz.timer > 0 ? Date.now() + quiz.timer * 60000 : 0,
      questions: list, idx: 0, chosen: {}, otherText: {}, flagged: {}, timeSpent: {},
      trust: { events: [], lostCount: 0, totalOutMs: 0, reloads: 0 }, focusStats: {},
    };
    save();
    enterQuiz();
  } catch (e) {
    console.error("[beginQuiz]", e);
    els.setupError.textContent = "Impossible de charger les questions. Réessayez.";
  } finally {
    els.prestartGo.disabled = false;
  }
}

function enterQuiz() {
  els.quizTitle.textContent = s.quizTitle;
  show("quiz");
  startTimer();
  trackingOn = true;
  renderQuestion();
}

// ---------- Affichage d'une question ----------
function accumulateTime() {
  if (!s || !qEnteredAt) return;
  const q = s.questions[s.idx];
  if (q) s.timeSpent[q.id] = (s.timeSpent[q.id] || 0) + (Date.now() - qEnteredAt);
  qEnteredAt = Date.now();
}

function goTo(i) {
  accumulateTime();
  s.idx = Math.max(0, Math.min(s.questions.length - 1, i));
  save();
  show("quiz");
  renderQuestion();
}

function renderQuestion() {
  const q = s.questions[s.idx];
  qEnteredAt = Date.now();
  const total = s.questions.length;
  els.qCounter.textContent = "Question " + (s.idx + 1) + " sur " + total;
  els.flagBtn.setAttribute("aria-pressed", s.flagged[q.id] ? "true" : "false");
  els.prevBtn.disabled = s.idx === 0;
  els.nextBtn.innerHTML = s.idx === total - 1 ? "Terminer " + icon("check") : "Suivant " + icon("arrow-right");

  const chosen = s.chosen[q.id];
  let html = "";
  if (q.imageUrl) {
    html += '<figure class="q-figure"><button type="button" id="qimgBtn" title="Agrandir l\'image">' +
            '<img src="' + esc(q.imageUrl) + '" alt="Illustration de la question" id="qimg"></button>' +
            "<figcaption>" + icon("zoom", "icon-sm") + " Cliquer pour agrandir</figcaption></figure>";
  }
  html += '<h2 class="q-text" id="qText">' + esc(q.text) + "</h2>";
  html += '<div class="answers" role="radiogroup" aria-labelledby="qText">';
  q.order.forEach((orig, pos) => {
    const key = LETTERS[pos] || String(pos + 1);
    if (isOther(q, orig)) {
      const on = chosen === "other";
      html += '<label class="answer answer-other"><span class="answer-head">' +
              '<input type="radio" name="ans" value="other"' + (on ? " checked" : "") + ">" +
              '<span class="answer-key">' + key + '</span><span class="answer-text">Autre réponse (texte libre)</span></span>' +
              '<textarea class="textarea other-input' + (on ? "" : " hidden") + '" placeholder="Votre réponse…" maxlength="2000">' + esc(s.otherText[q.id] || "") + "</textarea></label>";
    } else {
      html += '<label class="answer"><input type="radio" name="ans" value="' + orig + '"' + (chosen === orig ? " checked" : "") + ">" +
              '<span class="answer-key">' + key + '</span><span class="answer-text">' + esc(q.options[orig]) + "</span></label>";
    }
  });
  html += "</div>";
  els.questionBox.innerHTML = html;

  els.questionBox.querySelectorAll('input[name="ans"]').forEach((r) => r.addEventListener("change", () => pick(r.value)));
  const ta = els.questionBox.querySelector(".other-input");
  if (ta) ta.addEventListener("input", () => { s.otherText[q.id] = ta.value; save(); });
  const imgBtn = $("qimgBtn");
  if (imgBtn) imgBtn.addEventListener("click", () => openZoom(q.imageUrl));
  const img = $("qimg");
  if (img) img.addEventListener("error", () => { imgBtn.closest("figure").innerHTML = '<div class="small">Image indisponible.</div>'; });

  renderProgress();
}

function pick(value) {
  const q = s.questions[s.idx];
  s.chosen[q.id] = value === "other" ? "other" : Number(value);
  const ta = els.questionBox.querySelector(".other-input");
  if (ta) {
    ta.classList.toggle("hidden", value !== "other");
    if (value === "other") ta.focus();
  }
  save();
  renderProgress();
}

function renderProgress() {
  const total = s.questions.length;
  const done = answeredCount();
  els.progressText.textContent = done + " / " + total + " réponse" + (done > 1 ? "s" : "");
  els.progressFill.style.width = Math.round((done / total) * 100) + "%";
  els.qNav.innerHTML = navDots(true);
  const flagged = Object.keys(s.flagged).filter((k) => s.flagged[k]).length;
  els.navSummary.textContent = (total - done) + " sans réponse" + (flagged ? " · " + flagged + " à revoir" : "");
}

function navDots(markCurrent) {
  return s.questions.map((q, i) => {
    const cls = ["q-dot"];
    if (q.id in s.chosen) cls.push("answered");
    if (s.flagged[q.id]) cls.push("flagged");
    if (markCurrent && i === s.idx) cls.push("current");
    return '<button type="button" class="' + cls.join(" ") + '" data-go="' + i + '" aria-label="Question ' + (i + 1) + '">' + (i + 1) + "</button>";
  }).join("");
}

function openZoom(url) {
  const z = document.createElement("div");
  z.className = "zoom";
  z.innerHTML = '<img src="' + esc(url) + '" alt="Image agrandie">';
  z.addEventListener("click", () => z.remove());
  document.body.appendChild(z);
  const onKey = (e) => { if (e.key === "Escape") { z.remove(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
}

// ---------- Navigation ----------
function next() {
  if (s.idx === s.questions.length - 1) { openReview(); return; }
  goTo(s.idx + 1);
}
function openReview() {
  accumulateTime();
  save();
  const total = s.questions.length, done = answeredCount();
  const missing = total - done;
  els.reviewText.innerHTML = missing
    ? "Vous avez répondu à <b>" + done + " question" + (done > 1 ? "s" : "") + " sur " + total + "</b>. Cliquez sur un numéro pour y revenir. Les questions sans réponse seront comptées comme fausses."
    : "Vous avez répondu à <b>toutes les questions</b>. Vous pouvez encore revenir sur une question en cliquant sur son numéro.";
  els.reviewNav.innerHTML = navDots(false);
  show("review");
}

// ---------- Chronomètre ----------
function startTimer() {
  if (tick) clearInterval(tick);
  if (!s.endAt) { els.timer.classList.add("hidden"); return; }
  els.timer.classList.remove("hidden");
  const label = els.timer.querySelector("span");
  const paint = () => {
    const left = s.endAt - Date.now();
    if (left <= 0) { clearInterval(tick); label.textContent = "0:00"; submit("timer"); return; }
    const sec = Math.ceil(left / 1000);
    label.textContent = Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
    els.timer.classList.toggle("warn", sec <= 60);
  };
  paint();
  tick = setInterval(paint, 250);
}

// ---------- Indice de confiance (sorties de fenêtre) ----------
// Règles : sorties < 0,8 s ignorées, franchise de 2 s par sortie,
// score = 100 − 10 × sorties − 1 point par seconde hors fenêtre (borné 0–100).
let trackingOn = false, isOff = false, offStart = 0, offQid = null;
function beginOff(reason) {
  if (!trackingOn || isOff || !s) return;
  isOff = true; offStart = Date.now();
  const q = s.questions[s.idx]; offQid = q ? q.id : null;
  if (DEBUG_TRUST) console.log("[trust] beginOff", reason, offQid);
}
function endOff(reason) {
  if (!trackingOn || !isOff || !s) return;
  isOff = false;
  const dur = Date.now() - offStart;
  if (DEBUG_TRUST) console.log("[trust] endOff", reason, dur);
  if (dur <= 800) return;
  const penalized = Math.max(0, dur - 2000);
  s.trust.events.push({ t: Date.now(), ms: penalized, qid: offQid });
  s.trust.lostCount += 1;
  s.trust.totalOutMs += penalized;
  if (offQid) {
    const f = s.focusStats[offQid] || (s.focusStats[offQid] = { losses: 0, ms: 0 });
    f.losses += 1; f.ms += penalized;
  }
  save();
}
function trustScore() {
  const v = 100 - s.trust.lostCount * 10 - Math.floor(s.trust.totalOutMs / 1000);
  return Math.max(0, Math.min(100, v));
}
document.addEventListener("visibilitychange", () => (document.hidden ? beginOff("visibility") : endOff("visibility")));
window.addEventListener("blur", () => beginOff("blur"));
window.addEventListener("focus", () => endOff("focus"));

// ---------- Envoi ----------
let submitting = false;
async function submit(endedBy) {
  if (!s || submitting) return;
  submitting = true;
  trackingOn = false;
  try { endOff("finish"); } catch (e) {}
  if (tick) { clearInterval(tick); tick = null; }
  accumulateTime();
  if (!s.finishedAt) { s.finishedAt = Date.now(); s.endedBy = endedBy || "submit"; }
  save();
  els.submitBtn.disabled = true;
  els.retryBtn.disabled = true;

  const answers = s.questions.map((q) => {
    const c = q.id in s.chosen ? s.chosen[q.id] : -1;
    return {
      questionId: q.id, questionText: q.text, options: q.options, chosenIndex: c,
      otherText: c === "other" ? (s.otherText[q.id] || "") : null,
      timeMs: Math.round(s.timeSpent[q.id] || 0), flagged: !!s.flagged[q.id],
      focusLosses: (s.focusStats[q.id] && s.focusStats[q.id].losses) || 0,
      offWindowMs: (s.focusStats[q.id] && s.focusStats[q.id].ms) || 0,
    };
  });
  const payload = {
    v: 2,
    candidateName: s.name,
    quizId: s.quizId,
    quizTitle: s.quizTitle,
    total: s.questions.length,
    answered: answeredCount(),
    answers,
    durationMs: s.finishedAt - s.startedAt,
    endedBy: s.endedBy,
    trust: Object.assign({}, s.trust, { score: trustScore() }),
    uid: auth.currentUser ? auth.currentUser.uid : null,
    createdAt: serverTimestamp(),
  };
  try {
    await ensureAnonAuth();
    payload.uid = auth.currentUser.uid;
    await addDoc(collection(db, "results"), payload);
    const first = s.name.split(/\s+/)[0];
    els.doneTitle.textContent = "Merci " + first + " !";
    els.doneText.textContent = (s.endedBy === "timer" ? "Le temps imparti est écoulé. " : "") +
      "Vos réponses ont bien été transmises (" + payload.answered + "/" + payload.total + " questions, " + fmtDuration(payload.durationMs) + "). Le recruteur reviendra vers vous rapidement.";
    clearSaved();
    s = null;
    show("done");
  } catch (e) {
    console.error("[submit]", e);
    show("error");
  } finally {
    submitting = false;
    els.submitBtn.disabled = false;
    els.retryBtn.disabled = false;
  }
}

// ---------- Reprise après rechargement ----------
function checkResume() {
  const saved = loadSaved();
  if (!saved || !saved.questions || !saved.questions.length) return;
  s = saved;
  const expired = s.endAt && Date.now() > s.endAt;
  els.resumeText.textContent = "« " + s.quizTitle + " » — " + s.name + " — " + answeredCount() + "/" + s.questions.length + " réponses" +
    (expired ? " (temps écoulé : vos réponses vont être envoyées)" : "");
  els.resumeBtn.textContent = expired || s.finishedAt ? "Envoyer mes réponses" : "Reprendre";
  els.resumeBox.classList.remove("hidden");
  els.resumeBtn.onclick = () => {
    s.trust.reloads = (s.trust.reloads || 0) + 1;
    save();
    if (expired || s.finishedAt) { submit(s.endedBy || "timer"); return; }
    enterQuiz();
  };
}

// ---------- Événements ----------
els.startBtn.addEventListener("click", startClicked);
els.name.addEventListener("keydown", (e) => { if (e.key === "Enter") startClicked(); });
els.prestartCancel.addEventListener("click", () => els.prestart.close());
els.prevBtn.addEventListener("click", () => { if (s.idx > 0) goTo(s.idx - 1); });
els.nextBtn.addEventListener("click", next);
els.flagBtn.addEventListener("click", () => {
  const q = s.questions[s.idx];
  s.flagged[q.id] = !s.flagged[q.id];
  els.flagBtn.setAttribute("aria-pressed", s.flagged[q.id] ? "true" : "false");
  save(); renderProgress();
});
[els.qNav, els.reviewNav].forEach((nav) => nav.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (b) goTo(Number(b.dataset.go));
}));
els.backToQuizBtn.addEventListener("click", () => goTo(s.idx));
els.submitBtn.addEventListener("click", () => submit("submit"));
els.retryBtn.addEventListener("click", () => submit(s && s.endedBy));

// Raccourcis clavier pendant le test : A–D / 1–9 pour répondre, flèches pour naviguer, Entrée = suivant
document.addEventListener("keydown", (e) => {
  if (!s || $("step-quiz").classList.contains("hidden")) return;
  if (e.target.closest("textarea, input[type=text], dialog") || e.ctrlKey || e.metaKey || e.altKey) return;
  const q = s.questions[s.idx];
  const k = e.key.toUpperCase();
  let pos = LETTERS.indexOf(k);
  if (pos < 0 && /^[1-9]$/.test(k)) pos = Number(k) - 1;
  if (pos >= 0 && pos < q.order.length) {
    const radio = els.questionBox.querySelectorAll('input[name="ans"]')[pos];
    if (radio) { radio.checked = true; pick(radio.value); }
    e.preventDefault();
  } else if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); next(); }
  else if (e.key === "ArrowLeft" && s.idx > 0) { e.preventDefault(); goTo(s.idx - 1); }
});

// Avertit avant de quitter la page pendant le test
window.addEventListener("beforeunload", (e) => {
  if (s && !submitting && !$("step-quiz").classList.contains("hidden")) { e.preventDefault(); e.returnValue = ""; }
});

// ---------- Initialisation ----------
checkResume();
ensureAnonAuth().then(loadQuizzes).catch((e) => {
  console.error("[auth]", e);
  els.quizList.innerHTML = '<div class="alert alert-danger">' + icon("alert") + '<div class="alert-body">Connexion au service impossible. Rechargez la page.</div></div>';
});
