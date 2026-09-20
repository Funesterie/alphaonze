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
    // Remplacé le 13/09/2026 : l'ancien portrait (vivy-reference-portrait) faisait
    // gamine gothique. Premier = référence principale (NOSSEN_CLIP_REFERENCE_INDEX).
    defaultRefs: [
      'https://vivy.funesterie.me/api/vivy/stream/identity/vivy-reference-studio',
      'https://vivy.funesterie.me/api/vivy/stream/identity/vivy-reference-realiste',
      'https://vivy.funesterie.me/api/vivy/stream/identity/vivy-reference-micro',
      'https://vivy.funesterie.me/api/vivy/stream/identity/vivy-reference-ondulee',
    ],
    prompt: [
      // Allure revue le 13/09/2026 sur les images choisies par Djeff : l'ancienne
      // (couettes, pinces étoiles, « gothic electro-pop ») faisait gamine gothique.
      'Référence visuelle chanteuse IA: femme adulte d’environ vingt-cinq ans à peau claire, longs cheveux noirs ondulés à mèches magenta, en demi-queue lâche, frange noire droite, maquillage charbonneux, boucles d’oreilles étoiles, veste en cuir noir sur un haut noir, choker clouté à anneau, pendentif argent, présence micro ou studio, palette néon magenta et violet.',
      'Si cette chanteuse IA apparaît, garder exactement cette identité rock adulte magenta sombre; ne jamais la rendre blonde, pastel, idole générique, cheveux bleus, enfantine ou sans rapport avec la référence.',
    ].join(' '),
    // Fiche pour le generateur video (12/09/2026) : anglais, courte, affirmative.
    // La fiche francaise ci-dessus faisait ~870 caracteres dans CHAQUE plan et
    // noyait la description du plan ; les interdits restent dans `negative`.
    videoPrompt: 'Vivy, the AI singer: grown woman in her mid-twenties, fair skin, long wavy black hair with magenta streaks worn loosely half-up, straight black bangs, smoky dark eye makeup, star earrings, black leather jacket over a black top, studded choker with a ring, silver pendant necklace, neon magenta and violet palette.',
    // Clip en film (12/09/2026) : un clip « film » avec Vivy sortait en anime, alors
    // que le rendu, le style de la page et les 12 plans de Sol disaient tous
    // « photorealistic live action ». Pour le modele video, « Vivy, the AI singer »
    // avec couettes et barrettes etoiles EST l'heroine de l'anime du meme nom : le
    // personnage reconnu l'emporte sur la consigne de rendu. En film, on decrit donc
    // une actrice reelle portant le meme costume, et le nom est remplace dans tout le
    // prompt camera (`nomFilm`). Pas de negatif : Seedance n'a pas ce champ.
    videoPromptFilm: 'A real human actress in her mid-twenties, fair skin and natural skin texture, long wavy black hair with magenta streaks worn loosely half-up, straight black bangs, smoky dark eye makeup, star earrings, black leather jacket over a black top, studded choker with a ring, silver pendant necklace, neon magenta and violet palette.',
    nomFilm: 'the singer',
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
    // 17/09/2026, fin d'apres-midi : Djeff donne SA photo (selfie IMG_2134) pour
    // Jeffrey / Djeff Engine. Chaque mot compte : « moustache », « carrure solide »,
    // « visage large », « plaques » et « degarni » avaient produit un homme plus vieux
    // a grosse moustache. On decrit donc ce que montre la photo, en positif : visage
    // rond et jeune, barbe courte reguliere le long de la machoire. Les perles en bois
    // de la photo restent hors de la fiche (demande du 17/09). Pour la video, tenue
    // fixe et jambes visibles. La reference image sert aux pochettes ; les clips
    // (sans i2v) l'abandonnent proprement et gardent le texte.
    defaultRefs: [
      'https://vivy.funesterie.me/api/vivy/stream/identity/djeff-reference-selfie-17-09',
    ],
    prompt: [
      'Référence visuelle créateur humain, énergie de créateur.',
      'Si ce créateur apparaît : un homme au début de la trentaine, visage rond et jeune, peau claire, yeux marron, sourcils bruns épais, cheveux bruns mi-longs ramenés en arrière et un peu en bataille, barbe brune courte et régulière le long de la mâchoire et du menton. Il porte un tee-shirt gris clair imprimé de feuilles de palmier gris foncé, un jean foncé, des bottes de moto noires et une fine chaîne en or avec une petite croix. Toujours la même tenue, corps entier avec les jambes visibles quand il est sur la moto.',
    ].join(' '),
    videoPrompt: 'Djeff, the rider: a man in his early thirties, round youthful face, brown eyes, thick dark eyebrows, medium-length dark brown hair swept back, short even dark beard along the jaw and chin; light grey t-shirt with a dark palm leaf print, dark jeans, black riding boots, thin gold chain with a small cross; same outfit in every shot, full body with legs and boots on the pegs when riding.',
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
    videoPrompt: 'Marvin, his brother: real Mediterranean adult man, olive skin, short dark hair, dark eyes, short dark beard and moustache, natural face, calm and protective presence, a different man from Djeff.',
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
    videoPrompt: 'Jean, Djeff\'s father: real Mediterranean man of the older generation, light olive skin, short dark hair, sometimes sunglasses, black t-shirt, calm fatherly presence, clearly older than Djeff.',
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
    videoPrompt: 'A11, the media agent: black hooded silhouette, dark mask under the hood, glowing cyan eyes, cyan and teal circuit and media symbols, black tactical streetwear jacket, violet and cyan neon city or studio interface.',
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
    videoPrompt: 'K44, the co-pilot: young woman with dark hair, black and violet futuristic suit, blue-violet neon cockpit, cyber-city backdrop, sometimes a sleek motorbike, precise and focused energy.',
    negative: [
      'random K44 rapper',
      'male K44',
      'hooded A11 as K44',
      'biker dude K44',
      'wrong Kaen44 avatar',
      'generic cyber girl without Kaen44 identity',
    ],
  },
  // Elio et Lena (Djeff, 20/09/2026) : deux ENFANTS. Volontairement SANS photo de
  // reference — ni envRefs ni defaultRefs — contrairement aux adultes du registre :
  // ce sont des enfants reels de la famille, et la chaine image ne doit pas chercher
  // leur ressemblance. La fiche ecrite tient la continuite, et rien d'autre.
  {
    id: 'elio',
    label: 'Elio',
    aliases: [
      /\belio\b/i,
      /\bgrand\s+fr[eè]re\s+d[eu]\s+l[eé]na\b/i,
    ],
    prompt: [
      'Elio, garcon de 7 ans, personnage de fiction : cheveux brun fonce lisses et fournis, legerement en bataille, yeux noisette a brun fonce, visage fin et expressif, silhouette mince et sportive.',
      'Toujours un enfant de 7 ans, aux proportions d’enfant : jamais vieilli en adolescent ni en adulte.',
      'En action : posture concentree et determinee d’apprenti, gestes de boxe et d’arts martiaux adaptes a son age, tenue de sport couvrante.',
    ].join(' '),
    videoPrompt: 'Elio, a 7-year-old boy, fictional character: dark brown straight slightly messy hair, hazel to dark brown eyes, fine expressive face, slim athletic child build, child proportions, modest sportswear, focused determined posture.',
    negative: [
      'teenage Elio',
      'adult Elio',
      'aged-up Elio',
      'blonde Elio',
      'blue eyes Elio',
      'photorealistic portrait of a real child',
      'revealing or tight clothing on Elio',
    ],
  },
  {
    id: 'lena',
    label: 'Lena',
    aliases: [
      /\bl[eé]na\b/i,
      /\bpetite\s+s(?:oe|œ)ur\s+d[’']?elio\b/i,
    ],
    prompt: [
      'Lena, petite fille de 3 ans, personnage de fiction : grands yeux bruns tres expressifs, cheveux brun fonce ondulés, parfois en petites tresses, visage doux et arrondi.',
      'Toujours une enfant de 3 ans, aux proportions de tres jeune enfant : jamais vieillie.',
      'Univers de conte : robes et tenues d’enfant couvrantes, couronnes et accessoires de princesse imagines par elle.',
    ].join(' '),
    videoPrompt: 'Lena, a 3-year-old girl, fictional character: large expressive brown eyes, wavy dark brown hair sometimes in small braids, soft round face, toddler proportions, modest child clothing, cheerful mischievous expression.',
    negative: [
      'teenage Lena',
      'adult Lena',
      'aged-up Lena',
      'blonde Lena',
      'photorealistic portrait of a real child',
      'revealing or tight clothing on Lena',
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
      videoPrompt: '',
      negativePrompt: '',
    };
  }

  return {
    id: 'djeff-vivy-duo',
    requiredIdentityIds: ['djeff', 'vivy'],
    prompt: [
      'Casting visuel obligatoire: deux personnages distincts et lisibles, pas deux variantes du même personnage.',
      // 16/09/2026 : ces deux phrases redécrivaient les visages avec l'allure
      // abandonnée le 13/09 (Djeff « méditerranéen, peau olive », Vivy « couettes,
      // gothic electro-pop ») et contredisaient les fiches du même prompt. Les
      // visages vivent dans les fiches de Djeff et de Vivy ; ici, les rôles seuls.
      'Le créateur humain, homme adulte avec les traits de sa fiche, représente la fatigue, les bugs, le clavier ou la console.',
      'La chanteuse IA, femme adulte avec les traits de sa fiche, est séparée de lui: micro ou présence studio lumineuse.',
      'Les deux personnages ne fusionnent jamais: la chanteuse IA n’est pas le créateur, le créateur n’est pas une femme, et aucun plan ne doit remplacer le créateur par une seconde chanteuse IA.',
      'Composer le duo comme une scène créateur + IA: créateur côté code/station de travail, chanteuse IA côté micro/lumière/musique, deux silhouettes différentes, deux visages différents, une relation de réponse musicale.',
    ].join(' '),
    // Version video (12/09/2026) : les fiches de Djeff et de Vivy decrivent deja
    // leurs visages ; ici seulement la relation, en anglais et en positif.
    videoPrompt: 'Two distinct characters share the scene: Djeff at the code workstation or console, Vivy at the microphone in the light; two different faces and silhouettes answering each other musically.',
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
      videoPrompt: definition.videoPrompt || definition.prompt,
      videoPromptFilm: definition.videoPromptFilm || definition.videoPrompt || definition.prompt,
      nomFilm: definition.nomFilm || '',
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
    // Version courte et anglaise pour les modeles video (clips NOSSEN) ; `prompt`
    // reste la fiche francaise complete des autres usages (Twitch, images).
    videoPrompt: cleanText([
      identities.map((identity) => identity.videoPrompt).join(' '),
      casting.videoPrompt || casting.prompt,
      explicitReferenceImageUrls.length
        ? 'Match the reliable features of the user reference image; never copy its text, signs, plates or logos.'
        : '',
    ].filter(Boolean).join(' '), '', 1600),
    // Meme chose pour un clip en prises de vue reelles, et les noms a effacer du
    // prompt camera (voir `videoPromptFilm` de Vivy).
    videoPromptFilm: cleanText([
      identities.map((identity) => identity.videoPromptFilm).join(' '),
      casting.videoPrompt || casting.prompt,
      explicitReferenceImageUrls.length
        ? 'Match the reliable features of the user reference image; never copy its text, signs, plates or logos.'
        : '',
    ].filter(Boolean).join(' '), '', 1600),
    nomsFilm: Object.fromEntries(identities
      .filter((identity) => identity.nomFilm)
      .map((identity) => [identity.label, identity.nomFilm])),
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
