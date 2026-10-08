/**
 * Onglet « Admins » (super admins uniquement) : liste des comptes administrateurs,
 * création de compte, e-mail de réinitialisation du mot de passe, rôle, désactivation.
 * Les droits sont vérifiés par les règles Firestore (isSuperAdmin), pas seulement par cette page.
 */
import { db, collection, doc, setDoc, onSnapshot, serverTimestamp, createAccount, sendPasswordReset } from "./common.js";
import { esc, icon, toast, confirmDialog, toDate } from "./ui.js";

const $ = (id) => document.getElementById(id);
let unsub = null;
let me = null;          // utilisateur connecté (super admin)
let admins = [];        // [{ id, email, role, disabled, createdAt, createdBy, lastLoginAt }]
let editing = null;     // compte en cours de modification (null = création)

export function startAdmins(user) {
  me = user;
  if (unsub) return;
  unsub = onSnapshot(collection(db, "admins"), (snap) => {
    admins = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    render();
  }, (e) => { console.error("[admins]", e); toast("Lecture des comptes admin impossible : " + (e.code || e.message), "error"); });
}

export function stopAdmins() {
  if (unsub) { unsub(); unsub = null; }
  admins = [];
}

function fmtDay(v) {
  const d = toDate(v);
  return d ? d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : '<span class="muted">—</span>';
}
function fmt(v) {
  const d = toDate(v);
  return d ? d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) + " · " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : '<span class="muted">—</span>';
}

function render() {
  const rows = admins.slice().sort((a, b) => (!!a.disabled - !!b.disabled) || String(a.email || "~").localeCompare(String(b.email || "~")));
  $("adminsBody").innerHTML = rows.map((a) => {
    const self = me && a.id === me.uid;
    const sa = a.role === "superadmin";
    const btn = (act, label, ic, extra) => '<button class="btn btn-sm' + (extra || "") + '" type="button" data-act="' + act + '" data-id="' + esc(a.id) + '">' + (ic ? icon(ic, "icon-sm") : "") + label + "</button>";
    const iconBtn = (act, ic, title, extra) => '<button class="btn btn-sm btn-ghost btn-icon' + extra + '" type="button" data-act="' + act + '" data-id="' + esc(a.id) + '" title="' + title + '" aria-label="' + title + '">' + icon(ic, "icon-sm") + "</button>";
    const actions = self ? '<span class="small">Votre compte</span>' :
      '<div class="row" style="gap:6px;justify-content:flex-end;flex-wrap:nowrap">' +
        (a.email ? btn("reset", "Réinitialiser", "lock") : btn("edit", "Ajouter l'e-mail", "pencil")) +
        (a.email ? iconBtn("edit", "pencil", "Modifier le rôle", "") : "") +
        (a.disabled ? iconBtn("toggle", "check", "Réactiver le compte", "") : iconBtn("toggle", "x", "Désactiver le compte", " btn-danger")) +
      "</div>";
    return "<tr>" +
      "<td><b>" + (a.email ? esc(a.email) : '<span class="muted">E-mail non renseigné</span>') + "</b>" +
        (self ? ' <span class="badge badge-brand">Vous</span>' : "") +
        '<div class="small" style="font-family:ui-monospace,monospace">' + esc(a.id) + "</div></td>" +
      "<td>" + (sa ? '<span class="badge badge-brand">' + icon("shield", "icon-sm") + "Super admin</span>" : '<span class="badge">Admin</span>') + "</td>" +
      "<td>" + (a.disabled ? '<span class="badge">Désactivé</span>' : '<span class="badge badge-success"><span class="dot"></span>Actif</span>') + "</td>" +
      '<td class="muted" style="white-space:nowrap">' + fmt(a.lastLoginAt) + "</td>" +
      '<td class="muted" style="white-space:nowrap">' + fmtDay(a.createdAt) + (a.createdBy ? '<div class="small">par ' + esc(a.createdBy) + "</div>" : "") + "</td>" +
      '<td class="num">' + actions + "</td></tr>";
  }).join("") || '<tr><td colspan="6"><div class="empty" style="border:none">' + icon("user") + "<div>Aucun compte.</div></div></td></tr>";
}

// --- Actions sur une ligne ---
$("adminsBody").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const a = admins.find((x) => x.id === b.dataset.id);
  if (!a || (me && a.id === me.uid)) return;

  if (b.dataset.act === "edit") openDialog(a);

  if (b.dataset.act === "reset") {
    const ok = await confirmDialog({
      title: "Réinitialiser le mot de passe ?",
      message: "Un e-mail sera envoyé à <b>" + esc(a.email) + "</b> avec un lien pour choisir un nouveau mot de passe. Son mot de passe actuel reste valable tant qu'il n'a pas utilisé le lien.",
      confirmText: "Envoyer l'e-mail",
    });
    if (!ok) return;
    try { await sendPasswordReset(a.email); toast("E-mail de réinitialisation envoyé à " + a.email + ".", "success"); }
    catch (err) { toast("Envoi impossible : " + (err.code || err.message), "error"); }
  }

  if (b.dataset.act === "toggle") {
    const disabling = !a.disabled;
    if (disabling) {
      const ok = await confirmDialog({
        title: "Désactiver ce compte ?",
        message: "<b>" + esc(a.email || a.id) + "</b> ne pourra plus accéder à l'espace admin. Vous pourrez le réactiver à tout moment.",
        confirmText: "Désactiver", danger: true,
      });
      if (!ok) return;
    }
    await save(a.id, { disabled: disabling }, a, disabling ? "Compte désactivé." : "Compte réactivé.");
  }
});

/** Écrit un compte admin (les champs role et email sont toujours présents, comme l'exigent les règles). */
async function save(uid, changes, current, okMessage) {
  const data = Object.assign({ role: (current && current.role) || "admin", email: (current && current.email) || "" }, changes);
  try {
    await setDoc(doc(db, "admins", uid), data, { merge: true });
    if (okMessage) toast(okMessage, "success");
    return true;
  } catch (err) {
    console.error("[admins save]", err);
    toast("Enregistrement impossible : " + (err.code || err.message), "error");
    return false;
  }
}

// --- Fenêtre création / modification ---
const dlg = $("adminDialog");

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%*?";
  const buf = new Uint32Array(14);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

function openDialog(a) {
  editing = a || null;
  $("adminDialogTitle").textContent = a ? "Modifier le compte" : "Ajouter un admin";
  $("saveAdminBtn").textContent = a ? "Enregistrer" : "Créer le compte";
  $("newAdminEmail").value = a ? a.email || "" : "";
  $("newAdminEmail").disabled = !!(a && a.email);
  $("newAdminPwd").value = generatePassword();
  $("newAdminPwdField").classList.toggle("hidden", !!a);
  $("sendResetWrap").classList.toggle("hidden", !!a);
  $("sendResetOnCreate").checked = true;
  $("newAdminRole").value = a ? a.role || "admin" : "admin";
  $("adminError").textContent = "";
  dlg.showModal();
  (a && a.email ? $("newAdminRole") : $("newAdminEmail")).focus();
}

$("addAdminBtn").addEventListener("click", () => openDialog(null));
$("genPwdBtn").addEventListener("click", () => { $("newAdminPwd").value = generatePassword(); });

const CREATE_ERRORS = {
  "auth/email-already-in-use": "Un compte existe déjà avec cet e-mail. S'il figure dans la liste, réactivez-le. Sinon, il a été créé hors de cette page : ajoutez son UID depuis la console Firebase.",
  "auth/invalid-email": "Adresse e-mail invalide.",
  "auth/weak-password": "Mot de passe trop faible (8 caractères minimum).",
  "auth/operation-not-allowed": "La connexion e-mail / mot de passe n'est pas activée dans Firebase.",
};

$("adminForm").addEventListener("submit", async (e) => {
  if (!e.submitter || e.submitter.value !== "save") return;
  e.preventDefault();
  const email = $("newAdminEmail").value.trim().toLowerCase();
  const role = $("newAdminRole").value;
  const pwd = $("newAdminPwd").value;
  const err = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "Saisissez une adresse e-mail valide."
            : !editing && pwd.length < 8 ? "Le mot de passe provisoire doit faire au moins 8 caractères." : "";
  if (err) { $("adminError").textContent = err; return; }
  $("saveAdminBtn").disabled = true;
  try {
    if (editing) {
      if (await save(editing.id, { email, role }, editing, "Compte mis à jour.")) dlg.close();
      return;
    }
    let uid;
    try { uid = await createAccount(email, pwd); }
    catch (e2) { $("adminError").textContent = CREATE_ERRORS[e2.code] || "Création impossible : " + (e2.code || e2.message); return; }
    const ok = await save(uid, { email, role, disabled: false, createdAt: serverTimestamp(), createdBy: (me && me.email) || "" }, null, null);
    if (!ok) { $("adminError").textContent = "Le compte a été créé mais les droits n'ont pas pu être enregistrés. Réessayez depuis la console Firebase (UID : " + uid + ")."; return; }
    let msg = "Compte créé pour " + email + ".";
    if ($("sendResetOnCreate").checked) {
      try { await sendPasswordReset(email); msg += " Un e-mail lui a été envoyé pour choisir son mot de passe."; }
      catch (e3) { msg += " L'e-mail n'a pas pu être envoyé : communiquez-lui le mot de passe provisoire."; }
    }
    dlg.close();
    toast(msg, "success");
  } finally {
    $("saveAdminBtn").disabled = false;
  }
});
