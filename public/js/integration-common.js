/**
 * Checklist d'intégration technicien : logique partagée entre la page cachée (/integration)
 * et l'onglet « Intégration » de l'espace admin.
 * Contenu (sections + sujets) : document Firestore integration_config/current, modifiable par les super admins.
 * Tant qu'il n'existe pas, le contenu par défaut vient de /data/checklist-integration.json.
 * Chaque sujet a un identifiant FIXE (ex. "acces-0", "acces-k3f9x2") : modifier, déplacer ou supprimer
 * un sujet ne décale jamais les réponses déjà données. Statut : 0 = Pas vu, 1 = Partiel, 2 = Vu (absent = 0).
 */
import { db, doc, getDoc } from "./common.js";

export const COLLECTION = "integration_checklists";
export const CONFIG_REF = ["integration_config", "current"];
export const STATUS = [
  { v: 0, label: "Pas vu", cls: "s0" },
  { v: 1, label: "Partiel", cls: "s1" },
  { v: 2, label: "Vu", cls: "s2" },
];

/** Met le contenu au format { id, name, tag, items: [{ id, label }] } (le fichier JSON d'origine liste des textes). */
export function normalize(raw) {
  return (raw || []).map((sec) => ({
    id: String(sec.id),
    name: String(sec.name || ""),
    tag: String(sec.tag || ""),
    items: (sec.items || []).map((it, i) => (typeof it === "string" ? { id: sec.id + "-" + i, label: it } : { id: String(it.id), label: String(it.label || "") })),
  }));
}

/** Charge le contenu de la checklist : version en base si elle existe, sinon le fichier par défaut. */
export async function loadConfig() {
  try {
    const snap = await getDoc(doc(db, ...CONFIG_REF));
    if (snap.exists() && Array.isArray((snap.data() || {}).sections)) return normalize(snap.data().sections);
  } catch (e) { console.warn("[integration config]", e); }
  const r = await fetch("/data/checklist-integration.json", { cache: "no-store" });
  if (!r.ok) throw new Error("config " + r.status);
  return normalize(await r.json());
}

/** Identifiant court aléatoire (nouveaux sujets / sections). */
export function shortId() {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 7);
}

/** Statut d'un item (0 par défaut). */
export function statusOf(items, key) {
  const v = items && items[key];
  return v === 1 || v === 2 ? v : 0;
}

/** Compteurs d'une liste de clés : { total, vu, partiel, pasVu, pct } — avancement = (Vu + 0,5 × Partiel) / total. */
function count(keys, items) {
  const c = { total: keys.length, vu: 0, partiel: 0, pasVu: 0 };
  keys.forEach((k) => { const s = statusOf(items, k); if (s === 2) c.vu++; else if (s === 1) c.partiel++; else c.pasVu++; });
  c.pct = c.total ? Math.round(((c.vu + 0.5 * c.partiel) / c.total) * 100) : 0;
  return c;
}

/** Statistiques globales et par section. */
export function stats(config, items) {
  const all = [];
  const sections = {};
  config.forEach((sec) => {
    const keys = sec.items.map((it) => it.id);
    all.push(...keys);
    sections[sec.id] = count(keys, items);
  });
  return Object.assign(count(all, items), { sections });
}

/** « 4/6 vu · 1 partiel » */
export function sectionLabel(c) {
  return c.vu + "/" + c.total + " vu" + (c.partiel ? " · " + c.partiel + " partiel" + (c.partiel > 1 ? "s" : "") : "");
}

/** "2026-11-03" -> "03/11/2026" */
export function frDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? m[3] + "/" + m[2] + "/" + m[1] : iso || "";
}

/** Bilan texte brut (Teams / mail). */
export function buildBilan(config, data) {
  const items = data.items || {}, notes = data.notes || {};
  const st = stats(config, items);
  const lines = ["Bilan intégration — " + (data.techName || "") + " (" + frDate(data.startDate) + ") — " + st.pct + " %"];
  if (data.referent) lines.push("Référent : " + data.referent);
  config.forEach((sec) => {
    lines.push("", "■ " + sec.name + " (" + st.sections[sec.id].vu + "/" + st.sections[sec.id].total + " vu)");
    sec.items.forEach((it) => lines.push("  [" + STATUS[statusOf(items, it.id)].label + "] " + it.label));
    if (notes[sec.id] && notes[sec.id].trim()) lines.push("  Remarques : " + notes[sec.id].trim().replace(/\s*\n\s*/g, " / "));
  });
  return lines.join("\n");
}

/** Identifiant aléatoire long (sert de lien personnel, impossible à deviner). */
export function newId() {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
