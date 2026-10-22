/**
 * Onglet « Intégration » (super admins uniquement) : suivi des checklists d'intégration des techniciens.
 * Liste en temps réel, détail par checklist, bilan à copier, suppression,
 * et éditeur du contenu de la checklist (sections et sujets).
 */
import { auth, db, collection, doc, deleteDoc, setDoc, onSnapshot, serverTimestamp } from "./common.js";
import { esc, icon, toast, confirmDialog, toDate } from "./ui.js";
import { COLLECTION, CONFIG_REF, STATUS, loadConfig, shortId, statusOf, stats, sectionLabel, frDate, buildBilan } from "./integration-common.js";

const $ = (id) => document.getElementById(id);
let unsub = null;
let config = [];
let rows = [];
let openId = null;

export async function startIntegration() {
  if (unsub) return;
  try { config = await loadConfig(); }
  catch (e) { toast("Contenu de la checklist introuvable (data/checklist-integration.json).", "error"); return; }
  unsub = onSnapshot(collection(db, COLLECTION), (snap) => {
    rows = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    rows.sort((a, b) => ((toDate(b.updatedAt) || 0) - (toDate(a.updatedAt) || 0)));
    render();
    if (openId && $("integrationDialog").open) renderDetail(rows.find((r) => r.id === openId));
  }, (e) => { console.error("[integration]", e); toast("Lecture des checklists impossible : " + (e.code || e.message), "error"); });
}

export function stopIntegration() {
  if (unsub) { unsub(); unsub = null; }
  rows = [];
}

function link(id) { return location.origin + "/integration" + (id ? "#" + id : ""); }
function fmt(v) {
  const d = toDate(v);
  return d ? d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) + " · " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—";
}
async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg, "success"); }
  catch (e) { await confirmDialog({ title: "Copier", message: '<textarea class="textarea" readonly rows="8" onclick="this.select()">' + esc(text) + "</textarea>", confirmText: "Fermer", cancelText: null }); }
}

function render() {
  $("integrationLink").textContent = link();
  $("integrationBody").innerHTML = rows.length ? rows.map((r) => {
    const st = stats(config, r.items || {});
    return '<tr class="clickable" data-open="' + esc(r.id) + '">' +
      "<td><b>" + esc(r.techName || "(sans nom)") + '</b><div class="small">Référent : ' + esc(r.referent || "—") + "</div></td>" +
      '<td class="muted" style="white-space:nowrap">' + esc(frDate(r.startDate)) + "</td>" +
      '<td><div class="meter"><div class="meter-track"><div class="meter-fill" style="width:' + st.pct + '%"></div></div><span class="meter-label">' + st.pct + " %</span></div></td>" +
      '<td style="white-space:nowrap"><span class="st s2">' + st.vu + ' vu</span> <span class="st s1">' + st.partiel + ' partiel</span> <span class="st s0">' + st.pasVu + " pas vu</span></td>" +
      '<td class="muted" style="white-space:nowrap">' + fmt(r.updatedAt) + "</td>" +
      '<td class="num" style="white-space:nowrap">' +
        '<button class="btn btn-ghost btn-icon btn-sm" type="button" data-link="' + esc(r.id) + '" title="Copier le lien personnel" aria-label="Copier le lien personnel">' + icon("link", "icon-sm") + "</button>" +
        '<button class="btn btn-ghost btn-icon btn-sm" type="button" data-open="' + esc(r.id) + '" title="Voir le détail" aria-label="Voir le détail">' + icon("eye", "icon-sm") + "</button>" +
        '<button class="btn btn-ghost btn-icon btn-sm btn-danger" type="button" data-del="' + esc(r.id) + '" title="Supprimer" aria-label="Supprimer">' + icon("trash", "icon-sm") + "</button>" +
      "</td></tr>";
  }).join("") : '<tr><td colspan="6"><div class="empty" style="border:none">' + icon("clipboard") +
      "<div>Aucune checklist pour l'instant.</div><div class=\"small\" style=\"margin-top:4px\">Envoyez le lien ci-dessus au nouveau technicien.</div></div></td></tr>";
}

$("integrationBody").addEventListener("click", async (e) => {
  const l = e.target.closest("[data-link]"), d = e.target.closest("[data-del]"), o = e.target.closest("[data-open]");
  if (l) { e.stopPropagation(); copy(link(l.dataset.link), "Lien personnel copié."); return; }
  if (d) {
    e.stopPropagation();
    const r = rows.find((x) => x.id === d.dataset.del);
    const ok = await confirmDialog({ title: "Supprimer cette checklist ?", message: "La checklist de <b>" + esc(r && r.techName) + "</b> et toutes ses réponses seront supprimées définitivement. Son lien ne fonctionnera plus.", confirmText: "Supprimer", danger: true });
    if (!ok) return;
    try { await deleteDoc(doc(db, COLLECTION, d.dataset.del)); toast("Checklist supprimée.", "success"); }
    catch (err) { toast("Suppression impossible : " + (err.code || err.message), "error"); }
    return;
  }
  if (o) openDetail(o.dataset.open);
});

$("copyIntegrationLinkBtn").addEventListener("click", () => copy(link(), "Lien de la checklist copié."));

// ---------- Détail ----------
const dlg = $("integrationDialog");
$("integrationClose").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener("close", () => { openId = null; });

function openDetail(id) {
  openId = id;
  renderDetail(rows.find((r) => r.id === id));
  if (!dlg.open) dlg.showModal();
}

function renderDetail(r) {
  if (!r) { dlg.close(); return; }
  const items = r.items || {}, notes = r.notes || {}, secAt = r.sectionUpdatedAt || {};
  const st = stats(config, items);
  $("integrationHead").innerHTML =
    '<span class="eyebrow">Arrivée le ' + esc(frDate(r.startDate)) + " · Référent : " + esc(r.referent || "—") + "</span>" +
    '<h2 style="margin-top:4px">' + esc(r.techName || "(sans nom)") + "</h2>" +
    '<div class="row" style="gap:8px;margin-top:12px">' +
      '<span class="badge badge-brand">' + st.pct + " % d'avancement</span>" +
      '<span class="st s2">' + st.vu + ' vu</span><span class="st s1">' + st.partiel + ' partiel</span><span class="st s0">' + st.pasVu + " pas vu</span>" +
      '<span class="small">Dernière mise à jour : ' + fmt(r.updatedAt) + "</span>" +
    "</div>";
  $("integrationDetail").innerHTML = config.map((sec) => {
    const c = st.sections[sec.id];
    return '<div class="stack" style="gap:8px;padding:18px 0;border-top:1px solid var(--border)">' +
      '<div class="row-between"><div><b>' + esc(sec.name) + "</b>" + (sec.tag ? ' <span class="badge" style="margin-left:6px">' + esc(sec.tag) + "</span>" : "") + "</div>" +
      '<span class="small">' + sectionLabel(c) + (secAt[sec.id] ? " · modifié le " + fmt(secAt[sec.id]) : "") + "</span></div>" +
      '<div class="cl-items">' + sec.items.map((it) => {
        const s = statusOf(items, it.id), label = it.label;
        return '<div class="cl-item" style="padding:8px 0"><span class="cl-label">' + esc(label) + '</span><span class="st ' + STATUS[s].cls + '">' + STATUS[s].label + "</span></div>";
      }).join("") + "</div>" +
      (notes[sec.id] && notes[sec.id].trim() ? '<div class="alert" style="margin-top:4px"><div class="alert-body"><b class="small">Remarques du technicien</b><span style="white-space:pre-wrap">' + esc(notes[sec.id]) + "</span></div></div>" : "") +
    "</div>";
  }).join("");
  $("copyBilanBtn").onclick = () => copy(buildBilan(config, r), "Bilan copié : collez-le dans Teams ou un mail.");
}

// ---------- Éditeur du contenu (sections + sujets) ----------
let draft = null;      // copie de travail du contenu
let dirty = false;

const clone = (v) => JSON.parse(JSON.stringify(v));
function setDirty(v) { dirty = v; $("editorState").textContent = v ? "Modifications non enregistrées" : ""; }
function answeredCount(itemIds) {
  return rows.filter((r) => itemIds.some((id) => statusOf(r.items || {}, id) > 0)).length;
}

function openEditor() {
  draft = clone(config);
  setDirty(false);
  renderEditor();
  $("checklistEditor").classList.remove("hidden");
  $("integrationListPart").classList.add("hidden");
  $("editChecklistBtn").classList.add("hidden");
}
function closeEditor() {
  draft = null;
  $("checklistEditor").classList.add("hidden");
  $("integrationListPart").classList.remove("hidden");
  $("editChecklistBtn").classList.remove("hidden");
}

function renderEditor() {
  const n = draft.length;
  $("editorSections").innerHTML = draft.map((sec, si) =>
    '<div class="card stack" data-si="' + si + '">' +
      '<div class="row" style="gap:12px;align-items:flex-end">' +
        '<div class="field" style="flex:2;min-width:200px"><label for="sname-' + si + '">Section</label>' +
          '<input class="input" id="sname-' + si + '" data-f="name" maxlength="120" value="' + esc(sec.name) + '" placeholder="Ex : Outils transverses"></div>' +
        '<div class="field" style="flex:1;min-width:150px"><label for="stag-' + si + '">Étiquette <span class="muted">(optionnel)</span></label>' +
          '<input class="input" id="stag-' + si + '" data-f="tag" maxlength="60" value="' + esc(sec.tag) + '" placeholder="Ex : semaine 1"></div>' +
        '<div class="row" style="gap:2px;flex-wrap:nowrap">' +
          '<button class="btn btn-ghost btn-icon" type="button" data-sact="up" title="Monter la section" aria-label="Monter la section"' + (si === 0 ? " disabled" : "") + ">" + icon("arrow-left", "icon-sm rot90") + "</button>" +
          '<button class="btn btn-ghost btn-icon" type="button" data-sact="down" title="Descendre la section" aria-label="Descendre la section"' + (si === n - 1 ? " disabled" : "") + ">" + icon("arrow-right", "icon-sm rot90") + "</button>" +
          '<button class="btn btn-ghost btn-icon btn-danger" type="button" data-sact="del" title="Supprimer la section" aria-label="Supprimer la section">' + icon("trash", "icon-sm") + "</button>" +
        "</div>" +
      "</div>" +
      '<div class="stack" style="gap:6px">' + sec.items.map((it, ii) =>
        '<div class="row" style="gap:8px;flex-wrap:nowrap" data-ii="' + ii + '">' +
          '<span class="q-row-num">' + (ii + 1) + "</span>" +
          '<input class="input" data-f="label" maxlength="300" value="' + esc(it.label) + '" placeholder="Intitulé du sujet" aria-label="Sujet ' + (ii + 1) + '">' +
          '<button class="btn btn-ghost btn-icon btn-sm" type="button" data-iact="up" title="Monter" aria-label="Monter"' + (ii === 0 ? " disabled" : "") + ">" + icon("arrow-left", "icon-sm rot90") + "</button>" +
          '<button class="btn btn-ghost btn-icon btn-sm" type="button" data-iact="down" title="Descendre" aria-label="Descendre"' + (ii === sec.items.length - 1 ? " disabled" : "") + ">" + icon("arrow-right", "icon-sm rot90") + "</button>" +
          '<button class="btn btn-ghost btn-icon btn-sm btn-danger" type="button" data-iact="del" title="Supprimer le sujet" aria-label="Supprimer le sujet">' + icon("trash", "icon-sm") + "</button>" +
        "</div>").join("") +
      "</div>" +
      '<div><button class="btn btn-sm" type="button" data-sact="additem">' + icon("plus", "icon-sm") + " Ajouter un sujet</button></div>" +
    "</div>").join("") || '<div class="empty">' + icon("list") + "<div>Aucune section.</div></div>";
}

$("editorSections").addEventListener("input", (e) => {
  const f = e.target.dataset.f;
  if (!f) return;
  const card = e.target.closest("[data-si]"), sec = draft[Number(card.dataset.si)];
  if (f === "label") sec.items[Number(e.target.closest("[data-ii]").dataset.ii)].label = e.target.value;
  else sec[f] = e.target.value;
  setDirty(true);
});

$("editorSections").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-sact],[data-iact]");
  if (!b) return;
  const si = Number(b.closest("[data-si]").dataset.si), sec = draft[si];
  const swap = (arr, i, j) => { [arr[i], arr[j]] = [arr[j], arr[i]]; };
  if (b.dataset.sact === "up") swap(draft, si, si - 1);
  if (b.dataset.sact === "down") swap(draft, si, si + 1);
  if (b.dataset.sact === "additem") {
    sec.items.push({ id: sec.id + "-" + shortId(), label: "" });
    setDirty(true); renderEditor();
    const inputs = $("editorSections").querySelectorAll('[data-si="' + si + '"] [data-f="label"]');
    inputs[inputs.length - 1].focus();
    return;
  }
  if (b.dataset.sact === "del") {
    const used = answeredCount(sec.items.map((it) => it.id));
    const ok = await confirmDialog({
      title: "Supprimer la section ?",
      message: "« " + esc(sec.name || "Sans nom") + " » et ses " + sec.items.length + " sujets seront retirés de la checklist." +
               (used ? "<br><br>" + used + " technicien(s) y ont déjà répondu : ces réponses ne compteront plus dans leur avancement." : ""),
      confirmText: "Supprimer", danger: true,
    });
    if (!ok) return;
    draft.splice(si, 1);
  }
  if (b.dataset.iact) {
    const ii = Number(b.closest("[data-ii]").dataset.ii);
    if (b.dataset.iact === "up") swap(sec.items, ii, ii - 1);
    if (b.dataset.iact === "down") swap(sec.items, ii, ii + 1);
    if (b.dataset.iact === "del") {
      const it = sec.items[ii], used = answeredCount([it.id]);
      if (used || it.label.trim()) {
        const ok = await confirmDialog({
          title: "Supprimer ce sujet ?",
          message: "« " + esc(it.label || "Sans intitulé") + " »" + (used ? "<br><br>" + used + " technicien(s) y ont déjà répondu : cette réponse ne comptera plus dans leur avancement." : ""),
          confirmText: "Supprimer", danger: true,
        });
        if (!ok) return;
      }
      sec.items.splice(ii, 1);
    }
  }
  setDirty(true);
  renderEditor();
});

$("addSectionBtn").addEventListener("click", () => {
  draft.push({ id: "s" + shortId(), name: "", tag: "", items: [{ id: "", label: "" }] });
  const sec = draft[draft.length - 1];
  sec.items[0].id = sec.id + "-" + shortId();
  setDirty(true); renderEditor();
  $("sname-" + (draft.length - 1)).focus();
});

$("editChecklistBtn").addEventListener("click", openEditor);
$("cancelEditorBtn").addEventListener("click", async () => {
  if (dirty && !(await confirmDialog({ title: "Abandonner les modifications ?", message: "Les changements non enregistrés seront perdus.", confirmText: "Abandonner", danger: true }))) return;
  closeEditor();
});

$("saveEditorBtn").addEventListener("click", async () => {
  // nettoyage : espaces superflus, sujets vides retirés
  const sections = draft.map((sec) => ({ id: sec.id, name: sec.name.trim(), tag: sec.tag.trim(),
    items: sec.items.map((it) => ({ id: it.id, label: it.label.trim() })).filter((it) => it.label) }));
  const bad = sections.findIndex((sec) => !sec.name);
  if (!sections.length) { toast("La checklist doit contenir au moins une section.", "error"); return; }
  if (bad >= 0) { toast("Donnez un nom à chaque section.", "error"); $("sname-" + bad).focus(); return; }
  if (sections.some((sec) => !sec.items.length)) { toast("Chaque section doit contenir au moins un sujet.", "error"); return; }
  $("saveEditorBtn").disabled = true;
  try {
    await setDoc(doc(db, ...CONFIG_REF), { sections, updatedAt: serverTimestamp(), updatedBy: (auth.currentUser && auth.currentUser.email) || "" });
    config = sections;
    setDirty(false);
    closeEditor();
    render();
    toast("Contenu de la checklist enregistré.", "success");
  } catch (err) {
    console.error("[checklist save]", err);
    toast("Enregistrement impossible : " + (err.code || err.message), "error");
  } finally { $("saveEditorBtn").disabled = false; }
});
