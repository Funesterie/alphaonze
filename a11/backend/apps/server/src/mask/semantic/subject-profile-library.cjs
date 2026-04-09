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
    label: 'Personnage de référence',
    aliases: ['gohan', 'goku', 'vegeta', 'pikachu', 'batman', 'robin', 'mario', 'zelda', 'donkey kong', 'one piece'],
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
    aliases: ['dragon'],
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

  for (const profile of SUBJECT_PROFILE_LIBRARY) {
    if (profile.aliases.some((alias) => textContainsAlias(normalizedSubject, alias))) {
      return { ...profile };
    }
  }

  if (normalizedSourceText) {
    for (const profile of SUBJECT_PROFILE_LIBRARY) {
      if (profile.aliases.some((alias) => textContainsAlias(normalizedSourceText, alias))) {
        return { ...profile };
      }
    }
  }

  if (normalizedDefinition) {
    for (const profile of SUBJECT_PROFILE_LIBRARY) {
      if (profile.definitionKeywords.some((alias) => textContainsAlias(normalizedDefinition, alias))) {
        return { ...profile };
      }
    }
  }

  return null;
}

module.exports = {
  SUBJECT_PROFILE_LIBRARY,
  normalizeSubjectProfileText,
  resolveSubjectProfile,
};
