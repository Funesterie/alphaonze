function normalizeSubjectProfileText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )];
}

const RAW_SUBJECT_PROFILES = [
  {
    type: 'reference_character',
    label: 'Personnage de référence Bugs Bunny',
    aliases: ['bugs bunny', 'bugsbunny', 'bugs-bunny'],
    definitionKeywords: ['bugs bunny', 'lapin de dessin animé', 'cartoon rabbit'],
    canonicalSubject: 'Bugs Bunny',
    composition: ['un seul personnage complet', 'visage unique bien lisible', 'pose claire et lisible', 'silhouette reconnaissable'],
    environment: ['fond simple cohérent avec le personnage'],
    styleHints: ['dessin animé classique', 'illustration nette'],
    promptInstruction: 'Représenter un seul personnage de lapin de dessin animé gris et blanc, avec de longues oreilles et un visage reconnaissable.',
  },
  {
    type: 'reference_character',
    label: 'Personnage de référence Zelda',
    aliases: ['zelda', 'princesse zelda', 'princess zelda'],
    definitionKeywords: ['zelda', 'princesse fantasy', 'heroine fantasy', 'héroïne fantasy'],
    canonicalSubject: 'Princesse Zelda',
    composition: ['un seul personnage complet', 'visage unique bien lisible', 'pose claire et lisible', 'silhouette reconnaissable'],
    environment: ['fond simple cohérent avec le personnage'],
    styleHints: ['illustration fantasy nette', 'illustration nette'],
    promptInstruction: 'Représenter clairement le personnage nommé Zelda, une seule femme héroïne fantasy complète et reconnaissable.',
  },
  {
    type: 'reference_character',
    label: 'Personnage de référence Mario',
    aliases: ['mario', 'super mario'],
    definitionKeywords: ['mario', 'plombier de jeu vidéo', 'personnage nintendo', 'nintendo character'],
    canonicalSubject: 'Mario',
    composition: ['un seul personnage complet', 'visage unique bien lisible', 'pose claire et lisible', 'silhouette reconnaissable'],
    environment: ['fond simple cohérent avec le personnage'],
    styleHints: ['illustration de jeu vidéo nette', 'illustration nette'],
    promptInstruction: 'Représenter clairement Mario, un seul personnage moustachu de jeu vidéo, reconnaissable et complet.',
  },
  {
    type: 'reference_character',
    label: 'Personnage de référence Peach',
    aliases: ['princesse peach', 'princess peach', 'peach'],
    definitionKeywords: ['princesse peach', 'princess peach', 'princesse de jeu vidéo', 'nintendo character'],
    canonicalSubject: 'Princesse Peach',
    composition: ['un seul personnage complet', 'visage unique bien lisible', 'pose claire et lisible', 'silhouette reconnaissable'],
    environment: ['fond simple cohérent avec le personnage'],
    styleHints: ['illustration de jeu vidéo nette', 'illustration nette'],
    promptInstruction: 'Représenter clairement la princesse Peach, une seule princesse blonde de jeu vidéo, complète et reconnaissable.',
  },
  {
    type: 'reference_character',
    label: 'Personnage de référence Master Chief',
    aliases: ['master chief', 'john 117', 'john-117', 'spartan 117', 'spartan-117'],
    definitionKeywords: ['master chief', 'halo', 'spartan super soldier', 'super soldat de science fiction'],
    canonicalSubject: 'Master Chief',
    composition: ['un seul personnage complet', 'silhouette reconnaissable', 'armure complète bien lisible', 'pose claire et lisible'],
    environment: ['fond simple cohérent avec le personnage'],
    styleHints: ['illustration science-fiction nette', 'illustration nette'],
    promptInstruction: 'Représenter clairement Master Chief, un seul super-soldat de science-fiction en armure complète, reconnaissable et bien lisible.',
  },
  {
    type: 'reference_character',
    label: 'Personnage de référence',
    aliases: ['gohan', 'goku', 'vegeta', 'naruto', 'boruto', 'sasuke', 'pikachu', 'batman', 'robin', 'donkey kong', 'one piece'],
    definitionKeywords: ['personnage', 'héros', 'hero', 'anime', 'manga', 'fiction'],
    composition: ['un seul personnage complet', 'visage unique bien lisible', 'pose claire et lisible', 'silhouette reconnaissable'],
    environment: ['fond simple cohérent avec le personnage'],
    styleHints: ['illustration nette'],
    promptInstruction: 'Représenter un seul personnage complet et reconnaissable.',
  },
  {
    type: 'pokemon_creature',
    label: 'Pokémon unique',
    aliases: ['pokemon', 'pokémon'],
    definitionKeywords: ['pokemon', 'pokémon'],
    composition: ['un seul pokémon complet', 'visage bien lisible', 'silhouette reconnaissable'],
    environment: ['fond simple cohérent avec le pokémon'],
    styleHints: ['illustration nette'],
    promptInstruction: 'Représenter un seul pokémon complet et reconnaissable.',
  },
  {
    type: 'single_human_figure',
    label: 'Personne unique',
    aliases: [
      'guerrier', 'guerriere', 'guerrière', 'viking', 'vikinge',
      'chevalier', 'chevaliere', 'chevalière', 'ninja', 'pirate',
      'mage', 'magicien', 'magicienne', 'sorcier', 'sorciere', 'sorcière', 'archer',
      'samourai', 'samurai', 'roi', 'reine', 'prince', 'princesse',
      'guerriere nordique', 'guerrière nordique', 'guerrier nordique',
    ],
    definitionKeywords: ['personne', 'humain', 'humaine', 'guerrier', 'guerrière', 'viking', 'personnage'],
    composition: ['une seule personne complète', 'visage unique bien lisible', 'silhouette humaine complète', 'posture claire et lisible'],
    environment: ['fond simple cohérent avec le personnage'],
    styleHints: ['illustration nette'],
    promptInstruction: 'Représenter une seule personne complète et reconnaissable.',
  },
  {
    type: 'simple_food_object',
    label: 'Objet ou aliment simple',
    aliases: [
      'pomme', 'apple', 'poire', 'pear', 'banane', 'banana', 'orange',
      'cerise', 'cherry', 'fraise', 'strawberry', 'tarte', 'pie',
      'gateau', 'gâteau', 'cake', 'tomate', 'tomato', 'carotte', 'carrot',
      'champignon', 'mushroom',
    ],
    definitionKeywords: ['fruit', 'aliment', 'nourriture', 'dessert', 'patisserie', 'pâtisserie', 'legume', 'légume'],
    composition: ['objet unique isolé', 'objet centré', 'plan simple de nature morte'],
    environment: ['fond neutre simple'],
    styleHints: [],
    promptInstruction: "Présenter l'objet seul, bien centré, comme unique sujet principal.",
  },
  {
    type: 'single_plant_object',
    label: 'Plante ou arbre unique',
    aliases: [
      'sapin', 'arbre', 'tree', 'pine tree', 'fir tree', 'fleur', 'flower',
      'plante', 'plant', 'bonsai', 'bonsaï', 'rose', 'orchidee', 'orchidée',
      'tournesol', 'sunflower',
    ],
    definitionKeywords: ['plante', 'arbre', 'végétal', 'vegetal', 'fleur', 'sapin'],
    composition: ['une seule plante complète', 'forme complète visible', 'sujet centré'],
    environment: ['décor naturel simple'],
    styleHints: [],
    promptInstruction: 'Montrer une seule plante ou un seul arbre complet, bien lisible et centré.',
  },
  {
    type: 'container_object',
    label: 'Objet contenant',
    aliases: ['canette', 'canette de soda', 'soda', 'bouteille', 'bottle', 'can'],
    definitionKeywords: ['boisson', 'contenant', 'bottle', 'can'],
    composition: ['objet unique isolé', 'forme complète visible', 'objet centré'],
    environment: ['fond neutre simple'],
    styleHints: [],
    promptInstruction: "Présenter l'objet seul, bien centré, comme unique sujet principal.",
  },
  {
    type: 'single_animal',
    label: 'Animal unique',
    aliases: ['faucon', 'falcon', 'aigle', 'eagle', 'lapin', 'rabbit', 'chat', 'cat', 'chien', 'dog', 'renard', 'fox', 'ours', 'bear', 'herisson', 'hérisson', 'rat', 'tortue', 'turtle'],
    definitionKeywords: ['animal', 'oiseau', 'rapace', 'mammifere', 'mammifère'],
    composition: ['un seul animal complet', 'corps complet bien visible', 'posture claire'],
    environment: ['décor naturel simple'],
    styleHints: [],
    promptInstruction: 'Montrer un seul animal complet et bien lisible.',
  },
  {
    type: 'phoenix_creature',
    label: 'Phénix unique',
    aliases: ['phoenix', 'phénix', 'phenix'],
    definitionKeywords: ['phénix', 'phoenix', 'oiseau mythique'],
    composition: ['un seul phénix complet', 'ailes bien lisibles', 'silhouette majestueuse'],
    environment: ['ciel simple avec profondeur'],
    styleHints: [],
    promptInstruction: 'Représenter un seul phénix complet avec des ailes bien lisibles.',
  },
  {
    type: 'mythic_creature',
    label: 'Créature unique',
    aliases: ['dragon', 'licorne', 'unicorn'],
    definitionKeywords: ['créature', 'creature', 'mythique', 'légendaire', 'legendaire'],
    composition: ['créature unique complète', 'silhouette lisible', 'forme complète visible'],
    environment: ['décor simple cohérent avec le sujet'],
    styleHints: [],
    promptInstruction: 'Représenter une seule créature complète et lisible.',
  },
];

const SUBJECT_PROFILE_LIBRARY = RAW_SUBJECT_PROFILES.map((entry) => ({
  type: String(entry.type || '').trim(),
  label: String(entry.label || '').trim(),
  aliases: toUniqueStrings(entry.aliases || []),
  definitionKeywords: toUniqueStrings(entry.definitionKeywords || []),
  canonicalSubject: String(entry.canonicalSubject || '').trim(),
  composition: toUniqueStrings(entry.composition || []),
  environment: toUniqueStrings(entry.environment || []),
  styleHints: toUniqueStrings(entry.styleHints || []),
  promptInstruction: String(entry.promptInstruction || '').trim(),
}));

function textContainsAlias(normalizedText = '', alias = '') {
  const normalizedAlias = normalizeSubjectProfileText(alias);
  if (!normalizedText || !normalizedAlias) return false;
  const pattern = new RegExp(`(^|\\b)${normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(\\b|$)`, 'i');
  return pattern.test(normalizedText);
}

function resolveSubjectProfile({ subject = '', definitionSummary = '', sourceText = '' } = {}) {
  const normalizedSubject = normalizeSubjectProfileText(subject);
  const normalizedDefinition = normalizeSubjectProfileText(definitionSummary);
  const normalizedSourceText = normalizeSubjectProfileText(sourceText);
  if (!normalizedSubject && !normalizedDefinition && !normalizedSourceText) return null;

  const candidates = [];

  const registerMatches = (normalizedText, matchedSource, aliases, profiles, weight) => {
    if (!normalizedText) return;
    for (const profile of profiles) {
      for (const alias of aliases(profile)) {
        const normalizedAlias = normalizeSubjectProfileText(alias);
        if (!normalizedAlias || !textContainsAlias(normalizedText, normalizedAlias)) continue;
        const tokenCount = normalizedAlias.split(/\s+/).filter(Boolean).length;
        const specificityBonus = tokenCount > 1 ? 120 : 0;
        const numericBonus = /\d/.test(normalizedAlias) ? 80 : 0;
        const canonicalBonus = String(profile?.canonicalSubject || '').trim() ? 20 : 0;
        candidates.push({
          profile,
          matchedSource,
          normalizedAlias,
          score: weight + normalizedAlias.length + specificityBonus + numericBonus + canonicalBonus,
        });
      }
    }
  };

  registerMatches(
    normalizedSourceText,
    'sourceText',
    (profile) => profile.aliases,
    SUBJECT_PROFILE_LIBRARY,
    200
  );
  registerMatches(
    normalizedSubject,
    'subject',
    (profile) => profile.aliases,
    SUBJECT_PROFILE_LIBRARY,
    300
  );
  registerMatches(
    normalizedDefinition,
    'definitionSummary',
    (profile) => profile.definitionKeywords,
    SUBJECT_PROFILE_LIBRARY,
    100
  );

  if (candidates.length > 0) {
    const winner = candidates
      .sort((left, right) => right.score - left.score || right.normalizedAlias.length - left.normalizedAlias.length)[0];
    return { ...winner.profile, matchedSource: winner.matchedSource };
  }

  return null;
}

module.exports = {
  SUBJECT_PROFILE_LIBRARY,
  normalizeSubjectProfileText,
  resolveSubjectProfile,
};
