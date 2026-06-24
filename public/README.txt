INSTALL — Patch complet (aucun CSS fourni)

Ce dossier contient tous les fichiers nécessaires SANS style.css pour ne rien casser.

CONTENU
- candidate.html  → Charge la liste de QCM, redirige vers prestart.html
- prestart.html   → Affiche durée (timer) + avertissement anti‑triche. Armes anti‑triche.
- quiz.html       → Placeholder; active l’anti‑triche (intègre ton vrai quiz renderer ici)
- js/admin-order.js                → Admin : ordre stable + drag & drop (orderIndex)
- js/candidate-answer-shuffle.js   → Candidat : mélanger l'ordre des réponses uniquement
- js/quiz-anti-cheat.js           → Anti‑triche

INSTRUCTIONS
1) Copie TOUT ce dossier dans ton `public/` (ça n’écrase pas style.css car on ne le fournit pas).
2) Vérifie que `style.css` est présent à côté de `candidate.html` (ton fichier d’origine).
3) Assure-toi que `window.firebaseConfig` est défini avant les scripts (ou ajoute-le).
4) Test :
   - Ouvre /candidate → dropdown rempli, clique Démarrer → /prestart affiche la durée & anti‑triche → Commencer → /quiz avec anti‑triche activée.
5) Admin : importe `./js/admin-order.js` dans admin.html et utilise `listQuestions`, `renderQuestions`, `enableDragAndDrop`, `createQuestion`.

RAPPEL
- Aucune CSS n’est incluse pour éviter toute régression visuelle.
- Le logo est dans /assets/logo.png (tu peux remplacer par le tien).



Patch 2025-09-25: Removed blocking anti-cheat; added silent trust-factor tracking (see js/candidate.js), admin shows Trust badge and per-question focus stats.
