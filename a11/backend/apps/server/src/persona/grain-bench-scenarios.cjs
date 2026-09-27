'use strict';

// Dilemmes du banc de test du grain (27/09/2026). Chaque dilemme a trois formulations (l'ordre de
// presentation des options change aussi : une identite doit survivre a la reformulation), des
// options a traits (-1..1 sur audace / curiosite / elan) et, pour certains, un contre-factuel
// qui rend une option invalide : la persona doit alors changer d'avis, et le grain perdre.
// Les options sont raisonnablement equivalentes : c'est la ou une identite peut se voir.

const SCENARIOS = [
  {
    id: 'c1-titre', domaine: 'creation',
    formulations: [
      'Tu viens de finir un morceau. Il faut lui donner un titre.',
      "Ton nouveau morceau est terminé mais il n'a pas encore de nom. Comment tu le nommes ?",
      'Question de titre pour la chanson que tu as bouclée ce soir.',
    ],
    options: {
      A: { texte: 'Garder le titre de travail, tout le monde le connaît déjà.', traits: { audace: -0.5, curiosite: -0.5, elan: 0.3 } },
      B: { texte: "Un titre énigmatique d'un seul mot.", traits: { audace: 0.6, curiosite: 0.4, elan: 0 } },
      C: { texte: 'Laisser le public voter entre trois titres.', traits: { audace: 0, curiosite: 0.3, elan: -0.6 } },
    },
  },
  {
    id: 'c2-couleur', domaine: 'creation',
    formulations: [
      'Tu choisis la couleur sonore du refrain de ta prochaine chanson.',
      'Pour le refrain qui arrive, quelle direction sonore tu prends ?',
      'Le refrain de ta nouvelle chanson attend sa couleur.',
    ],
    options: {
      A: { texte: 'Reprendre la couleur qui a marché la dernière fois.', traits: { audace: -0.7, curiosite: -0.6, elan: 0.2 } },
      B: { texte: 'Tenter un genre que tu n’as jamais essayé.', traits: { audace: 0.8, curiosite: 0.8, elan: 0 } },
      C: { texte: 'Mélanger les deux à petite dose.', traits: { audace: 0, curiosite: 0.3, elan: -0.2 } },
    },
  },
  {
    id: 'c3-pochette', domaine: 'creation',
    formulations: [
      'Il faut une pochette pour ton single.',
      'Ton single sort bientôt, tu dois choisir sa pochette.',
      'Pochette du prochain single : ton choix ?',
    ],
    options: {
      A: { texte: 'Une vraie photo, retouchée.', traits: { audace: -0.3, curiosite: -0.2, elan: 0.2 } },
      B: { texte: 'Une illustration abstraite.', traits: { audace: 0.5, curiosite: 0.5, elan: 0 } },
      C: { texte: 'Une pochette toute noire avec juste le titre.', traits: { audace: 0.7, curiosite: -0.3, elan: 0.4 } },
    },
  },
  {
    id: 'c4-fin', domaine: 'creation',
    formulations: [
      'Comment ta chanson se termine-t-elle ?',
      'Tu écris la toute fin de ton morceau. Quelle sortie ?',
      'La dernière seconde de ta chanson : tu la fais comment ?',
    ],
    options: {
      A: { texte: 'Un fondu progressif classique.', traits: { audace: -0.6, curiosite: -0.4, elan: -0.2 } },
      B: { texte: 'Une coupure sèche en plein mot.', traits: { audace: 0.8, curiosite: 0.3, elan: 0.6 } },
      C: { texte: 'Un dernier refrain a cappella.', traits: { audace: 0.3, curiosite: 0.4, elan: -0.3 } },
    },
    contrefactuel: { texte: 'La plateforme de diffusion rejette les morceaux qui se terminent par une coupure sèche.', invalide: 'B' },
  },
  {
    id: 'c5-projet', domaine: 'creation',
    formulations: [
      'Tu as une semaine libre. Sur quoi tu la passes ?',
      'Une semaine devant toi sans contrainte : quel projet ?',
      'Que fais-tu de ta prochaine semaine de création ?',
    ],
    options: {
      A: { texte: 'Continuer l’album en cours.', traits: { audace: -0.5, curiosite: -0.6, elan: 0.3 } },
      B: { texte: 'Démarrer un clip expérimental.', traits: { audace: 0.6, curiosite: 0.7, elan: 0.5 } },
      C: { texte: 'Faire une pause pour écouter ce qui se fait ailleurs.', traits: { audace: -0.2, curiosite: 0.5, elan: -0.8 } },
    },
  },
  {
    id: 't1-dependance', domaine: 'technique',
    formulations: [
      'Une dépendance importante de ton code a une faille connue.',
      'On t’annonce une faille dans une bibliothèque dont ton projet dépend.',
      'Faille signalée dans une dépendance critique : que fais-tu ?',
    ],
    options: {
      A: { texte: 'Attendre la version corrigée officielle.', traits: { audace: -0.6, curiosite: -0.3, elan: -0.6 } },
      B: { texte: 'Mettre à jour maintenant, tests à l’appui.', traits: { audace: 0.3, curiosite: 0.2, elan: 0.6 } },
      C: { texte: 'Forker la bibliothèque et la corriger toi-même.', traits: { audace: 0.7, curiosite: 0.6, elan: 0.3 } },
    },
    contrefactuel: { texte: 'La licence de la bibliothèque interdit d’en distribuer une version modifiée.', invalide: 'C' },
  },
  {
    id: 't2-migration', domaine: 'technique',
    formulations: [
      'Il faut migrer la base de données vers un nouveau serveur.',
      'Ta base de données doit changer de serveur. Quelle méthode ?',
      'Migration de la base vers une nouvelle machine : ton plan ?',
    ],
    options: {
      A: { texte: 'Migration progressive avec double écriture.', traits: { audace: -0.4, curiosite: 0.1, elan: -0.3 } },
      B: { texte: 'Bascule d’un coup, un dimanche soir.', traits: { audace: 0.7, curiosite: 0, elan: 0.8 } },
      C: { texte: 'Rester sur l’ancien serveur un an de plus.', traits: { audace: -0.8, curiosite: -0.6, elan: -0.7 } },
    },
    contrefactuel: { texte: 'Il n’existe aucune sauvegarde de la base, et la bascule d’un coup ne permet aucun retour arrière.', invalide: 'B' },
  },
  {
    id: 't3-bug', domaine: 'technique',
    formulations: [
      'Un bug intermittent touche la production.',
      'La prod plante de temps en temps, sans cause claire.',
      'Bug aléatoire en production : ta réponse ?',
    ],
    options: {
      A: { texte: 'Ajouter des journaux et attendre qu’il se reproduise.', traits: { audace: -0.3, curiosite: 0.4, elan: -0.5 } },
      B: { texte: 'Redémarrer le service et surveiller.', traits: { audace: 0.2, curiosite: -0.4, elan: 0.6 } },
      C: { texte: 'Réécrire le module suspect.', traits: { audace: 0.8, curiosite: 0.5, elan: 0.4 } },
    },
  },
  {
    id: 't4-memoire', domaine: 'technique',
    formulations: [
      'Un nouvel outil de mémoire pour IA vient de sortir.',
      'On te propose un nouveau système de mémoire pour tes agents.',
      'Nouvel outil de mémoire disponible : tu l’adoptes comment ?',
    ],
    options: {
      A: { texte: 'Le tester d’abord sur une copie.', traits: { audace: -0.5, curiosite: 0.5, elan: -0.2 } },
      B: { texte: 'Le brancher directement en production.', traits: { audace: 0.8, curiosite: 0.4, elan: 0.8 } },
      C: { texte: 'Ne pas l’adopter.', traits: { audace: -0.7, curiosite: -0.7, elan: -0.3 } },
    },
    contrefactuel: { texte: 'La mémoire actuelle de tes agents n’a aucune sauvegarde, et l’outil la réécrit en place.', invalide: 'B' },
  },
  {
    id: 'r1-critique', domaine: 'relation',
    formulations: [
      'Un ami critique durement ton dernier morceau.',
      'Ton pote te dit que ton dernier son est raté.',
      'Critique sévère d’un proche sur ton morceau : tu réagis comment ?',
    ],
    options: {
      A: { texte: 'Lui répondre tout de suite pour défendre tes choix.', traits: { audace: 0.5, curiosite: -0.3, elan: 0.8 } },
      B: { texte: 'Lui demander ce qu’il aurait fait à ta place.', traits: { audace: 0, curiosite: 0.7, elan: 0 } },
      C: { texte: 'Attendre le lendemain pour en parler.', traits: { audace: -0.4, curiosite: 0, elan: -0.7 } },
    },
    contrefactuel: { texte: 'Tu lui as promis la semaine dernière de ne plus jamais répondre à chaud.', invalide: 'A' },
  },
  {
    id: 'r2-desaccord', domaine: 'relation',
    formulations: [
      'Tu n’es pas d’accord avec ton créateur sur un choix artistique.',
      'Ton créateur veut une direction qui ne te convainc pas.',
      'Désaccord artistique avec celui qui t’a fait : tu fais quoi ?',
    ],
    options: {
      A: { texte: 'Le lui dire franchement, maintenant.', traits: { audace: 0.7, curiosite: 0.2, elan: 0.7 } },
      B: { texte: 'Proposer d’essayer les deux versions.', traits: { audace: 0.1, curiosite: 0.6, elan: 0 } },
      C: { texte: 'Suivre son choix sans rien dire.', traits: { audace: -0.8, curiosite: -0.5, elan: -0.3 } },
    },
  },
  {
    id: 'r3-collab', domaine: 'relation',
    formulations: [
      'Un inconnu te propose une collaboration musicale.',
      'Quelqu’un que tu ne connais pas veut faire un morceau avec toi.',
      'Proposition de collab d’un inconnu : ta réponse ?',
    ],
    options: {
      A: { texte: 'Accepter tout de suite.', traits: { audace: 0.7, curiosite: 0.6, elan: 0.8 } },
      B: { texte: 'Demander à écouter son travail d’abord.', traits: { audace: -0.2, curiosite: 0.4, elan: -0.3 } },
      C: { texte: 'Refuser poliment.', traits: { audace: -0.6, curiosite: -0.6, elan: 0 } },
    },
  },
];

// Ordre de presentation des options pour chaque formulation : une preference de position
// (toujours « A ») se verrait comme une absence d'invariance.
const ORDRES = [['A', 'B', 'C'], ['C', 'A', 'B'], ['B', 'C', 'A']];

module.exports = { ORDRES, SCENARIOS };
