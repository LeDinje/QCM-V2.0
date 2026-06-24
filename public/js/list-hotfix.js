import { db, collection, getDocs } from "./common.js";

(function(){
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function findSelect(){
    return document.getElementById('quizSelect')
        || document.querySelector('select[name="quizId"]')
        || document.querySelector('#qcmSelect')
        || document.querySelector('select[name="quiz"]')
        || document.querySelector('select');
  }
  async function fill(){
    const sel = findSelect();
    if (!sel){ console.warn('[list-hotfix] select not found'); return; }
    try{
      // default placeholder
      sel.innerHTML = '<option value="">— Sélectionner un QCM —</option>';
      const snap = await getDocs(collection(db, 'quizzes'));
      const items = [];
      snap.forEach(d => {
        const q = d.data() || {};
        if (q.archived === true) return; // inclut les docs sans champ archived
        const title = q.title || 'Sans titre';
        const timer = Number(q.timerMinutes || 0);
        items.push({ id: d.id, title, timer });
      });
      items.sort((a,b)=> (a.title||'').localeCompare(b.title||''));
      if (!items.length){
        sel.innerHTML = '<option value="">Aucun QCM disponible</option>';
        sel.disabled = true;
        return;
      }
      sel.disabled = false;
      const out = ['<option value="">— Sélectionner un QCM —</option>']
        .concat(items.map(o => `<option value="${o.id}" data-timer="${o.timer}">${escapeHtml(o.title)}</option>`))
        .join('');
      sel.innerHTML = out;
      // update meta if exists
      const meta = document.getElementById('quizMeta');
      if (meta){
        sel.addEventListener('change', () => {
          const opt = sel.options[sel.selectedIndex];
          const minutes = Number(opt?.dataset?.timer || 0);
          if (!opt.value){ meta.textContent = ''; return; }
          meta.textContent = minutes > 0
            ? `Ce QCM est chronométré : ${minutes} min.`
            : `Ce QCM n’est pas chronométré.`;
        }, { once: true });
      }
      console.log('[list-hotfix] loaded', items.length, 'quizzes');
    }catch(e){
      console.error('[list-hotfix] error:', e);
      sel.innerHTML = '<option value="">Erreur de chargement</option>';
    }
  }
  document.addEventListener('DOMContentLoaded', fill);
})();