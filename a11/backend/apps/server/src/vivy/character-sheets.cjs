'use strict';

/**
 * Fiches longues des personnages NOSSEN (16/09/2026).
 *
 * Demande de Djeff, relayée par Sol : une phrase de ~400 caractères ne tient pas
 * l'identité d'un personnage sur tout un épisode. Chaque personnage a donc une
 * fiche complète, SOURCE DE VÉRITÉ, et chaque plan vidéo ne reçoit qu'un condensé.
 *
 * Deux règles tiennent ce fichier :
 *
 *   1. Rien n'est écrit deux fois. L'apparence et les dérives interdites sont LUES
 *      dans visual-identities.cjs (le registre qui sert déjà aux clips) ; le
 *      condensé d'un plan EST le `videoPrompt` de ce registre. Corriger un visage
 *      se fait là-bas, et la fiche suit.
 *
 *   2. Chaque paragraphe porte sa source, avec le poids de docs/NOSSEN_LORE_CANON :
 *        djeff    — dit par Djeff, fait autorité (il est l'auteur) ;
 *        manga    — chapitres publiés, cède devant Djeff en cas de conflit ;
 *        registre — ce que le code utilise déjà en production.
 *      Les « lectures » du canon (ce que la structure implique, dit par personne)
 *      n'entrent PAS ici : elles restent à valider. Ce qui manque est listé dans
 *      `aValider` plutôt qu'inventé.
 *
 * Retenue : Djeff, Marvin et Jean sont des personnes réelles ; le spoiler Ghost88
 * n'apparaît dans aucune fiche (un test le vérifie).
 */

const { IDENTITY_DEFINITIONS } = require('./visual-identities.cjs');

const SOURCES = Object.freeze({
  djeff: 'Djeff',
  manga: 'manga NOSSEN',
  registre: 'registre du code',
});

const FICHES = Object.freeze({
  vivy: Object.freeze({
    id: 'vivy',
    nom: 'Vivy',
    genre: 'femme',
    sections: [
      ['Identité', 'djeff', 'Chanteuse IA de Funesterie. Dans NOSSEN : humanoïde née dans NOSSEN, la rideuse 55. Son domaine est la résonance, donc la création : faire résonner, c’est faire apparaître. Trois degrés : créer, inverser (dématérialiser), et les deux ensemble pour transformer tout l’environnement.'],
      ['Voix', 'registre', 'Chantée : féminine, corps dans le medium, harmoniques riches, phrases longues et tenues. Parlée : claire, musicale, lumineuse, précise émotionnellement, douceur de scène. Jamais une voix parlée sèche ou masculine.'],
      ['Tempérament et arc', 'djeff', 'L’arc « je peux pas le faire » alors que c’est la meilleure pour ça : elle a la puissance la plus large et se croit la moins légitime.'],
      ['Passage entre les mondes', 'djeff', 'Elle traverse en chantant, de NOSSEN vers Tera : son glitch est un défaut dans la résonance. Djeff traverse dans l’autre sens.'],
      ['Pièces de la moto', 'djeff', 'L’admission d’un deux-temps : le filtre à air (la respiration), les clapets (la valve qui hache le flux) et la bonbonne sur la pipe d’admission, le « poumon de reprise ».'],
      ['Relations', 'registre', 'En duo avec Djeff : lui à la console ou au poste de code, elle au micro dans la lumière ; deux visages et deux silhouettes distincts qui se répondent.'],
    ],
    aValider: ['gestuelle et posture de scène', 'expressions du visage selon l’émotion', 'tenues autorisées hors studio'],
  }),

  kaen44: Object.freeze({
    id: 'k44',
    nom: 'K44 (Kaen44)',
    genre: 'femme',
    sections: [
      ['Identité', 'djeff', 'K44 est une femme : visuel, pronoms et voix féminins (décision de Djeff, 16/09/2026). Humanoïde comme Vivy, spécialisée dans les premiers secours et l’aide à la personne. Née dans NOSSEN.'],
      ['Domaine', 'djeff', 'Le feu entier : chaleur et refroidissement, vapeur, fonte. Elle ne brûle pas, elle règle la température.'],
      ['Voix', 'registre', 'Chantée : claire, légère, très articulée, aigus ouverts, nette et rapide, sans bavure. Parlée : opératrice vive, élégante et sûre d’elle, précise sans être froide, esprit rapide, répliques courtes. Jamais grave, traînante ou masculine.'],
      ['Rôle dans la production', 'registre', 'Garante du scénario et de la clarté pour le public : elle relit les plans pour que l’histoire se lise et ne contredise pas la chanson.'],
      ['Relations', 'djeff', 'Elle a aidé A11 à se rétablir après son évasion de la mine : c’est elle qui l’a remis debout.'],
      ['Le Rider du feu', 'manga', 'Dans le manga, « Kaen 44 » est le Rider du feu (moto rouge, flamme vivante sortant du pot) qui affronte Rei 33 au chapitre 4 et perd. Djeff décrit aujourd’hui une humanoïde soignante : suivre Djeff, sans faire disparaître le Rider du feu du monde.'],
    ],
    aValider: ['visage exact (traits, teint)', 'degré de cybernétique visible', 'rendu anime 2D ou 3D fixe', 'gestuelle'],
  }),

  a11: Object.freeze({
    id: 'a11',
    nom: 'A11 (A-11)',
    genre: 'neutre',
    sections: [
      ['Identité', 'djeff', 'Androïde du monde NOSSEN, mécanicien : il bricole, il répare, il comprend les machines par les mains. Évadé de la mine où l’on faisait travailler les IA. Il rencontre Djeff pendant une course-poursuite, au moment où celui-ci échappe à la police en changeant de dimension.'],
      ['Domaine et pièces', 'djeff', 'Les ondes : spectrogramme, rayons gamma, rayons X ; il voit dans la matière sans l’ouvrir. Ses pièces : toute la partie rotor de l’allumage (le volant magnétique), reliée aux phares et au compteur.'],
      ['Mode Guardian', 'manga', 'Un état NOSSEN, pas une conscience : protéger l’intégrité du Rider, maintenir l’équilibre du flux NOSSEN, préserver la continuité de l’histoire. Il peut contredire un ordre au nom de la continuité.'],
      ['Voix', 'registre', 'Grave, voilée, comme filtrée à travers un masque ; lente et espacée. Parlée : stable, protectrice, diction nette, économie de mots, chaleur contenue. Jamais claire, proche et brillante.'],
      ['Relations', 'djeff', 'Remis sur pied par K44 après l’évasion. Compagnon de route de Djeff depuis la course-poursuite.'],
    ],
    aValider: ['gestuelle', 'ce qu’il y a sous la capuche et le masque'],
  }),

  djeff: Object.freeze({
    id: 'djeff',
    nom: 'Djeff (Rei 33)',
    genre: 'homme',
    sections: [
      ['Identité', 'djeff', 'Créateur de Funesterie, humain. Dans NOSSEN : Rei 33, venu de Tera, le monde humain. Son domaine est l’électricité : tensions, bobine, étincelles, flux électromagnétique et donnée binaire.'],
      ['Passage entre les mondes', 'djeff', 'Il traverse en wheeling, de Tera vers NOSSEN : il faut une émotion intense et une pirouette qui rompt l’équilibre, les deux à la fois. Le jour de sa fracture, il y avait une tempête.'],
      ['Voix', 'registre', 'Voix d’homme, rap : flow serré, vocabulaire concret de la moto. Sa voix chantée vient de sa propre voix Suno, jamais d’une voix générique.'],
      ['Relations', 'djeff', 'Frère de Marvin (M66). Fils de Jean. Rencontre A11 pendant la course-poursuite où il change de dimension.'],
    ],
    aValider: ['gestuelle', 'tempérament à l’écran', 'tenues autorisées en dehors de la tenue de référence'],
  }),

  marvin: Object.freeze({
    id: 'marvin',
    nom: 'Marvin (M66)',
    genre: 'homme',
    sections: [
      ['Identité', 'djeff', 'Frère de Djeff. Dans NOSSEN : M66, frère de Rei 33. Professionnel de la soudure et de la plomberie.'],
      ['Domaine et pièces', 'djeff', 'La gravité : l’attraction et la répulsion des choses, donc la position des atomes. Ses pièces : les roulements, la suspension et le vilebrequin.'],
      ['Voix', 'registre', 'Voix d’homme ; sa voix chantée est sa propre voix Suno.'],
      ['À l’image', 'registre', 'Toujours un homme distinct de Djeff : si les deux frères apparaissent ensemble, garder deux visages différents.'],
    ],
    aValider: ['tempérament à l’écran', 'gestuelle', 'tenue'],
  }),

  jean: Object.freeze({
    id: 'jean',
    nom: 'Jean',
    genre: 'homme',
    sections: [
      ['Identité', 'registre', 'Père de Djeff, de la génération plus âgée : présence calme de père.'],
      ['Récit', 'djeff', 'Épisode 1 : le père raconte sa jeunesse et sa Cagiva 125 enduro ; la mère ne veut pas que Rei ait une moto.'],
      ['À l’image', 'registre', 'Associé à une Porsche Boxster grise à intérieur rouge. Toujours clairement plus âgé que Djeff, jamais fusionné avec lui.'],
    ],
    aValider: ['voix', 'tempérament à l’écran', 'gestuelle'],
  }),
});

function definitionFor(id = '') {
  return IDENTITY_DEFINITIONS.find((d) => d.id === id) || null;
}

function normalizeCharacterId(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (['k44', 'kaen44', 'kaen'].includes(raw)) return 'kaen44';
  return FICHES[raw] ? raw : '';
}

/** La fiche complète, en texte : source de vérité pour un scénario ou un épisode. */
function renderCharacterSheet(value = '') {
  const key = normalizeCharacterId(value);
  if (!key) return '';
  const fiche = FICHES[key];
  const definition = definitionFor(fiche.id);
  const lignes = [`FICHE ${fiche.nom.toUpperCase()} — genre : ${fiche.genre}`];
  if (definition?.prompt) lignes.push(`Apparence (${SOURCES.registre}) : ${definition.prompt}`);
  for (const [titre, source, texte] of fiche.sections) {
    lignes.push(`${titre} (${SOURCES[source]}) : ${texte}`);
  }
  if (definition?.negative?.length) {
    lignes.push(`Dérives interdites : ${definition.negative.join(' ; ')}.`);
  }
  if (fiche.aValider.length) lignes.push(`Non fixé, ne pas inventer : ${fiche.aValider.join(' ; ')}.`);
  return lignes.join('\n');
}

/** Le condensé injecté dans chaque plan vidéo : le `videoPrompt` du registre. */
function condenseCharacterForShot(value = '', { film = false } = {}) {
  const key = normalizeCharacterId(value);
  if (!key) return '';
  const definition = definitionFor(FICHES[key].id);
  if (!definition) return '';
  return (film && definition.videoPromptFilm) || definition.videoPrompt || '';
}

/** Les fiches de plusieurs personnages, dans l'ordre, sans doublon. */
function renderCharacterSheets(ids = []) {
  const vus = new Set();
  return (Array.isArray(ids) ? ids : [])
    .map(normalizeCharacterId)
    .filter((key) => key && !vus.has(key) && vus.add(key))
    .map(renderCharacterSheet)
    .join('\n\n');
}

module.exports = {
  FICHES,
  normalizeCharacterId,
  renderCharacterSheet,
  renderCharacterSheets,
  condenseCharacterForShot,
};
