// js/quiz-anti-cheat.js
function endNow(){
  if (typeof window.endQuizDueToCheat === "function") {
    window.endQuizDueToCheat();
    return;
  }
  window.dispatchEvent(new CustomEvent('anti-cheat-trigger'));
  try{ location.href = "candidate.html?ended=cheat"; }catch{}
}
function armed(){ return sessionStorage.getItem("antiCheatEnabled") === "1"; }
function handleVisibility(){ if (!armed()) return; if (document.hidden) { alert("Anti‑triche : la fenêtre a perdu le focus. Le test est terminé."); endNow(); } }
function handleBlur(){ if (!armed()) return; alert("Anti‑triche : changement de fenêtre détecté. Le test est terminé."); endNow(); }
export function enableAntiCheat(){ document.addEventListener("visibilitychange", handleVisibility, { passive:true }); window.addEventListener("blur", handleBlur, { passive:true }); console.log("[anti-cheat] activé"); }
