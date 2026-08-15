'use strict';

function cleanText(value = '', fallback = '', max = 1200) {
  const cleaned = String(value || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(20, Number(max) || 1200));
  return cleaned || fallback;
}

function foldText(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function splitReferenceUrls(value = '') {
  return String(value || '')
    .split(/[\s,;\n]+/)
    .map((entry) => entry.trim())
    .filter((entry) => /^https?:\/\//i.test(entry));
}

function extractVisualReferenceUrls(input = {}) {
  const source = [
    input.referenceImageUrl,
    Array.isArray(input.referenceImageUrls) ? input.referenceImageUrls.join(' ') : '',
    input.sourceImageUrl,
    input.coverImageUrl,
    input.text,
    input.sceneText,
    input.publicTitle,
    input.title,
    input.songTitle,
    input.winner?.text,
    input.idea,
  ].filter(Boolean).join(' ');
  const urls = String(source || '')
    .match(/https?:\/\/[^\s"'<>()[\]{}]+/gi) || [];
  return uniq(urls
    .map((url) => url.replace(/[),.;!?]+$/g, ''))
    .filter((url) => /\.(?:png|jpe?g|webp|avif)(?:[?#].*)?$/i.test(url))
    .filter((url) => /^(?:https:\/\/files\.funesterie\.me\/|https:\/\/vivy\.funesterie\.me\/|https:\/\/a11\.funesterie\.me\/)/i.test(url))
    .slice(0, 8));
}

function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}

const IDENTITY_DEFINITIONS = [
  {
    id: 'vivy',
    label: 'Vivy',
    aliases: [
      /\bvivy\b/i,
      /\bvoix\s+vivy\b/i,
      /\bchanteuse\s+vivy\b/i,
    ],
    envRefs: ['VIVY_VISUAL_REFERENCE_IMAGE_URL', 'VIVY_IDENTITY_REFERENCE_IMAGE_URL'],
    // Portrait detoure, pas la carte "Presence musicale" : celle-ci porte un
    // titre, un paragraphe, un logo et une barre de navigation que les modeles
    // video recopiaient en texte illisible dans les clips.
    defaultRefs: ['https://vivy.funesterie.me/api/vivy/stream/identity/vivy-reference-portrait'],
    prompt: [
      'Référence visuelle chanteuse IA: jeune femme adulte à peau claire, longs cheveux noirs en couettes avec reflets magenta sombre, frange droite noire, yeux gris-verts expressifs, pinces et boucles d’oreilles en forme d’étoile, tenue gothic electro-pop noire, choker noir, présence micro ou studio, palette néon magenta et noir.',
      'Si cette chanteuse IA apparaît, garder exactement cette identité studio gothic magenta sombre; ne jamais la rendre blonde, pastel, idole générique, cheveux bleus, enfantine ou sans rapport avec la référence.',
    ].join(' '),
    negative: [
      'blonde Vivy',
      'blonde singer as Vivy',
      'generic blonde anime girl',
      'pastel Vivy',
      'blue-haired Vivy',
      'childlike Vivy',
      'wrong Vivy hair color',
    ],
  },
  {
    id: 'djeff',
    label: 'Djeff',
    aliases: [
      /\bdjeff\b/i,
      /\bjeffrey\b/i,
      /\bjeff\b/i,
      /\bfunes?te38\b/i,
      /\bcr[ée]ateur\s+humain\b/i,
    ],
    envRefs: ['VIVY_DJEFF_REFERENCE_IMAGE_URL', 'DJEFF_REFERENCE_IMAGE_URL'],
    defaultRefs: [
      'https://vivy.funesterie.me/api/vivy/stream/identity/djeff-reference-01',
      'https://vivy.funesterie.me/api/vivy/stream/identity/djeff-reference-02',
      'https://vivy.funesterie.me/api/vivy/stream/identity/djeff-reference-03',
      'https://vivy.funesterie.me/api/vivy/stream/identity/djeff-reference-04',
      'https://vivy.funesterie.me/api/vivy/stream/identity/djeff-reference-05',
    ],
    prompt: [
      'Référence visuelle créateur humain: homme adulte méditerranéen réel à peau olive, yeux brun foncé, sourcils marqués, cheveux courts brun foncé avec parfois une mèche claire devant, barbe courte noire et moustache, visage naturel, t-shirt sombre ou veste bleue, énergie de créateur.',
      'Si ce créateur apparaît, préserver son visage, son teint olive, ses yeux foncés, sa barbe, sa moustache et sa forme de cheveux depuis les photos de référence; ne pas changer son origine visuelle, ne pas le rendre noir, imberbe, personnage motard bêta ou acteur générique.',
    ].join(' '),
    negative: [
      'black Djeff',
      'wrong Djeff ethnicity',
      'afro Djeff',
      'clean shaven Djeff',
      'generic Djeff rider beta',
      'different actor as Djeff',
      'old nossen djeff beta asset',
    ],
  },
  {
    id: 'marvin',
    label: 'Marvin',
    aliases: [
      /\bmarvin\b/i,
      /\bmarvin\s+cellauro\b/i,
      /\bmarvin\s+bip\s*bip\b/i,
    ],
    envRefs: ['VIVY_MARVIN_REFERENCE_IMAGE_URL', 'MARVIN_REFERENCE_IMAGE_URL'],
    defaultRefs: [
      'https://vivy.funesterie.me/api/vivy/stream/identity/marvin-reference-family',
      'https://vivy.funesterie.me/api/vivy/stream/identity/marvin-reference-brothers-01',
      'https://vivy.funesterie.me/api/vivy/stream/identity/marvin-reference-brothers-02',
      'https://vivy.funesterie.me/api/vivy/stream/identity/marvin-reference-brothers-03',
      'https://vivy.funesterie.me/api/vivy/stream/identity/marvin-reference-brothers-04',
    ],
    prompt: [
      'Référence visuelle frère et père: homme adulte méditerranéen réel à peau olive, cheveux courts foncés, yeux foncés, barbe courte foncée et moustache, présence familiale protectrice, visage naturel, expression douce mais solide, énergie familiale décontractée.',
      'Si ce frère/père apparaît, préserver son visage, son teint, ses yeux foncés, sa barbe courte, sa moustache et sa présence protectrice depuis les photos de référence; sur les photos entre frères il est l’homme à droite, sur la référence familiale il est l’homme tout à gauche avec Charlène, Léna et Elio.',
      'Ne pas confondre le frère/père avec le créateur: garder les deux personnages distincts s’ils apparaissent ensemble.',
    ].join(' '),
    negative: [
      'generic Marvin',
      'different man as Marvin',
      'wrong Marvin face',
      'blonde Marvin',
      'black Marvin',
      'clean shaven Marvin',
      'old man Marvin',
      'teenage Marvin',
      'random anime boy as Marvin',
      'Djeff replacing Marvin',
    ],
  },
  {
    id: 'jean',
    label: 'Jean',
    aliases: [
      /\bjean\b/i,
      /\bp[eè]re\s+de\s+djeff\b/i,
      /\bpapa\s+de\s+djeff\b/i,
    ],
    envRefs: ['VIVY_JEAN_REFERENCE_IMAGE_URL', 'JEAN_REFERENCE_IMAGE_URL'],
    defaultRefs: [
      'https://files.funesterie.me/users/vivy-twitch-live/1783034924695-jean-porsche-reference-plate-hidden.jpg',
    ],
    prompt: [
      'Référence visuelle Jean: homme adulte méditerranéen réel, peau claire à olive, cheveux courts foncés, lunettes de soleil possibles, tee-shirt noir, présence calme de père et de vedette de cinéma familiale, associé à une Porsche Boxster grise avec intérieur rouge. ',
      'Si Jean apparaît avec Djeff, garder deux générations distinctes: Djeff est le fils/créateur plus jeune, Jean est le père/passager ou pilote selon la demande. Ne jamais fusionner Jean avec Djeff, ne jamais le remplacer par un acteur générique, un homme blond, une femme, un vieillard caricatural ou une seconde Vivy.',
    ].join(' '),
    negative: [
      'generic Jean',
      'wrong Jean face',
      'Jean replaced by Djeff',
      'Djeff replaced by Jean',
      'two Djeff characters',
      'two Vivy characters',
      'blonde Jean',
      'woman as Jean',
      'cartoon Jean',
      'random old man as Jean',
    ],
  },
  {
    id: 'a11',
    label: 'A11',
    aliases: [
      /\ba11\b/i,
      /\ba-11\b/i,
      /\balpha\s*11\b/i,
      /\balpha\s+onze\b/i,
    ],
    envRefs: ['A11_VISUAL_REFERENCE_IMAGE_URL', 'VIVY_A11_REFERENCE_IMAGE_URL'],
    defaultRefs: [
      'https://vivy.funesterie.me/api/vivy/stream/identity/a11-agent-media-card',
      'https://vivy.funesterie.me/api/vivy/stream/identity/a11-agent-media-avatar',
    ],
    prompt: [
      'Référence visuelle agent média: silhouette noire encapuchonnée, masque sombre sous capuche noire, yeux cyan lumineux, circuits et symboles média cyan/teal, veste streetwear tactique noire, ville néon violet et cyan ou interface studio, présence d’opérateur numérique mystérieux.',
      'Si cet agent média apparaît, garder cette identité encapuchonnée aux yeux cyan; ne jamais le transformer en homme normal sans masque, chanteur aléatoire, cartoon gentil, enfant, chevalier ou personnage anime sans rapport.',
    ].join(' '),
    negative: [
      'random A11 singer',
      'unhooded A11',
      'normal human A11',
      'friendly sitcom A11',
      'child A11',
      'bright cartoon A11',
      'wrong A11 mascot',
    ],
  },
  {
    id: 'k44',
    label: 'K44',
    aliases: [
      /\bk44\b/i,
      /\bkaen44\b/i,
      /\bkaen\s*44\b/i,
      /\bkaen\b/i,
    ],
    envRefs: ['K44_VISUAL_REFERENCE_IMAGE_URL', 'KAEN44_VISUAL_REFERENCE_IMAGE_URL', 'VIVY_K44_REFERENCE_IMAGE_URL'],
    defaultRefs: [
      'https://vivy.funesterie.me/api/vivy/stream/identity/k44-copilot-reference',
    ],
    prompt: [
      'Référence visuelle copilote quotidienne: jeune femme aux cheveux foncés, avatar circulaire violet, combinaison futuriste noire et violette, cockpit néon bleu-violet, décor de cyber-ville, parfois avec moto élancée, énergie d’assistante précise.',
      'Si cette copilote apparaît, garder cette identité cyber/moto féminine et la palette violet-bleu; ne jamais la rendre rappeur homme, clone de l’agent encapuchonné, animal, motard aléatoire ou personnage anime sans rapport.',
    ].join(' '),
    negative: [
      'random K44 rapper',
      'male K44',
      'hooded A11 as K44',
      'biker dude K44',
      'wrong Kaen44 avatar',
      'generic cyber girl without Kaen44 identity',
    ],
  },
];

function buildVisualIdentitySearchText(input = {}) {
  const includeVocalCast = input.forceVocalCastVisualIdentity === true
    || String(input.forceVocalCastVisualIdentity || '').trim() === '1';
  const cleanVisualSource = (value = '') => String(value || '')
    .replace(/^\s*!(?:vivy|nossen|chanson|song|th[eè]me|idee|idée)\b[\s:,-]*/i, '')
    .replace(/\[(?:solo|duo|trio|ensemble|ch[œo]ur)?\s*(?:vivy|djeff|jeff|a11|alpha\s+onze|k44|kaen44)(?:\s*(?:\+|&|et|x)\s*(?:vivy|djeff|jeff|a11|alpha\s+onze|k44|kaen44))*[^\]]*\]/gi, ' ');
  const artists = includeVocalCast
    ? (Array.isArray(input.artists)
      ? input.artists.join(' ')
      : cleanText(input.artists || input.songArtists || '', '', 600))
    : '';
  return cleanText([
    cleanVisualSource(input.text),
    cleanVisualSource(input.sceneText),
    cleanVisualSource(input.publicTitle),
    cleanVisualSource(input.title),
    cleanVisualSource(input.songTitle),
    includeVocalCast ? input.vocalCast : '',
    artists,
    cleanVisualSource(input.winner?.text),
    cleanVisualSource(input.idea),
  ].filter(Boolean).join(' '), '', 9000);
}

function resolveVivyVisualFocus(input = {}) {
  const sourceText = cleanText([
    input.publicTitle,
    input.title,
    input.songTitle,
    input.winner?.text,
    input.idea,
    input.intentPlan?.generationBrief,
    input.intentPlan?.reason,
  ].filter(Boolean).join(' '), '', 6000);
  const folded = foldText(sourceText);
  const hasObjectFocus = /\b(?:fruit|fruits|poire|poires|pomme|pommes|banane|bananes|peche|peches|pêche|pêches|fraise|fraises|citron|citrons|orange|oranges|raisin|raisins|aubergine|aubergines|concombre|concombres|courge|courges|graine|graines|legume|legumes|légume|légumes|baguette|pain|brioche|croissant|carte\s+graphique|gpu|processeur|cpu|ram|ordinateur|machine|machines|robot|robots|soleil|lune|etoile|étoile|comete|comète)\b/.test(folded);
  const hasExplicitHumanFocus = /\b(?:vivy|djeff|jeffrey|marvin|a11|alpha\s+onze|k44|kaen44|homme|femme|fille|garcon|garçon|humain|humaine|createur|créateur|chanteuse|chanteur|pilote|pirate|corsaire|barman|aubergiste|cowboy|sheriff|shérif)\b/.test(folded);
  const nonHumanFocus = hasObjectFocus && !hasExplicitHumanFocus;
  if (!nonHumanFocus) {
    return {
      nonHumanFocus: false,
      prompt: '',
      negativePrompt: '',
      reason: '',
    };
  }
  return {
    nonHumanFocus: true,
    reason: 'object_or_fruit_subject',
    prompt: [
      'Sujet visuel prioritaire non humain: le fruit, objet, machine ou élément naturel du titre doit être le protagoniste principal.',
      'Ne pas remplacer le sujet par une personne humaine, une chanteuse, un chanteur, un mannequin ou un portrait.',
      'Si le sujet est anthropomorphique, l’exprimer par accessoires, posture, décor, éclairage, mouvement et expression graphique sur l’objet, jamais par un corps humain réaliste.',
      'Le casting vocal n’est pas le casting visuel: une voix Vivy/Djeff/A11/K44 ne doit pas ajouter ce personnage à l’image si le sujet ne le demande pas.',
    ].join(' '),
    negativePrompt: [
      'human figure',
      'person',
      'woman',
      'man',
      'singer',
      'vocalist',
      'idol',
      'model',
      'portrait',
      'human face replacing the object',
      'realistic human body',
      'sexualized human body',
      'stage singer',
    ].join(', '),
  };
}

function identityMatches(definition = {}, folded = '') {
  return definition.aliases.some((alias) => alias.test(folded));
}

function resolveVivyVisualCasting(input = {}) {
  const folded = foldText([
    buildVisualIdentitySearchText(input),
    input.intentPlan?.generationBrief,
    input.intentPlan?.reason,
  ].filter(Boolean).join(' '));
  const hasVivy = /\bvivy\b/.test(folded);
  const hasCreator = /\b(?:createur|djeff|jeffrey|jeff|funeste38)\b/.test(folded);
  const hasMaleFemaleDuo = /\bduo\s+(?:homme\s+femme|femme\s+homme)\b/.test(folded)
    || (/\bvoix\s+masculine\b/.test(folded) && /\bvoix\s+feminine\b/.test(folded));
  const creatorAndVivy = hasVivy && (hasCreator || hasMaleFemaleDuo);
  if (!creatorAndVivy) {
    return {
      id: '',
      requiredIdentityIds: [],
      prompt: '',
      negativePrompt: '',
    };
  }

  return {
    id: 'djeff-vivy-duo',
    requiredIdentityIds: ['djeff', 'vivy'],
    prompt: [
      'Casting visuel obligatoire: deux personnages distincts et lisibles, pas deux variantes du même personnage.',
      'Le créateur humain est un homme adulte méditerranéen réel: peau olive, yeux foncés, sourcils marqués, barbe courte et moustache, cheveux courts bruns avec parfois une mèche claire; il représente la fatigue, les bugs, le clavier ou la console.',
      'La chanteuse IA est séparée de lui: jeune femme aux cheveux noirs en couettes avec reflets magenta, clips étoiles, tenue gothic electro-pop noire, micro ou présence studio lumineuse.',
      'Les deux personnages ne fusionnent jamais: la chanteuse IA n’est pas le créateur, le créateur n’est pas une femme, et aucun plan ne doit remplacer le créateur par une seconde chanteuse IA.',
      'Composer le duo comme une scène créateur + IA: créateur côté code/station de travail, chanteuse IA côté micro/lumière/musique, deux silhouettes différentes, deux visages différents, une relation de réponse musicale.',
    ].join(' '),
    negativePrompt: [
      'two Vivy',
      'duplicate Vivy',
      'Vivy clone',
      'Vivy twin',
      'same woman twice',
      'two women instead of creator and Vivy',
      'female creator',
      'woman as creator',
      'girl as creator',
      'no male creator',
      'missing Djeff',
      'Djeff replaced by Vivy',
      'creator replaced by singer',
      'identical faces',
      'same character duplicated',
    ].join(', '),
  };
}

function referencesForIdentity(definition = {}, env = process.env) {
  const envRefs = (definition.envRefs || []).flatMap((key) => splitReferenceUrls(env[key]));
  return uniq([...envRefs, ...(definition.defaultRefs || [])]);
}

function buildVivyVisualIdentityPack(input = {}) {
  const visualFocus = resolveVivyVisualFocus(input);
  const explicitReferenceImageUrls = extractVisualReferenceUrls(input);
  const explicitReferencePrompt = explicitReferenceImageUrls.length
    ? 'Référence visuelle utilisateur fournie: respecter les éléments fiables de cette image, mais ne jamais recopier les textes, panneaux, plaques, logos ou inscriptions visibles.'
    : '';
  if (visualFocus.nonHumanFocus && input.forceVisualIdentityForNonHuman !== true) {
    return {
      identities: [],
      prompt: explicitReferencePrompt,
      negativePrompt: '',
      referenceImageUrls: explicitReferenceImageUrls,
    };
  }

  const env = input.env || process.env;
  const searchText = buildVisualIdentitySearchText(input);
  const folded = foldText(searchText);
  const casting = resolveVivyVisualCasting(input);
  const requiredIdentityIds = new Set(casting.requiredIdentityIds || []);
  const identities = IDENTITY_DEFINITIONS
    .filter((definition) => requiredIdentityIds.has(definition.id) || identityMatches(definition, folded))
    .map((definition) => ({
      id: definition.id,
      label: definition.label,
      prompt: definition.prompt,
      negative: definition.negative || [],
      referenceImageUrls: referencesForIdentity(definition, env),
    }));

  return {
    identities,
    casting,
    prompt: cleanText([
      identities.map((identity) => identity.prompt).join(' '),
      casting.prompt,
      explicitReferencePrompt,
    ].filter(Boolean).join(' '), '', 4200),
    negativePrompt: cleanText([
      identities.flatMap((identity) => identity.negative).join(', '),
      casting.negativePrompt,
    ].filter(Boolean).join(', '), '', 1600),
    referenceImageUrls: uniq([
      ...explicitReferenceImageUrls,
      ...identities.flatMap((identity) => identity.referenceImageUrls),
    ]),
  };
}

function appendVivyVisualIdentityBrief(parts = [], input = {}) {
  const pack = buildVivyVisualIdentityPack(input);
  if (pack.prompt) {
    parts.push(`Références visuelles de personnages à respecter si elles apparaissent, sans écrire leur nom dans l’image: ${pack.prompt}`);
    parts.push('Ces identités ne forcent pas leur apparition si le sujet parle d’autre chose, mais tout personnage nommé doit rester reconnaissable et cohérent.');
  }
  return { parts, pack };
}

function buildVivyVisualNegativeIdentityPrompt(packOrInput = {}) {
  const pack = Array.isArray(packOrInput.identities)
    ? packOrInput
    : buildVivyVisualIdentityPack(packOrInput);
  return cleanText(pack.negativePrompt || '', '', 1200);
}

module.exports = {
  IDENTITY_DEFINITIONS,
  appendVivyVisualIdentityBrief,
  buildVivyVisualIdentityPack,
  buildVivyVisualNegativeIdentityPrompt,
  cleanText,
  foldText,
  resolveVivyVisualCasting,
  resolveVivyVisualFocus,
  extractVisualReferenceUrls,
  splitReferenceUrls,
};
