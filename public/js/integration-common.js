/**
 * Checklist d'intégration technicien : logique partagée entre la page cachée (/integration)
 * et l'onglet « Intégration » de l'espace admin.
 * Le contenu (sections + items) vient de /data/checklist-integration.json.
 * Statut d'un item : 0 = Pas vu, 1 = Partiel, 2 = Vu (item absent = 0). Clé d'item : "<idSection>-<index>".
 */

export const COLLECTION = "integration_checklists";
export const STATUS = [
  { v: 0, label: "Pas vu", cls: "s0" },
  { v: 1, label: "Partiel", cls: "s1" },
  { v: 2, label: "Vu", cls: "s2" },
];

let configPromise = null;
/** Charge la configuration de la checklist (une seule fois). */
export function loadConfig() {
  if (!configPromise) {
    configPromise = fetch("/data/checklist-integration.json", { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error("config " + r.status);
      return r.json();
    });
  }
  return configPromise;
}

export function itemKey(sectionId, index) { return sectionId + "-" + index; }

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
    const keys = sec.items.map((_, i) => itemKey(sec.id, i));
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
    sec.items.forEach((label, i) => lines.push("  [" + STATUS[statusOf(items, itemKey(sec.id, i))].label + "] " + label));
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
