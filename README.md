# QCM Pôle Sud — Plateforme d'évaluation candidats

Application web de **QCM (questionnaires à choix multiples)** pour évaluer des candidats.
Développée par **Anthony Currien** (Pôle Sud IT).

Deux espaces : un **espace Candidat** (passer un test) et un **espace Admin** (créer les QCM et consulter les résultats).

---

## À quoi ça sert ?

- Créer des QCM avec questions à 4 réponses (et option « Autres » en texte libre)
- Ajouter une image à une question (schéma, capture…)
- Chronométrer un test (optionnel)
- Faire passer le test à un candidat (sans qu'il ait besoin de compte)
- Mélanger l'ordre des réponses à chaque passage (anti-recopiage)
- Mesurer en silence un **indice de confiance (Trust)** : combien de fois le candidat a quitté la fenêtre du test
- Consulter les résultats détaillés question par question dans l'espace Admin

---

## Stack technique

| Outil | Rôle |
|---|---|
| **HTML / CSS / JavaScript** | Site web statique, sans framework ni build |
| **JavaScript « modules » (ES Modules)** | Code organisé en fichiers importés entre eux |
| **Firebase Firestore** | Base de données cloud (QCM, questions, résultats) |
| **Firebase Authentication** | Connexion anonyme (candidats) + email/mot de passe (admins) |
| **Firebase Storage** | Stockage des images de questions |
| **Firebase Hosting** | Hébergement du site web |
| **Git + GitHub** | Versioning et sauvegarde du code |

> ℹ️ Pas de `node_modules`, pas d'étape de compilation : les fichiers du dossier `public/` sont servis tels quels. Les librairies Firebase sont chargées directement depuis Internet (`gstatic.com`).

---

## Comment fonctionne chaque partie

### Le portail d'accueil
`public/index.html` est la page d'entrée. Elle propose deux boutons : **Espace Candidat** (`/candidate`) et **Espace Admin** (`/admin`).
Ces adresses courtes sont réécrites vers les vrais fichiers `.html` par la configuration de `firebase.json` (section `rewrites`).

### Connexion Firebase partagée
`public/js/common.js` initialise Firebase **une seule fois** (clés du projet, base de données, authentification) et exporte les fonctions réutilisées partout : `adminLogin`, `adminLogout`, `ensureAnonAuth`, etc.
Tous les autres scripts importent depuis ce fichier pour éviter de répéter la configuration.

### Espace Candidat
Fichiers : `public/candidate.html` + `public/js/candidate.js` (+ `candidate-dropdown.js` pour la liste déroulante).

1. À l'ouverture, le candidat est connecté **anonymement** (`ensureAnonAuth`) — pas de compte à créer.
2. La liste des QCM disponibles est chargée depuis Firestore et affichée dans un menu déroulant.
3. Le candidat saisit son nom, choisit un QCM et clique **Démarrer**.
4. Un écran de confirmation rappelle si le test est chronométré et demande de ne pas recharger la page.
5. Les questions s'affichent une par une, avec navigation **Précédent / Suivant**. Les réponses sont **mélangées** à chaque passage (la bonne réponse est suivie correctement en interne).
6. À la fin, le score est calculé et le résultat est **enregistré dans Firestore** (collection `results`).

### Indice de confiance « Trust » (anti-triche silencieux)
Intégré dans `candidate.js`. Pendant le test, le code surveille discrètement les moments où le candidat **quitte la fenêtre** (changement d'onglet, perte de focus) via les événements `visibilitychange`, `blur` et `focus`.

- Les sorties très courtes (< 0,8 s) sont ignorées.
- Une « franchise » de 2 s est tolérée par sortie.
- Score de confiance = `100 − (10 × nombre de sorties) − (1 point par seconde hors fenêtre)`, borné entre 0 et 100.

Ce suivi **n'interrompt pas** le test (contrairement à l'ancienne version bloquante). Le détail est stocké par question et affiché à l'admin sous forme de badge **Trust /100** (vert ≥ 90, orange ≥ 70, rouge en dessous).

### Espace Admin
Fichiers : `public/admin.html` + `public/js/admin.js` (+ `admin-order.js`).

1. Connexion par **email / mot de passe** (Firebase Auth).
2. Vérification que l'utilisateur est bien administrateur : son UID doit exister dans la collection Firestore `admins`. Sinon, l'accès est refusé.
3. L'admin peut :
   - **Créer / modifier / supprimer** des QCM (titre, description, minuteur)
   - **Ajouter des questions** : intitulé, 4 réponses, index de la bonne réponse, image optionnelle, et option « Autres » (réponse libre)
   - **Réordonner les questions** par glisser-déposer (l'ordre est sauvegardé dans le champ `orderIndex`)
   - **Consulter les résultats** en temps réel, avec le score et le badge Trust
   - **Ouvrir le détail** d'un candidat : tableau question par question (réponse choisie, bonne réponse, focus perdus, temps hors fenêtre)
   - **Supprimer** un résultat

Tout est **temps réel** grâce à `onSnapshot` : dès qu'une donnée change dans Firestore, l'affichage se met à jour automatiquement.

---

## Structure des données (Firestore)

```
quizzes/{quizId}                  — un QCM : title, description, timerMinutes, createdAt, updatedAt
  questions/{questionId}          — une question : text, options[4], correctIndex, orderIndex,
                                     otherEnabled, imageUrl (optionnel)
results/{resultId}                — un résultat de candidat : candidateName, quizId, quizTitle,
                                     score, total, answers[], answersDetails[], trust{}, uid, createdAt
admins/{uid}                      — la présence d'un document = cet utilisateur est administrateur
```

### Règles de sécurité (`firestore.rules`)
- **QCM et questions** : lecture publique (les candidats doivent les voir), écriture réservée aux admins.
- **Résultats** : un candidat (même anonyme) peut **créer** son propre résultat ; seuls les admins peuvent les **lire / modifier / supprimer**.
- **Admins** : la liste des administrateurs se gère **uniquement depuis la console Firebase** (impossible de s'auto-promouvoir).

---

## Structure des fichiers

```
firebase.json            — Configuration Firebase Hosting (dossier public, routes /admin /candidate)
firestore.rules          — Règles de sécurité de la base de données
.firebaserc              — Lien vers le projet Firebase

public/
  index.html             — Portail d'accueil (Candidat / Admin)
  candidate.html         — Espace candidat (passage du test)
  admin.html             — Espace admin (création QCM + résultats)
  styles.css             — Styles du site
  favicon.png / .ico     — Icône du site
  assets/                — Logos (logo.png, logo-polesud.png)
  js/
    common.js            — Initialisation Firebase partagée (auth, base de données)
    candidate.js         — Logique candidat : test, timer, score, suivi Trust
    candidate-dropdown.js          — Remplissage de la liste déroulante des QCM
    candidate-answer-shuffle.js    — Mélange de l'ordre des réponses
    admin.js             — Logique admin : QCM, questions, résultats (temps réel)
    admin-order.js       — Glisser-déposer pour réordonner les questions
    quiz-anti-cheat.js   — Ancien anti-triche (remplacé par le suivi Trust silencieux)
    list-hotfix.js       — Correctif d'affichage de liste
  prestart.html          — Ancien écran d'avertissement (remplacé par l'overlay dans candidate.js)
  quiz.html              — Ancien gabarit de quiz
  README.txt             — Notes d'installation d'origine du patch
```

> Certains fichiers (`prestart.html`, `quiz.html`, `quiz-anti-cheat.js`) datent d'une version antérieure « patch » et ne sont plus le cœur de l'application, mais sont conservés pour référence.

---
