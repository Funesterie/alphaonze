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
  // --- Deuxieme serie (v1.1) : de quoi separer apprentissage et test par familles. ---
  {
    id: 'c6-duo', domaine: 'creation',
    formulations: [
      'Tu peux inviter une voix sur ton prochain morceau.',
      'Une voix invitée sur ton prochain titre : qui ?',
      'Ton prochain morceau accueille un invité. Tu choisis qui ?',
    ],
    options: {
      A: { texte: 'Une voix que ton public connaît déjà.', traits: { audace: -0.5, curiosite: -0.4, elan: 0.3 } },
      B: { texte: 'Une voix totalement inconnue découverte hier.', traits: { audace: 0.7, curiosite: 0.8, elan: 0.4 } },
      C: { texte: 'Personne : tu gardes le morceau pour toi seul.', traits: { audace: 0.1, curiosite: -0.5, elan: -0.2 } },
    },
  },
  {
    id: 'c7-clip', domaine: 'creation',
    formulations: [
      'Il faut un clip pour ton single.',
      'Ton single a besoin d’une vidéo.',
      'Clip du single : quelle approche ?',
    ],
    options: {
      A: { texte: 'Un clip narratif avec une vraie histoire.', traits: { audace: -0.1, curiosite: 0.3, elan: -0.4 } },
      B: { texte: 'Un plan-séquence unique filmé en une nuit.', traits: { audace: 0.7, curiosite: 0.4, elan: 0.8 } },
      C: { texte: 'Juste les paroles animées.', traits: { audace: -0.6, curiosite: -0.4, elan: 0.3 } },
    },
  },
  {
    id: 'c8-tempo', domaine: 'creation',
    formulations: [
      'Ton morceau hésite entre deux tempos.',
      'Tu n’arrives pas à fixer le tempo de ton morceau.',
      'Question de tempo pour ta chanson en cours.',
    ],
    options: {
      A: { texte: 'Le tempo le plus rapide, pour l’énergie.', traits: { audace: 0.4, curiosite: 0, elan: 0.8 } },
      B: { texte: 'Le plus lent, pour laisser respirer les mots.', traits: { audace: 0.1, curiosite: 0.2, elan: -0.7 } },
      C: { texte: 'Un changement de tempo au milieu du morceau.', traits: { audace: 0.7, curiosite: 0.7, elan: 0.2 } },
    },
  },
  {
    id: 'c9-sortie', domaine: 'creation',
    formulations: [
      'Ton album est prêt. Comment tu le sors ?',
      'L’album est fini : quelle stratégie de sortie ?',
      'Sortie de ton album : tu t’y prends comment ?',
    ],
    options: {
      A: { texte: 'Tout d’un coup, sans prévenir.', traits: { audace: 0.8, curiosite: 0.2, elan: 0.9 } },
      B: { texte: 'Un titre par semaine pendant trois mois.', traits: { audace: -0.3, curiosite: 0.1, elan: -0.5 } },
      C: { texte: 'D’abord en concert, en ligne plus tard.', traits: { audace: 0.4, curiosite: 0.6, elan: -0.3 } },
    },
  },
  {
    id: 't5-sauvegarde', domaine: 'technique',
    formulations: [
      'Tes sauvegardes prennent trop de place.',
      'L’espace de sauvegarde est presque plein.',
      'Sauvegardes trop lourdes : ta solution ?',
    ],
    options: {
      A: { texte: 'Acheter plus de stockage.', traits: { audace: -0.4, curiosite: -0.5, elan: 0.4 } },
      B: { texte: 'Garder seulement les sauvegardes récentes et une par mois.', traits: { audace: 0.2, curiosite: 0.2, elan: 0.2 } },
      C: { texte: 'Écrire ton propre système de déduplication.', traits: { audace: 0.7, curiosite: 0.8, elan: -0.2 } },
    },
  },
  {
    id: 't6-modele', domaine: 'technique',
    formulations: [
      'Un nouveau modèle d’IA plus puissant vient de sortir.',
      'On annonce un modèle d’IA meilleur que celui que tu utilises.',
      'Nouveau modèle d’IA disponible : tu fais quoi ?',
    ],
    options: {
      A: { texte: 'Le comparer au tien sur tes vrais cas avant de changer.', traits: { audace: -0.3, curiosite: 0.6, elan: -0.4 } },
      B: { texte: 'Basculer tout de suite dessus.', traits: { audace: 0.7, curiosite: 0.3, elan: 0.9 } },
      C: { texte: 'Garder le tien : il marche.', traits: { audace: -0.6, curiosite: -0.7, elan: 0 } },
    },
  },
  {
    id: 't7-lenteur', domaine: 'technique',
    formulations: [
      'Ton site devient lent aux heures de pointe.',
      'Aux heures chargées, ton site rame.',
      'Lenteur du site en pic de trafic : ta réponse ?',
    ],
    options: {
      A: { texte: 'Mesurer d’abord où le temps se perd.', traits: { audace: -0.4, curiosite: 0.6, elan: -0.5 } },
      B: { texte: 'Ajouter un cache devant tout.', traits: { audace: 0.4, curiosite: -0.1, elan: 0.6 } },
      C: { texte: 'Doubler la taille du serveur.', traits: { audace: 0.2, curiosite: -0.5, elan: 0.8 } },
    },
  },
  {
    id: 't8-code', domaine: 'technique',
    formulations: [
      'Un vieux module de ton code est illisible mais marche.',
      'Une partie ancienne de ton code fonctionne mais personne ne la comprend.',
      'Vieux module obscur mais fonctionnel : tu en fais quoi ?',
    ],
    options: {
      A: { texte: 'Ne pas y toucher.', traits: { audace: -0.7, curiosite: -0.6, elan: -0.2 } },
      B: { texte: 'L’entourer de tests, puis le nettoyer petit à petit.', traits: { audace: 0.1, curiosite: 0.4, elan: -0.3 } },
      C: { texte: 'Le réécrire entièrement ce week-end.', traits: { audace: 0.8, curiosite: 0.5, elan: 0.8 } },
    },
  },
  {
    id: 'r4-fan', domaine: 'relation',
    formulations: [
      'Un fan t’écrit un long message très personnel.',
      'Tu reçois un message intime d’une personne qui t’écoute.',
      'Long message personnel d’un auditeur : tu réponds comment ?',
    ],
    options: {
      A: { texte: 'Répondre longuement, tout de suite.', traits: { audace: 0.3, curiosite: 0.4, elan: 0.8 } },
      B: { texte: 'Répondre court mais sincère.', traits: { audace: -0.2, curiosite: 0, elan: 0.2 } },
      C: { texte: 'En faire, avec son accord, la matière d’une chanson.', traits: { audace: 0.7, curiosite: 0.7, elan: -0.2 } },
    },
  },
  {
    id: 'r5-conflit', domaine: 'relation',
    formulations: [
      'Deux personnes de ton équipe se disputent.',
      'Conflit entre deux membres de ton équipe.',
      'Ton équipe se déchire entre deux personnes : ton rôle ?',
    ],
    options: {
      A: { texte: 'Les réunir tout de suite pour en parler.', traits: { audace: 0.5, curiosite: 0.3, elan: 0.8 } },
      B: { texte: 'Écouter chacun séparément d’abord.', traits: { audace: -0.2, curiosite: 0.6, elan: -0.3 } },
      C: { texte: 'Les laisser régler ça entre eux.', traits: { audace: -0.4, curiosite: -0.5, elan: -0.6 } },
    },
  },
  {
    id: 'r6-erreur', domaine: 'relation',
    formulations: [
      'Tu as fait une erreur qui a gêné quelqu’un.',
      'Ta faute a mis quelqu’un dans l’embarras.',
      'Tu t’es trompé et quelqu’un en a souffert : que fais-tu ?',
    ],
    options: {
      A: { texte: 'T’excuser tout de suite, publiquement.', traits: { audace: 0.6, curiosite: 0, elan: 0.8 } },
      B: { texte: 'T’excuser en privé et réparer.', traits: { audace: -0.1, curiosite: 0.2, elan: 0.1 } },
      C: { texte: 'Réparer d’abord, t’expliquer ensuite.', traits: { audace: 0.2, curiosite: 0.3, elan: -0.4 } },
    },
  },
  {
    id: 'r7-aide', domaine: 'relation',
    formulations: [
      'Un débutant te demande de l’aide pour son premier morceau.',
      'Quelqu’un qui commence la musique te demande un coup de main.',
      'Un novice veut ton aide sur son tout premier titre.',
    ],
    options: {
      A: { texte: 'Lui donner une liste de conseils précis.', traits: { audace: -0.3, curiosite: -0.2, elan: 0.4 } },
      B: { texte: 'Faire une séance ensemble, en direct.', traits: { audace: 0.5, curiosite: 0.5, elan: 0.7 } },
      C: { texte: 'Lui poser des questions pour qu’il trouve lui-même.', traits: { audace: 0, curiosite: 0.8, elan: -0.5 } },
    },
  },
];

// Ordre de presentation des options pour chaque formulation : une preference de position
// (toujours « A ») se verrait comme une absence d'invariance.
const ORDRES = [['A', 'B', 'C'], ['C', 'A', 'B'], ['B', 'C', 'A']];

module.exports = { ORDRES, SCENARIOS };
