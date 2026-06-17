const {
  buildCheckpointStructuralPrompt,
  buildCheckpointVariationPrompt,
  detectSubjectType,
  extractBasePromptFragments,
  extractStableSceneFragments,
  normalizeFramePromptFragment,
  normalizePromptList,
  normalizeSequenceBeat,
  normalizeVideoLookup,
  resolveDefaultIdentityLocks,
  splitFramePromptClauses,
} = require('./video-sequence-heuristic.cjs');
const {
  detectPromptLanguageProfile,
  translateImagePromptToEnglish,
} = require('../mask/build-sd-prompt-bundle.cjs');

const VIDEO_ENGLISH_PHRASE_REPLACEMENTS = [
  ['sur un sentier fantastique', 'on a fantasy path'],
  ['sur un sentier', 'on a path'],
  ['sur le chemin', 'on the path'],
  ['sur fond blanc', 'on a white background'],
  ['sur fond noir', 'on a black background'],
  ['fond simple', 'simple background'],
  ['posture de depart stable', 'stable starting pose'],
  ['appuis nets', 'clear support points'],
  ['geste encore contenu', 'gesture still restrained'],
  ['debut du geste', 'gesture begins'],
  ['un appui change clairement', 'one support point changes clearly'],
  ['le buste commence a suivre', 'the torso starts following'],
  ['transfert de poids visible', 'visible weight transfer'],
  ['geste plus ouvert', 'wider gesture'],
  ['silhouette toujours claire', 'silhouette stays clear'],
  ['point fort du geste ou de la posture', 'peak of the gesture or pose'],
  ['action lisible sans changer toute la scene', 'action remains readable without changing the whole scene'],
  ['sortie du geste', 'gesture release'],
  ['posture stabilisee apres l action', 'pose stabilized after the action'],
  ['posture stabilisee apres action', 'pose stabilized after the action'],
  ['geste encore retenu', 'gesture still restrained'],
  ['retombee du geste', 'gesture settles down'],
  ['energie se dissipe', 'energy dissipates'],
  ['posture reste lisible', 'pose remains readable'],
  ['depart pret', 'ready starting pose'],
  ['marche enclenchee', 'walking motion starts'],
  ['bassin legerement bas', 'hips slightly lowered'],
  ['jambe gauche clairement devant le bassin', 'left leg clearly ahead of the hips'],
  ['jambe droite clairement devant le bassin', 'right leg clearly ahead of the hips'],
  ['jambe gauche porte l appui', 'left leg carries the support'],
  ['jambe droite porte l appui', 'right leg carries the support'],
  ['jambe gauche sous le bassin', 'left leg under the hips'],
  ['jambe droite sous le bassin', 'right leg under the hips'],
  ['jambe gauche toujours en appui', 'left leg still supporting'],
  ['jambe droite toujours en appui', 'right leg still supporting'],
  ['progression du corps encore lisible', 'body progression still readable'],
  ['deux jambes distinctes', 'two distinct legs'],
  ['deux bras distincts', 'two distinct arms'],
  ['bassin et epaules bien lisibles', 'hips and shoulders clearly visible'],
  ['une jambe d appui et une jambe mobile', 'one supporting leg and one moving leg'],
  ['bras droit plus avance que le bras gauche', 'right arm more forward than the left arm'],
  ['bras gauche plus avance que le bras droit', 'left arm more forward than the right arm'],
  ['pied droit en train de quitter le sol', 'right foot leaving the ground'],
  ['pied gauche en train de quitter le sol', 'left foot leaving the ground'],
  ['pied gauche quitte le sol', 'left foot leaves the ground'],
  ['pas suivant visible', 'next step visible'],
  ['bassin lisible en compression', 'hips clearly visible in compression'],
  ['buste stable et lisible', 'stable torso clearly visible'],
  ['jambe gauche repart vers l avant', 'left leg swings forward again'],
  ['balancier oppose des bras', 'opposite arm swing'],
  ['silhouette de marche complete', 'complete walking silhouette'],
  ['marche encore lisible', 'walking motion still readable'],
  ['posture stable apres la progression', 'pose stable after the progression'],
  ['posture stabilisee sans deformation', 'pose stabilized without distortion'],
  ['buste pret a se projeter', 'torso ready to lean into motion'],
  ['jambe gauche clairement devant', 'left leg clearly forward'],
  ['jambe droite clairement devant', 'right leg clearly forward'],
  ['buste incline vers l avant', 'torso leaning forward'],
  ['bras opposes bien distincts', 'distinct opposite arm swing'],
  ['poids compresse sur la jambe gauche', 'weight compressed on the left leg'],
  ['poids compresse sur la jambe droite', 'weight compressed on the right leg'],
  ['bassin bas et lisible', 'low hips clearly visible'],
  ['jambe droite prete a repartir', 'right leg ready to push again'],
  ['jambe gauche prete a repartir', 'left leg ready to push again'],
  ['les deux pieds quittent legerement le sol', 'both feet briefly leave the ground'],
  ['projection nette vers l avant', 'clear forward projection'],
  ['bras opposes inverses', 'opposite arm swing reversed'],
  ['course encore lisible', 'running motion still readable'],
  ['sortie de poussee sans deformation', 'push-off exit without distortion'],
  ['bras ecartes du corps', 'arms spread away from the body'],
  ['poitrine ouverte', 'open chest'],
  ['cheveux rouges divins bien visibles', 'divine red hair clearly visible'],
  ['transformation clairement engagee', 'transformation clearly underway'],
  ['forme super saiyan divin presque atteinte', 'super saiyan divine form nearly reached'],
  ['forme super saiyan divin atteinte', 'super saiyan divine form reached'],
  ['forme super saiyan divin stabilisee', 'super saiyan divine form stabilized'],
  ['bras ouverts plus haut', 'arms raised higher and open'],
  ['torse projete vers l avant', 'torso projected forward'],
  ['bras ouverts avec force', 'arms thrown open with force'],
  ['poitrine projetee', 'chest projected forward'],
  ['energie maitrisee autour du corps', 'controlled energy around the body'],
  ['visage toujours reconnaissable', 'face remains recognizable'],
  ['un seul espion britannique complet et reconnaissable', 'a single full recognizable british spy'],
  ['base de marche stable', 'stable walking base'],
  ['base de course stable', 'stable running base'],
  ['base structurelle avant changement', 'structural base before the change'],
  ['quatre pattes au sol', 'four legs on the ground'],
  ['quatre pattes en mouvement', 'four legs in motion'],
  ['silhouette complete du poney lisible', 'complete pony silhouette clearly visible'],
  ['silhouette complete du poney', 'complete pony silhouette'],
  ['silhouette complete lisible', 'complete silhouette clearly visible'],
  ['silhouette complete', 'complete silhouette'],
  ['corps entier lisible', 'full body clearly visible'],
  ['appuis clairs', 'clear support points'],
  ['galop lisible', 'clear gallop'],
  ['course lisible', 'clear run'],
  ['posture neutre de marche', 'neutral walking pose'],
  ['posture de combat stable', 'stable combat stance'],
  ['posture menacante stable', 'stable threatening stance'],
  ['posture droite stable', 'stable upright pose'],
  ['cadrage general stable', 'stable wide framing'],
  ['torse face camera', 'torso facing the camera'],
  ['sur un cheval', 'on a horse'],
  ['assise en selle', 'seated in the saddle'],
  ['arc en main', 'bow in hand'],
  ['structure stable de cavaliere', 'stable rider structure'],
  ['structure stable de tir', 'stable shooting structure'],
  ['appuis du corps lisibles', 'body support points clearly visible'],
  ['mains organisees devant le corps', 'hands organized in front of the body'],
  ['base du geste lisible', 'main gesture clearly readable'],
  ['poids reparti sur les deux jambes', 'weight distributed across both legs'],
  ['poids sur la jambe gauche', 'weight on the left leg'],
  ['poids sur la jambe droite', 'weight on the right leg'],
  ['jambe gauche avance devant', 'left leg moves forward'],
  ['jambe droite avance devant', 'right leg moves forward'],
  ['jambe gauche porte l appui principal', 'left leg carries the main support'],
  ['jambe droite porte l appui principal', 'right leg carries the main support'],
  ['jambe droite passe sous le corps', 'right leg passes under the body'],
  ['jambe gauche passe sous le corps', 'left leg passes under the body'],
  ['commence a quitter le sol', 'starts leaving the ground'],
  ['pied droit commence a quitter le sol', 'right foot starts leaving the ground'],
  ['pied gauche commence a quitter le sol', 'left foot starts leaving the ground'],
  ['bras droit vient legerement devant', 'right arm moves slightly forward'],
  ['bras gauche vient legerement devant', 'left arm moves slightly forward'],
  ['buste stable', 'stable torso'],
  ['bassin lisible', 'readable hips'],
  ['marche continue', 'walking motion continues'],
  ['progression du corps lisible', 'body progression clearly visible'],
  ['balancier naturel des bras', 'natural arm swing'],
  ['silhouette propre', 'clean silhouette'],
  ['faire avancer la posture d une etape visible', 'advance the pose by one visible step'],
  ['checkpoint visuel propre, nouvelle structure deja lisible', 'clean visual checkpoint, the new structure is already readable'],
  ['checkpoint visuel de cette frame', 'visual checkpoint of this frame'],
  ['variation visible de cette frame', 'visible change in this frame'],
  ['anatomie lisible', 'clear anatomy'],
  ['energie faible', 'low energy'],
  ['energie plus dense', 'denser energy'],
  ['projection d energie lisible', 'readable energy projection'],
  ['transfert de poids visible', 'visible weight transfer'],
  ['posture reste lisible', 'pose remains readable'],
  ['aura encore faible', 'aura still faint'],
  ['poings serres', 'clenched fists'],
  ['aura plus visible', 'more visible aura'],
  ['aura se deploie davantage', 'aura spreads further'],
  ['visage et identite coherents', 'face and identity remain consistent'],
  ['cheveux encore normaux', 'hair still normal'],
  ['cheveux se dressent davantage', 'hair rises further'],
  ['premiere lueur d energie', 'first glow of energy'],
  ['transformation clairement engagee', 'transformation clearly underway'],
  ['tenue orange et bleue lisible', 'readable orange and blue outfit'],
  ['illustration anime de combat nette', 'clean anime combat illustration'],
  ['meme visage', 'same face'],
  ['meme tenue', 'same outfit'],
  ['meme silhouette', 'same silhouette'],
  ['meme decor', 'same background'],
  ['meme cheval', 'same horse'],
  ['meme selle', 'same saddle'],
  ['meme poney', 'same pony'],
];

const VIDEO_ENGLISH_TOKEN_REPLACEMENTS = [
  ['cercle', 'circle'],
  ['fond', 'background'],
  ['simple', 'simple'],
  ['deux', 'two'],
  ['encore', 'still'],
  ['toujours', 'still'],
  ['bien', 'clearly'],
  ['commence', 'starts'],
  ['porte', 'carries'],
  ['quitte', 'leaves'],
  ['pret', 'ready'],
  ['bas', 'low'],
  ['sol', 'ground'],
  ['retenu', 'restrained'],
  ['ecartes', 'spread'],
  ['ouverte', 'open'],
  ['ouvertes', 'open'],
  ['ouverts', 'open'],
  ['visibles', 'visible'],
  ['divins', 'divine'],
  ['divines', 'divine'],
  ['jambe', 'leg'],
  ['jambes', 'legs'],
  ['bras', 'arms'],
  ['pied', 'foot'],
  ['pieds', 'feet'],
  ['bassin', 'hips'],
  ['buste', 'torso'],
  ['torse', 'torso'],
  ['epaules', 'shoulders'],
  ['poitrine', 'chest'],
  ['cheveux', 'hair'],
  ['visage', 'face'],
  ['identite', 'identity'],
  ['energie', 'energy'],
  ['gauche', 'left'],
  ['droite', 'right'],
  ['sentier', 'path'],
  ['espion', 'spy'],
  ['britannique', 'british'],
  ['complet', 'complete'],
  ['reconnaissable', 'recognizable'],
  ['appui', 'support'],
  ['appuis', 'support points'],
  ['fantastique', 'fantasy'],
  ['suivre', 'follow'],
  ['depart', 'start'],
  ['marche', 'walking motion'],
  ['course', 'running motion'],
  ['progression', 'progression'],
];

const SUBJECT_STYLE_TAIL_TOKENS = new Set([
  'anime',
  'cinematic',
  'dramatic',
  'dramatique',
  'epic',
  'epique',
  'fantasy',
  'fantastique',
  'heroic',
  'heroique',
  'manga',
  'net',
  'nette',
  'photorealiste',
  'photorealistic',
]);

function transliterateForSd(value = '') {
  // SD3.5 comprend les accents — on normalise juste les guillemets typographiques
  return String(value || '')
    .replace(/[\u2019\u2018]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAsciiText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[â']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replacePatternsCaseInsensitive(source = '', entries = []) {
  let result = String(source || '');
  const orderedEntries = [...entries].sort((left, right) => String(right[0] || '').length - String(left[0] || '').length);
  for (const [needle, replacement] of orderedEntries) {
    result = result.replace(new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'gi'), replacement);
  }
  return result;
}

function restoreNamedTermsCasing(source = '', terms = []) {
  let result = String(source || '');
  for (const term of Array.isArray(terms) ? terms : [terms]) {
    const trimmed = String(term || '').trim();
    if (!trimmed) continue;
    const asciiLower = normalizeAsciiText(trimmed).toLowerCase();
    if (!asciiLower) continue;
    result = result.replace(new RegExp(`\\b${escapeRegExp(asciiLower)}\\b`, 'g'), trimmed);
  }
  return result;
}

function repairVideoEnglishWordOrder(source = '') {
  return String(source || '')
    .replace(/\bon a background (\w+)\b/gi, 'on a $1 background')
    .replace(/\ba background (\w+)\b/gi, 'a $1 background')
    .replace(/\bpath fantasy\b/gi, 'fantasy path')
    .replace(/\bharbor fantasy\b/gi, 'fantasy harbor')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function translateVideoPromptFragment(value = '', options = {}) {
  const normalized = normalizeAsciiText(value);
  if (!normalized) return '';
  const normalizedLower = normalized.toLowerCase();
  const originalSubject = String(options?.subject || options?.canonicalSubject || '').trim();
  const originalStartsWithSubject = (
    originalSubject
    && normalizedLower.startsWith(normalizeAsciiText(originalSubject).toLowerCase())
  );

  let translated = replacePatternsCaseInsensitive(normalizedLower, VIDEO_ENGLISH_PHRASE_REPLACEMENTS);
  translated = translateImagePromptToEnglish(translated) || translated;
  translated = replacePatternsCaseInsensitive(translated, VIDEO_ENGLISH_PHRASE_REPLACEMENTS);
  translated = replacePatternsCaseInsensitive(translated, VIDEO_ENGLISH_TOKEN_REPLACEMENTS);
  translated = translated
    .replace(/\bdeja\b/g, 'already')
    .replace(/\bdevant\b/g, 'forward')
    .replace(/\bdebout\b/g, 'standing')
    .replace(/\blisible\b/g, 'readable')
    .replace(/\blisibles\b/g, 'readable')
    .replace(/\bcoherents\b/g, 'consistent')
    .replace(/\bcoherente\b/g, 'consistent')
    .replace(/\bcoherent\b/g, 'consistent')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  translated = repairVideoEnglishWordOrder(translated);

  if (
    originalStartsWithSubject
    && originalSubject
    && !normalizeAsciiText(translated).toLowerCase().startsWith(normalizeAsciiText(originalSubject).toLowerCase())
  ) {
    translated = `${originalSubject}, ${translated}`;
  }

  translated = restoreNamedTermsCasing(translated, [
    options?.canonicalSubject,
    options?.universe,
  ]);

  for (const styleToken of ['anime', 'manga', 'fantasy', 'cinematic']) {
    if (normalizedLower.includes(styleToken) && !normalizeAsciiText(translated).toLowerCase().includes(styleToken)) {
      translated = `${styleToken} ${translated}`.trim();
    }
  }

  return translated;
}

function stripFrenchSceneRelationSuffix(value = '') {
  let result = normalizeFramePromptFragment(value);
  const patterns = [
    /\s+\b(?:sur|sous|dans|devant|derriere|derrière)\b[\s\S]*$/i,
    /\s+\b(?:pres|près)\s+de\b[\s\S]*$/i,
    /\s+\b(?:au bord de|au milieu de)\b[\s\S]*$/i,
  ];
  for (const pattern of patterns) {
    result = result.replace(pattern, '').trim();
  }
  return normalizeFramePromptFragment(result);
}

function stripSubjectStyleTail(value = '') {
  const tokens = normalizeFramePromptFragment(value).split(/\s+/).filter(Boolean);
  while (tokens.length > 1) {
    const tail = normalizeAsciiText(tokens[tokens.length - 1]).toLowerCase();
    if (!SUBJECT_STYLE_TAIL_TOKENS.has(tail)) break;
    tokens.pop();
  }
  return normalizeFramePromptFragment(tokens.join(' '));
}

function resolveCanonicalSubjectLabel(subject = '', options = {}) {
  const preferred = normalizeFramePromptFragment(options?.preferred || '');
  if (preferred) return preferred;

  const normalizedSubject = normalizeFramePromptFragment(subject);
  if (!normalizedSubject) return '';

  const translated = repairVideoEnglishWordOrder(translateVideoPromptFragment(normalizedSubject, {
    subject: '',
    canonicalSubject: '',
    universe: options?.universe,
  }));
  const profile = detectPromptLanguageProfile(translated);
  if (profile?.mixed || profile?.dominant === 'fr') {
    return repairVideoEnglishWordOrder(
      replacePatternsCaseInsensitive(
        replacePatternsCaseInsensitive(normalizeAsciiText(normalizedSubject).toLowerCase(), VIDEO_ENGLISH_PHRASE_REPLACEMENTS),
        VIDEO_ENGLISH_TOKEN_REPLACEMENTS
      )
    ) || normalizedSubject;
  }
  return translated || normalizedSubject;
}

function resolvePromptSubject(basePrompt = '', motionProfile = 'generic') {
  const promptParts = extractBasePromptFragments(basePrompt);
  const head = String(promptParts[0] || '').trim();
  let subject = head;

  switch (String(motionProfile || 'generic').trim() || 'generic') {
    case 'transformation_rise':
      subject = head
        .replace(/\b(se )?transform(ant|e|ing|ation)?\b.*$/i, '')
        .replace(/\ben super saiyan.*$/i, '')
        .trim();
      break;
    case 'mounted_archery':
    case 'archery_shot':
      subject = head
        .replace(/\btir(ant|er|e)?\b.*$/i, '')
        .replace(/\bavec un arc\b.*$/i, '')
        .trim();
      break;
    case 'walk_cycle':
      subject = head
        .replace(/\s+\b(marchant|marche|marcher|avancant|avancer)\b.*$/i, '')
        .replace(/^(.*?)\s+qui\s+(avance|marche|court|galope|se deplace|se promene)\b.*$/i, '$1')
        .trim();
      break;
    case 'power_up_loop':
      subject = head.replace(/\b(aura|haki|poings? fermes?|poings? serres?|posture menacante)\b.*$/i, '').trim();
      break;
    default:
      subject = head
        .replace(/\b(faisant|donnant|lan[cç]ant|attaquant|frappant|courant|dansant)\b.*$/i, '')
        .trim();
      break;
  }

  subject = stripFrenchSceneRelationSuffix(subject);
  subject = stripSubjectStyleTail(subject);
  return subject || head || 'personnage principal';
}

function resolveDefaultStructuralPrompt({ subject = '', motionProfile = 'generic', basePrompt = '' } = {}) {
  const lookup = normalizeVideoLookup(basePrompt);
  const subjectType = detectSubjectType(basePrompt);

  switch (String(motionProfile || 'generic').trim() || 'generic') {
    case 'walk_cycle':
      if (subjectType === 'horse') return `${subject}, four legs on the ground, complete pony silhouette clearly visible, clear support points`;
      if (subjectType === 'quadruped' || subjectType === 'dragon') return `${subject}, four legs on the ground, complete silhouette clearly visible, clear support points`;
      return `${subject}, stable walking base, full body clearly visible, clear support points`;
    case 'run_cycle':
      if (subjectType === 'horse') return `${subject}, four legs in motion, clear gallop, complete silhouette`;
      if (subjectType === 'quadruped') return `${subject}, four legs in motion, clear run, complete silhouette`;
      return `${subject}, stable running base, clear support points, clear silhouette`;
    case 'power_up_loop':
      return `${subject}, standing, stable threatening stance, clenched fists, stable wide framing`;
    case 'transformation_rise':
      return `${subject}, standing, stable upright pose, torso facing the camera, structural base before the change`;
    case 'mounted_archery':
      return `${subject}, on a horse, seated in the saddle, bow in hand, stable rider structure`;
    case 'archery_shot':
      return `${subject}, bow in hand, stable shooting structure, body support points clearly visible`;
    case 'action_burst':
      return /\b(kamehameha|hadouken|beam|blast|rayon)\b/.test(lookup)
        ? `${subject}, stable combat stance, hands organized in front of the body, clear support points`
        : `${subject}, stable combat stance, clear support points, main gesture clearly readable`;
    default:
      return `${subject}, stable pose, main gesture clearly readable`;
  }
}

function buildStructuralOverridePrompt(subject = '', structuralState = '', fallbackStructuralPrompt = '') {
  const clauses = normalizePromptList(splitFramePromptClauses(structuralState));
  if (!clauses.length) {
    return fallbackStructuralPrompt || `${subject || 'personnage principal'}, structure stable lisible`;
  }
  return [subject || 'personnage principal', ...clauses.slice(0, 4)]
    .map((entry) => normalizeFramePromptFragment(entry))
    .filter(Boolean)
    .join(', ');
}

function buildSceneSentence(basePrompt = '', sequencePlan = {}, referenceAnalysis = null) {
  const motionProfile = String(sequencePlan?.motionProfile || 'generic').trim() || 'generic';
  const visualAnalysis = (
    sequencePlan?.visualAnalysis
    && typeof sequencePlan.visualAnalysis === 'object'
      ? sequencePlan.visualAnalysis
      : null
  );
  const universe = String(sequencePlan?.universe || referenceAnalysis?.universe || '').trim();
  const styleHint = universe ? `style illustration ${universe}` : '';
  const sceneContext = String(sequencePlan?.sceneContext || '').trim();
  const visualSceneFragments = normalizePromptList([
    ...(Array.isArray(visualAnalysis?.scene?.decor) ? visualAnalysis.scene.decor : []),
    ...(Array.isArray(visualAnalysis?.scene?.cameraFraming) ? visualAnalysis.scene.cameraFraming : []),
    ...(Array.isArray(visualAnalysis?.scene?.lighting) ? visualAnalysis.scene.lighting : []),
  ]);

  // Priorite au scene_context genere par le LLM (camera + style + decor)
  if (sceneContext) {
    return translateVideoPromptFragment(sceneContext, {
      subject: sequencePlan?.canonicalSubject,
      canonicalSubject: sequencePlan?.canonicalSubject,
      universe,
    });
  }

  if (visualSceneFragments.length) {
    const translatedVisualScene = normalizePromptList(
      visualSceneFragments.map((fragment) => translateVideoPromptFragment(fragment, {
        subject: sequencePlan?.canonicalSubject,
        canonicalSubject: sequencePlan?.canonicalSubject,
        universe,
      }))
    );
    const base = translatedVisualScene.join(', ');
    return styleHint ? `${base}, ${styleHint}` : base;
  }

  const fallbackLocks = extractStableSceneFragments(basePrompt, motionProfile);
  const englishLocks = normalizePromptList(
    fallbackLocks.map((lock) => translateVideoPromptFragment(lock, {
      subject: sequencePlan?.canonicalSubject,
      canonicalSubject: sequencePlan?.canonicalSubject,
      universe,
    }))
  );

  if (englishLocks.length) {
    const base = englishLocks.join(', ');
    return styleHint ? `${base}, ${styleHint}` : base;
  }

  if (
    String(sequencePlan?.providerUsed || '').trim() === 'janus'
    && referenceAnalysis?.scene?.sceneType
  ) {
    return `coherent ${String(referenceAnalysis.scene.sceneType).trim().toLowerCase()} scene, main subject clearly visible`;
  }

  return styleHint
    ? `coherent framing, main subject clearly visible, ${styleHint}`
    : 'coherent framing, main subject clearly visible';
}

function sanitizeWikidataArtifacts(value = '') {
  return String(value || '')
    .replace(/\bCreee? Par\b[^,.]*/gi, '')
    .replace(/\bCree Par\b[^,.]*/gi, '')
    .replace(/\bCreated By\b[^,.]*/gi, '')
    .replace(/\bShigeru\b[^,.]*/gi, '')
    .replace(/\bMiyamoto\b[^,.]*/gi, '')
    .replace(/\bNintendo\b[^,.]*/gi, '')
    .replace(/,\s*,/g, ',')
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function withMainSubjectContinuityPrefix(value = '') {
  const text = transliterateForSd(value);
  if (!text) return text;
  if (/^main subject pose continuity\s*:/i.test(text)) return text;
  return `main subject pose continuity: ${text}`;
}

function withSceneContinuityPrefix(value = '') {
  const text = transliterateForSd(sanitizeWikidataArtifacts(value));
  if (!text) return text;
  if (/^scene camera decor continuity\s*:/i.test(text)) return text;
  return `scene camera decor continuity: ${text}`;
}

function withVisibleFrameDeltaPrefix(value = '') {
  const text = transliterateForSd(value);
  if (!text) return text;
  if (/^visible frame delta anatomy prop detail\s*:/i.test(text)) return text;
  return `visible frame delta anatomy prop detail: ${text}`;
}

function buildIdentitySentence(sequencePlan = {}) {
  const motionProfile = String(sequencePlan?.motionProfile || 'generic').trim() || 'generic';
  const locks = normalizePromptList([
    ...(sequencePlan?.identityLocks || []),
    ...(sequencePlan?.continuityLocks || []),
    ...(sequencePlan?.visualAnalysis?.continuityAnchors || []),
  ]);
  const resolvedLocks = locks.length
    ? locks
    : resolveDefaultIdentityLocks(motionProfile);
  const translatedLocks = normalizePromptList(
    resolvedLocks.map((entry) => translateVideoPromptFragment(entry, {
      subject: sequencePlan?.canonicalSubject,
      canonicalSubject: sequencePlan?.canonicalSubject,
      universe: sequencePlan?.universe,
    }))
  );
  const continuityDirectives = [
    'coherent camera setup and framing family',
    'coherent background, lighting, color palette and art style unless the request changes them',
    'same core subject identity, proportions and silhouette',
  ];
  return `keep ${normalizePromptList([...translatedLocks, ...continuityDirectives]).join(', ')}`;
}

function concretizeSubjectPrompt(value = '', subject = '') {
  const normalizedValue = String(value || '').trim();
  const normalizedSubject = String(subject || '').trim();
  if (!normalizedValue) return '';
  if (!normalizedSubject) return normalizedValue;
  const subjectLookup = normalizeAsciiText(normalizedSubject).toLowerCase();
  const valueLookup = normalizeAsciiText(normalizedValue).toLowerCase();
  if (subjectLookup && valueLookup.includes(subjectLookup)) {
    return normalizedValue;
  }
  if (/\bthe structure\b/i.test(normalizedValue)) {
    return normalizedValue.replace(/\bthe structure\b/i, normalizedSubject);
  }
  if (/\bstructure\b/i.test(normalizedValue)) {
    return normalizedValue.replace(/\bstructure\b/i, normalizedSubject);
  }
  if (/\b(sword|blade|hilt|armor|armour|gauntlet|cape|bow|arrow|shield|gun|pistol|bat|staff|horse|hoof|mane|face|hair|aura|energy|hall|torch|crown|helmet|fists?)\b/i.test(normalizedValue)) {
    return `${normalizedSubject}, ${normalizedValue}`;
  }
  return normalizedValue;
}

function visualizeSoundCue(soundCue = '') {
  const cue = normalizeVideoLookup(soundCue);
  if (!cue) return '';
  if (/\b(clang|ring|metal|sword)\b/.test(cue)) return 'brief metallic glint near the prop';
  if (/\b(boom|impact|thud|slam)\b/.test(cue)) return 'small impact shock visible around the contact point';
  if (/\b(whoosh|swish|rush)\b/.test(cue)) return 'motion trail visible around the movement';
  if (/\b(crackle|spark|electric|thunder)\b/.test(cue)) return 'small electric sparks visible around the energy';
  if (/\b(roar|shout|scream|yell)\b/.test(cue)) return 'open mouth or tense expression visible during the action';
  if (/\b(step|footstep|hoofbeat)\b/.test(cue)) return 'dust kick or ground contact visible under the moving step';
  return 'visible emphasis around the action';
}

function buildVariationPrompt(beat = {}, subject = '') {
  const resolvedBeat = normalizeSequenceBeat(beat);
  const clauses = normalizePromptList([
    ...splitFramePromptClauses(concretizeSubjectPrompt(resolvedBeat.variation || '', subject)),
    ...resolvedBeat.rendererFocus,
    ...(Array.isArray(resolvedBeat.soundCues) ? resolvedBeat.soundCues.map((cue) => visualizeSoundCue(cue)) : []),
  ]);
  return clauses.join(', ') || 'advance the pose by one visible step';
}

function shouldPromoteVariationToStructure(beat = {}, motionProfile = 'generic') {
  const resolvedBeat = normalizeSequenceBeat(beat);
  if (resolvedBeat.structuralState) return true;

  const lookup = normalizeVideoLookup([
    resolvedBeat.variation,
    ...resolvedBeat.rendererFocus,
  ].filter(Boolean).join(' '));

  if (!lookup) return false;
  if (['subtle_loop'].includes(String(motionProfile || 'generic').trim() || 'generic')) {
    return /\b(bras|jambe|main|mains|tete|tete|visage|epaule|epaules|bassin|torse|buste|appui|poids)\b/.test(lookup);
  }

  return true;
}

function resolveFrameAnatomyHints(motionProfile = 'generic', beat = {}) {
  const resolvedBeat = normalizeSequenceBeat(beat);
  const lookup = normalizeVideoLookup([
    resolvedBeat.structuralState,
    resolvedBeat.variation,
    ...resolvedBeat.rendererFocus,
  ].filter(Boolean).join(' '));
  const hints = [];

  if (!lookup) return hints;

  if (/\bjambe gauche\b.*\b(avance|devant|revient)\b/.test(lookup)) {
    hints.push('left leg clearly ahead of the hips');
  }
  if (/\bjambe droite\b.*\b(avance|devant|revient)\b/.test(lookup)) {
    hints.push('right leg clearly ahead of the hips');
  }
  if (/\bpoids sur la jambe gauche\b|\bjambe gauche porte l appui\b/.test(lookup)) {
    hints.push('left leg carries the main support');
  }
  if (/\bpoids sur la jambe droite\b|\bjambe droite porte l appui\b/.test(lookup)) {
    hints.push('right leg carries the main support');
  }
  if (/\bbras gauche\b.*\b(devant|haut|leve|levé|monte|monte)\b/.test(lookup)) {
    hints.push('left arm clearly higher or more forward');
  }
  if (/\bbras droit\b.*\b(devant|haut|leve|levé|monte|monte)\b/.test(lookup)) {
    hints.push('right arm clearly higher or more forward');
  }
  if (/\bbras bien ouverts\b|\bbras ouverts\b|\bbra[sx] ecartes\b/.test(lookup)) {
    hints.push('two clearly separated arms');
  }
  if (/\bpoings? fermes?\b|\bpoings? serres?\b/.test(lookup)) {
    hints.push('two clenched fists clearly visible');
  }
  if (/\barc\b.*\bleve\b|\barc leve\b/.test(lookup)) {
    hints.push('bow arm extended and drawing hand distinct');
  }
  if (/\bcorde\b.*\btiree?\b|\btraction\b/.test(lookup)) {
    hints.push('drawing hand pulled back near the face');
  }
  if (/\bbuste\b.*\bpenche\b|\btorse\b.*\bouvert\b|\bpoitrine\b.*\bouverte\b/.test(lookup)) {
    hints.push('torso and shoulders clearly visible');
  }
  if (/\bcheveux\b/.test(lookup) && /\baura\b|\benergie\b|\beclairs?\b/.test(lookup)) {
    hints.push('hair and energy visible without hiding the face');
  }

  switch (String(motionProfile || 'generic').trim() || 'generic') {
    case 'walk_cycle':
    case 'run_cycle': {
      const subjectType = detectSubjectType([
        resolvedBeat.structuralState,
        resolvedBeat.variation,
        ...resolvedBeat.rendererFocus,
      ].filter(Boolean).join(' '));
      if (subjectType === 'horse' || subjectType === 'quadruped' || subjectType === 'dragon') {
        hints.push('four distinct and visible legs');
        hints.push('at least one leg visibly in motion');
        hints.push('complete animal silhouette visible');
      } else {
        hints.push('two distinct legs with one supporting and one moving');
        hints.push('opposite arm swing');
        hints.push('hips and shoulders clearly visible');
      }
      break;
    }
    case 'archery_shot':
    case 'mounted_archery':
      hints.push('two distinct arms during the shot');
      hints.push('complete bow and arrow visible');
      hints.push('shoulders aligned for aiming');
      break;
    case 'transformation_rise':
    case 'power_up_loop':
      hints.push('clean torso and arm anatomy');
      hints.push('face always visible');
      hints.push('energy visible without swallowing the silhouette');
      break;
    case 'action_burst':
      hints.push('main gesture visible with two distinct arms');
      hints.push('clear weight transfer');
      hints.push('clean silhouette at peak action');
      break;
    default:
      hints.push('clean anatomy with two distinct arms');
      hints.push('body supports clearly visible');
      break;
  }

  return normalizePromptList(hints).slice(0, 4);
}

function buildFramePromptPlan(basePrompt = '', {
  beat = null,
  sequencePlan = null,
  referenceAnalysis = null,
} = {}) {
  const resolvedSequencePlan = sequencePlan && typeof sequencePlan === 'object'
    ? sequencePlan
    : {};
  const concreteBeat = normalizeSequenceBeat(beat || {
    label: 'continuite',
    variation: 'faire avancer la posture d une etape visible',
  });
  const motionProfile = String(resolvedSequencePlan.motionProfile || 'generic').trim() || 'generic';
  const rawSubject = resolvePromptSubject(basePrompt, motionProfile);
  const canonicalSubject = resolveCanonicalSubjectLabel(rawSubject, {
    preferred: resolvedSequencePlan.canonicalSubject,
    universe: resolvedSequencePlan.universe,
  });
  const sequencePlanForTranslation = {
    ...resolvedSequencePlan,
    canonicalSubject,
  };
  const concreteSubject = canonicalSubject || rawSubject;
  const defaultStructuralPrompt = resolveDefaultStructuralPrompt({
    subject: concreteSubject,
    motionProfile,
    basePrompt,
  });
  const sceneSentence = buildSceneSentence(basePrompt, sequencePlanForTranslation, referenceAnalysis);
  const continuitySentence = buildIdentitySentence(sequencePlanForTranslation);
  const checkpointStructuralSource = concretizeSubjectPrompt(
    concreteBeat.structuralState || concreteBeat.variation,
    concreteSubject
  );
  const hasDistinctCheckpointVariation = (
    concreteBeat.checkpoint
    && concreteBeat.variation
    && normalizeVideoLookup(concreteBeat.variation) !== normalizeVideoLookup(checkpointStructuralSource)
  );
  const promoteVariationToStructure = shouldPromoteVariationToStructure(concreteBeat, motionProfile);
  const anatomyHints = resolveFrameAnatomyHints(motionProfile, concreteBeat);
  const structuralStateConcrete = concretizeSubjectPrompt(concreteBeat.structuralState, concreteSubject);
  const variationConcrete = concretizeSubjectPrompt(concreteBeat.variation, concreteSubject);

  let structuralPrompt = defaultStructuralPrompt;
  // Si le beat vient du LLM anglais (variation en anglais), utiliser directement sans prefixe francais
  const beatIsEnglish = /\b(the|a|an|is|are|with|and|his|her|its|on|in|at|of|to|from|by|for)\b/i.test(
    String(concreteBeat.structuralState || concreteBeat.variation || '')
  );
  if (concreteBeat.checkpoint) {
    structuralPrompt = beatIsEnglish
      ? normalizeFramePromptFragment(checkpointStructuralSource)
      : buildCheckpointStructuralPrompt(concreteSubject, checkpointStructuralSource, defaultStructuralPrompt);
  } else if (structuralStateConcrete) {
    structuralPrompt = beatIsEnglish
      ? normalizeFramePromptFragment(structuralStateConcrete)
      : buildStructuralOverridePrompt(concreteSubject, structuralStateConcrete, defaultStructuralPrompt);
  } else if (promoteVariationToStructure && variationConcrete) {
    structuralPrompt = beatIsEnglish
      ? normalizeFramePromptFragment(variationConcrete)
      : buildStructuralOverridePrompt(concreteSubject, variationConcrete, defaultStructuralPrompt);
  }

  let frameVariationPrompt = buildVariationPrompt({
    ...concreteBeat,
    structuralState: structuralStateConcrete || concreteBeat.structuralState,
    variation: variationConcrete || concreteBeat.variation,
  }, concreteSubject);
  if (concreteBeat.checkpoint && !hasDistinctCheckpointVariation) {
    frameVariationPrompt = buildCheckpointVariationPrompt(checkpointStructuralSource);
  }
  const frameActionPrompt = normalizePromptList([
    frameVariationPrompt,
    anatomyHints.length ? `clear anatomy: ${anatomyHints.join(', ')}` : '',
  ]).join('. ');
  let translatedStructuralPrompt = translateVideoPromptFragment(structuralPrompt, {
    subject: concreteSubject,
    canonicalSubject,
    universe: sequencePlanForTranslation.universe,
  });
  if (
    concreteSubject
    && !normalizeAsciiText(translatedStructuralPrompt).toLowerCase().includes(normalizeAsciiText(concreteSubject).toLowerCase())
  ) {
    translatedStructuralPrompt = `${concreteSubject}, ${translatedStructuralPrompt}`;
  }
  const translatedStableIdentityPrompt = translateVideoPromptFragment([sceneSentence, continuitySentence].filter(Boolean).join('. '), {
    subject: concreteSubject,
    canonicalSubject,
    universe: sequencePlanForTranslation.universe,
  });
  const translatedFrameVariationPrompt = translateVideoPromptFragment(frameActionPrompt || frameVariationPrompt, {
    subject: concreteSubject,
    canonicalSubject,
    universe: sequencePlanForTranslation.universe,
  });

  return {
    structuralPrompt: translatedStructuralPrompt,
    stableIdentityPrompt: translatedStableIdentityPrompt,
    frameVariationPrompt: translatedFrameVariationPrompt,
    prompt: withMainSubjectContinuityPrefix(translatedStructuralPrompt),
    prompt_2: withSceneContinuityPrefix(translatedStableIdentityPrompt),
    prompt_3: withVisibleFrameDeltaPrefix(translatedFrameVariationPrompt),
    negative_prompt_video: 'text, watermark, caption, subtitle, label, signature, logo, letters, words, writing, inscription',
  };
}

function buildFramePrompt(basePrompt = '', options = {}) {
  const promptPlan = buildFramePromptPlan(basePrompt, options);
  return [
    promptPlan.prompt,
    promptPlan.prompt_2,
    promptPlan.prompt_3,
  ].filter(Boolean).join('. ');
}

module.exports = {
  buildFramePrompt,
  buildFramePromptPlan,
};
