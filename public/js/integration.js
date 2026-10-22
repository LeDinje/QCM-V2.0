/**
 * Page cachée /integration : le nouveau technicien remplit sa checklist d'intégration.
 * - Pas de compte : connexion anonyme Firebase. Le lien personnel (/integration#<identifiant>) donne accès à SA checklist.
 * - Sauvegarde automatique 500 ms après chaque clic / frappe.
 */
import { db, doc, getDoc, setDoc, updateDoc, ensureAnonAuth, serverTimestamp } from "./common.js";
import { esc, icon, initPage, toast } from "./ui.js";
import { COLLECTION, STATUS, loadConfig, itemKey, statusOf, stats, sectionLabel, frDate, newId } from "./integration-common.js";

initPage();

const LOCAL_KEY = "qcm.integration.id";
const $ = (id) => document.getElementById(id);
let config = [];
let id = null;
let data = null;            // document Firestore en mémoire
let pending = {};           // modifications en attente d'envoi (chemins Firestore)
let timer = null;
let saving = false;

function show(step) {
  ["loading", "start", "notfound", "checklist"].forEach((s) => $("step-" + s).classList.toggle("hidden", s !== step));
}
function personalLink() { return location.origin + "/integration#" + id; }
function remember(v) { try { v ? localStorage.setItem(LOCAL_KEY, v) : localStorage.removeItem(LOCAL_KEY); } catch (e) {} }
function recall() { try { return localStorage.getItem(LOCAL_KEY); } catch (e) { return null; } }

// ---------- Démarrage ----------
async function init() {
  try {
    [config] = await Promise.all([loadConfig(), ensureAnonAuth()]);
  } catch (e) {
    console.error("[integration init]", e);
    show("notfound");
    return;
  }
  const fromHash = location.hash.replace(/^#/, "").trim();
  const candidate = fromHash || recall();
  if (!candidate) { show("start"); return; }
  if (!/^[a-f0-9]{32,64}$/.test(candidate)) { show("notfound"); return; }
  try {
    const snap = await getDoc(doc(db, COLLECTION, candidate));
    if (!snap.exists()) {
      if (!fromHash) { remember(null); show("start"); return; }   // ancienne checklist supprimée : on repart de zéro
      show("notfound");
      return;
    }
    id = candidate;
    data = snap.data();
    if (!fromHash) history.replaceState(null, "", "/integration#" + id);
    remember(id);
    renderChecklist();
  } catch (e) {
    console.error("[integration load]", e);
    show("notfound");
  }
}

$("startForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const techName = $("techName").value.trim();
  const startDate = $("startDate").value;
  const referent = $("referent").value.trim();
  const err = !techName ? "Indiquez votre prénom et votre nom." : !startDate ? "Indiquez votre date d'arrivée." : !referent ? "Indiquez le nom de votre référent." : "";
  $("startError").textContent = err;
  if (err) return;
  $("startBtn").disabled = true;
  try {
    id = newId();
    data = { techName, startDate, referent, items: {}, notes: {}, sectionUpdatedAt: {}, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await setDoc(doc(db, COLLECTION, id), data);
    history.replaceState(null, "", "/integration#" + id);
    remember(id);
    renderChecklist();
    toast("Checklist créée. Pensez à garder votre lien personnel.", "success");
  } catch (e2) {
    console.error("[integration create]", e2);
    $("startError").textContent = "Impossible de créer la checklist. Vérifiez votre connexion et réessayez.";
  } finally { $("startBtn").disabled = false; }
});

// ---------- Affichage ----------
function renderChecklist() {
  $("hName").textContent = data.techName || "";
  $("hDate").textContent = frDate(data.startDate);
  $("hRef").textContent = data.referent || "";
  $("personalLink").textContent = personalLink();
  const items = data.items || {}, notes = data.notes || {};
  $("sections").innerHTML = config.map((sec) =>
    '<div class="card checklist-section" data-sec="' + esc(sec.id) + '">' +
      '<div class="row-between" style="align-items:flex-start;margin-bottom:12px">' +
        '<div><h2>' + esc(sec.name) + '</h2>' + (sec.tag ? '<span class="badge" style="margin-top:6px">' + esc(sec.tag) + "</span>" : "") + "</div>" +
        '<span class="small sec-count" data-count="' + esc(sec.id) + '"></span>' +
      "</div>" +
      '<div class="cl-items">' + sec.items.map((label, i) => {
        const k = itemKey(sec.id, i), cur = statusOf(items, k);
        return '<div class="cl-item"><span class="cl-label">' + esc(label) + "</span>" +
          '<div class="seg" role="radiogroup" aria-label="' + esc(label) + '">' +
            STATUS.map((s) => '<button type="button" class="' + s.cls + '" role="radio" aria-checked="' + (cur === s.v) + '" data-k="' + esc(k) + '" data-v="' + s.v + '">' + s.label + "</button>").join("") +
          "</div></div>";
      }).join("") + "</div>" +
      '<div class="field" style="margin-top:16px"><label for="notes-' + esc(sec.id) + '">Remarques</label>' +
        '<textarea class="textarea" id="notes-' + esc(sec.id) + '" data-notes="' + esc(sec.id) + '" maxlength="3000" rows="2" placeholder="Questions, points à revoir, précisions…">' + esc(notes[sec.id] || "") + "</textarea></div>" +
    "</div>").join("");
  renderProgress();
  show("checklist");
}

function renderProgress() {
  const st = stats(config, data.items || {});
  $("pctValue").textContent = st.pct + " %";
  $("pctFill").style.width = st.pct + "%";
  document.querySelectorAll("[data-count]").forEach((el) => { el.textContent = sectionLabel(st.sections[el.dataset.count]); });
}

// ---------- Saisie + sauvegarde automatique ----------
$("sections").addEventListener("click", (e) => {
  const b = e.target.closest(".seg button");
  if (!b) return;
  const k = b.dataset.k, v = Number(b.dataset.v);
  b.parentElement.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  data.items = data.items || {};
  data.items[k] = v;
  queue("items." + k, v, k.slice(0, k.lastIndexOf("-")));
  renderProgress();
});

$("sections").addEventListener("input", (e) => {
  const ta = e.target.closest("[data-notes]");
  if (!ta) return;
  data.notes = data.notes || {};
  data.notes[ta.dataset.notes] = ta.value;
  queue("notes." + ta.dataset.notes, ta.value, ta.dataset.notes);
});

// Navigation clavier dans les boutons Pas vu / Partiel / Vu
$("sections").addEventListener("keydown", (e) => {
  const b = e.target.closest(".seg button");
  if (!b || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
  const next = e.key === "ArrowRight" ? b.nextElementSibling : b.previousElementSibling;
  if (next) { e.preventDefault(); next.focus(); next.click(); }
});

function setState(text, cls) {
  const el = $("saveState");
  el.classList.remove("hidden", "ok", "err");
  if (cls) el.classList.add(cls);
  el.innerHTML = (cls === "ok" ? icon("check", "icon-sm") : cls === "err" ? icon("alert", "icon-sm") : '<span class="spinner" style="width:14px;height:14px"></span>') + "<span>" + text + "</span>";
}

function queue(path, value, sectionId) {
  pending[path] = value;
  pending["sectionUpdatedAt." + sectionId] = serverTimestamp();
  setState("Modifications en cours…");
  clearTimeout(timer);
  timer = setTimeout(flush, 500);
}

async function flush() {
  timer = null;
  if (saving || !Object.keys(pending).length) return;
  saving = true;
  const batch = pending;
  pending = {};
  setState("Enregistrement…");
  try {
    await updateDoc(doc(db, COLLECTION, id), Object.assign({}, batch, { updatedAt: serverTimestamp() }));
    if (!Object.keys(pending).length) setState("Enregistré", "ok");
  } catch (e) {
    console.error("[integration save]", e);
    pending = Object.assign(batch, pending);      // on garde tout pour le prochain essai
    setState("Non enregistré — nouvel essai…", "err");
    clearTimeout(timer);
    timer = setTimeout(flush, 3000);
  } finally {
    saving = false;
    if (Object.keys(pending).length && !timer) timer = setTimeout(flush, 500);
  }
}

// Prévient si on quitte avec des modifications non envoyées
window.addEventListener("beforeunload", (e) => {
  if (Object.keys(pending).length || saving) { flush(); e.preventDefault(); e.returnValue = ""; }
});

$("copyLinkBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(personalLink()); toast("Lien copié.", "success"); }
  catch (e) { toast("Copie impossible : sélectionnez le lien et copiez-le.", "error"); }
});

window.addEventListener("hashchange", () => location.reload());

init();
