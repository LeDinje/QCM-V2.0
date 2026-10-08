# QCM Pôle Sud — Plateforme d'évaluation candidats

Application web de **QCM (questionnaires à choix multiples)** pour évaluer des candidats.
Développée par **Anthony Currien** (Pôle Sud IT).

Deux espaces : un **espace Candidat** (passer un test) et un **espace Admin** (créer les QCM et consulter les résultats).

---

## À quoi ça sert ?

- Créer des QCM avec questions à 4 réponses (et option « Autre réponse » en texte libre)
- Ajouter une image à une question (schéma, capture…)
- Chronométrer un test (optionnel), masquer un QCM aux candidats, le dupliquer
- Envoyer au candidat un **lien direct** vers son QCM (`candidate.html?quiz=ID`)
- Faire passer le test à un candidat (sans qu'il ait besoin de compte), réponses mélangées à chaque passage
- **Protéger les bonnes réponses** : elles ne sont jamais envoyées au navigateur du candidat
- Conserver la progression du candidat en cas de rechargement accidentel
- Mesurer en silence un **indice de confiance (Trust)** : sorties de fenêtre et rechargements
- Consulter les résultats (recherche, indicateurs, **export CSV**, **taux de réussite par question**, détail candidat)

---

## Stack technique

| Outil | Rôle |
|---|---|
| **HTML / CSS / JavaScript** | Site web statique, sans framework ni build |
| **JavaScript « modules » (ES Modules)** | Code organisé en fichiers importés entre eux |
| **Firebase Firestore** | Base de données cloud (QCM, questions, bonnes réponses, résultats) |
| **Firebase Authentication** | Connexion anonyme (candidats) + email/mot de passe (admins) |
| **Firebase Storage** | Stockage des images de questions |
| **Firebase Hosting** | Hébergement du site web |
| **Git + GitHub** | Versioning et sauvegarde du code |

> ℹ️ Pas de `node_modules`, pas d'étape de compilation : les fichiers du dossier `public/` sont servis tels quels. Les librairies Firebase sont chargées depuis Internet (`gstatic.com`), la police Inter depuis Google Fonts.

---

## Comment fonctionne chaque partie

### Le portail d'accueil
`public/index.html` est la page d'entrée : deux cartes **Espace candidat** et **Espace administrateur**, un lien vers les notes de version et le bouton de thème clair/sombre.

### Design
`public/styles.css` définit des **jetons de design** (couleurs, rayons, ombres) en haut du fichier. Le thème clair reprend le bleu marine du logo ; le thème sombre s'active automatiquement selon la préférence du système, ou manuellement avec le bouton soleil/lune (mémorisé sur le poste).

### Fichiers JavaScript partagés
- `public/js/common.js` initialise Firebase **une seule fois** et exporte tout ce dont les pages ont besoin (base, authentification, envoi d'images). C'est le seul fichier qui parle directement à Firebase.
- `public/js/ui.js` contient les petits outils d'interface : icônes, notifications, fenêtres de confirmation, thème, formatage des durées, et `esc()` qui **échappe tout texte** avant de l'afficher (empêche un candidat d'injecter du code dans l'espace admin via son nom ou ses réponses).

### Espace Candidat
Fichiers : `public/candidate.html` + `public/js/candidate.js`.

1. Le candidat est connecté **anonymement** — pas de compte à créer.
2. Il saisit son nom et choisit un QCM parmi ceux **visibles** (ou arrive via un lien direct qui le présélectionne).
3. Une fenêtre de consignes rappelle la durée et les règles.
4. Les questions s'affichent une par une : barre de progression, chronomètre, bouton **« À revoir »**, vue d'ensemble des questions, raccourcis clavier (A–D pour répondre, Entrée pour continuer).
5. Un **récapitulatif** liste les questions sans réponse avant l'envoi. À la fin du chrono, l'envoi est automatique.
6. Le résultat est enregistré dans Firestore (collection `results`) **sans score** : le candidat voit un écran de remerciement.

La progression est sauvegardée dans le navigateur (`localStorage`) : après un rechargement, le candidat peut **reprendre** là où il en était (le rechargement est compté et signalé à l'admin). Si l'envoi échoue (réseau), les réponses restent sur le poste et un bouton permet de réessayer.

### Indice de confiance « Trust » (anti-triche silencieux)
Pendant le test, le code surveille discrètement les moments où le candidat **quitte la fenêtre** (changement d'onglet, perte de focus).

- Les sorties très courtes (< 0,8 s) sont ignorées.
- Une « franchise » de 2 s est tolérée par sortie.
- Score de confiance = `100 − (10 × nombre de sorties) − (1 point par seconde hors fenêtre)`, borné entre 0 et 100.

Ce suivi **n'interrompt pas** le test. Le détail est stocké par question et affiché à l'admin (vert ≥ 90, orange ≥ 70, rouge en dessous), avec le nombre de rechargements.

### Espace Admin
Fichiers : `public/admin.html` + `public/js/admin.js`.

1. Connexion par **email / mot de passe** (Firebase Auth). L'UID doit exister dans la collection `admins`, sinon l'accès est refusé.
2. Onglet **Questionnaires** : liste des QCM à gauche (glisser-déposer pour l'ordre), paramètres à droite (titre, description, chrono, visibilité), boutons **Lien candidat / Dupliquer / Supprimer**, liste des questions (glisser-déposer, bonne réponse en vert) et éditeur de question en fenêtre (bonne réponse cochée directement, image, option « Autre réponse »).
3. Onglet **Résultats** : filtre par QCM, recherche par nom, indicateurs (candidats, score moyen, confiance, durée), tableau des résultats, **export CSV** (s'ouvre directement dans Excel), **analyse par question** (taux de réussite et temps moyen) et fenêtre de détail par candidat.

Tout est **temps réel** grâce à `onSnapshot`.

> **Migration v1 → v2** : les questions créées avant la v2 contiennent la bonne réponse (`correctIndex`) dans un champ lisible par tous. L'espace admin affiche alors un bandeau **« Sécuriser maintenant »** qui déplace ces réponses dans `answerKeys` en un clic. Modifier une ancienne question la sécurise aussi automatiquement.

---

## Structure des données (Firestore)

```
quizzes/{quizId}                  — un QCM : title, description, timerMinutes, active, orderIndex, createdAt, updatedAt
  questions/{questionId}          — une question : text, options[4], orderIndex, otherEnabled, imageUrl (optionnel)
                                     (PAS de bonne réponse ici)
answerKeys/{quizId}               — bonnes réponses du QCM : { keys: { questionId: index } } — admins uniquement
results/{resultId}                — un résultat (v: 2) : candidateName, quizId, quizTitle, total, answered,
                                     answers[] (questionId, questionText, options, chosenIndex, otherText, timeMs,
                                     flagged, focusLosses, offWindowMs), durationMs, endedBy, trust{}, uid, createdAt
admins/{uid}                      — la présence d'un document = cet utilisateur est administrateur
```

Le **score** est calculé dans l'espace admin en comparant `chosenIndex` à `answerKeys`. Les anciens résultats (sans `v: 2`) gardent leur score enregistré.

### Règles de sécurité (`firestore.rules`)
- **QCM et questions** : lecture publique, écriture réservée aux admins.
- **Bonnes réponses (`answerKeys`)** : lecture et écriture réservées aux admins.
- **Résultats** : un candidat (même anonyme) peut **créer** son propre résultat au format v2, **sans pouvoir y mettre de score** ; seuls les admins peuvent les lire / modifier / supprimer.
- **Admins** : gérés **uniquement depuis la console Firebase**.

---

## Mise en ligne

```bash
firebase deploy --only hosting,firestore:rules
```

Le **site** et les **règles** doivent toujours être déployés ensemble (le site v2 écrit dans `answerKeys` et envoie des résultats au format v2, que les règles exigent).
Lors du premier déploiement de la v2 : se connecter ensuite à l'espace admin et cliquer sur **« Sécuriser maintenant »** dans le bandeau orange, pour déplacer les bonnes réponses des anciennes questions.

En cas de problème, revenir à la version précédente depuis la console Firebase (Hosting → historique des versions → Restaurer), ou annuler les commits avec `git revert` puis redéployer.

---

## Structure des fichiers

```
firebase.json            — Configuration Firebase Hosting (dossier public, routes /admin /candidate /patchnote)
firestore.rules          — Règles de sécurité de la base de données
.firebaserc              — Lien vers le projet Firebase

public/
  index.html             — Portail d'accueil (Candidat / Admin)
  candidate.html         — Espace candidat (passage du test)
  admin.html             — Espace admin (QCM + résultats)
  patchnote.html         — Notes de version
  styles.css             — Styles du site (jetons de design, thèmes clair/sombre)
  favicon.png / .ico     — Icône du site
  assets/                — Logos (logo.png, logo-polesud.png)
  js/
    common.js            — Initialisation Firebase partagée (auth, base de données, images)
    ui.js                — Outils d'interface (icônes, notifications, thème, échappement HTML)
    candidate.js         — Logique candidat : test, chrono, reprise, suivi Trust, envoi
    admin.js             — Logique admin : QCM, questions, bonnes réponses, résultats (temps réel)
```

---
