/**
 * Onglet « Intégration » (super admins uniquement) : suivi des checklists d'intégration des techniciens.
 * Liste en temps réel, détail par checklist, bilan à copier, suppression.
 */
import { db, collection, doc, deleteDoc, onSnapshot } from "./common.js";
import { esc, icon, toast, confirmDialog, toDate } from "./ui.js";
import { COLLECTION, STATUS, loadConfig, itemKey, statusOf, stats, sectionLabel, frDate, buildBilan } from "./integration-common.js";

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
      '<div class="cl-items">' + sec.items.map((label, i) => {
        const s = statusOf(items, itemKey(sec.id, i));
        return '<div class="cl-item" style="padding:8px 0"><span class="cl-label">' + esc(label) + '</span><span class="st ' + STATUS[s].cls + '">' + STATUS[s].label + "</span></div>";
      }).join("") + "</div>" +
      (notes[sec.id] && notes[sec.id].trim() ? '<div class="alert" style="margin-top:4px"><div class="alert-body"><b class="small">Remarques du technicien</b><span style="white-space:pre-wrap">' + esc(notes[sec.id]) + "</span></div></div>" : "") +
    "</div>";
  }).join("");
  $("copyBilanBtn").onclick = () => copy(buildBilan(config, r), "Bilan copié : collez-le dans Teams ou un mail.");
}
