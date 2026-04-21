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
  translateImagePromptToEnglish,
} = require('../mask/build-sd-prompt-bundle.cjs');

const VIDEO_ENGLISH_PHRASE_REPLACEMENTS = [
  ['sur un sentier', 'on a path'],
  ['sur le chemin', 'on the path'],
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
];

function transliterateForSd(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2019\u2018]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .trim();
}

function normalizeAsciiText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
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

function translateVideoPromptFragment(value = '', options = {}) {
  const normalized = normalizeAsciiText(value);
  if (!normalized) return '';
  const normalizedLower = normalized.toLowerCase();
  const originalSubject = String(options?.subject || '').trim();
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

  if (
    originalStartsWithSubject
    && originalSubject
    && !normalizeAsciiText(translated).toLowerCase().startsWith(normalizeAsciiText(originalSubject).toLowerCase())
  ) {
    translated = `${originalSubject}, ${translated}`;
  }

  translated = restoreNamedTermsCasing(translated, [
    options?.subject,
    options?.canonicalSubject,
    options?.universe,
  ]);

  return translated;
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
  const universe = String(sequencePlan?.universe || referenceAnalysis?.universe || '').trim();
  const styleHint = universe ? `style illustration ${universe}` : '';
  const sceneContext = String(sequencePlan?.sceneContext || '').trim();

  // Priorite au scene_context genere par le LLM (camera + style + decor)
  if (sceneContext) {
    return `stable scene and composition: ${translateVideoPromptFragment(sceneContext, {
      subject: sequencePlan?.canonicalSubject,
      canonicalSubject: sequencePlan?.canonicalSubject,
      universe,
    })}`;
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
    const base = `stable scene and composition: ${englishLocks.join(', ')}`;
    return styleHint ? `${base}, ${styleHint}` : base;
  }

  if (
    String(sequencePlan?.providerUsed || '').trim() === 'janus'
    && referenceAnalysis?.scene?.sceneType
  ) {
    return `stable scene and composition: coherent ${String(referenceAnalysis.scene.sceneType).trim().toLowerCase()} scene, main subject clearly visible`;
  }

  return styleHint
    ? `stable scene and composition: coherent framing, main subject clearly visible, ${styleHint}`
    : 'stable scene and composition: coherent framing, main subject clearly visible';
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

function buildIdentitySentence(sequencePlan = {}) {
  const motionProfile = String(sequencePlan?.motionProfile || 'generic').trim() || 'generic';
  const locks = normalizePromptList(sequencePlan?.identityLocks || []);
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
  return `keep ${translatedLocks.join(', ')}`;
}

function buildVariationPrompt(beat = {}) {
  const resolvedBeat = normalizeSequenceBeat(beat);
  const clauses = normalizePromptList([
    ...splitFramePromptClauses(resolvedBeat.variation || ''),
    ...resolvedBeat.rendererFocus,
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
  const subject = resolvePromptSubject(basePrompt, motionProfile);
  const defaultStructuralPrompt = resolveDefaultStructuralPrompt({
    subject,
    motionProfile,
    basePrompt,
  });
  const sceneSentence = buildSceneSentence(basePrompt, resolvedSequencePlan, referenceAnalysis);
  const continuitySentence = buildIdentitySentence(resolvedSequencePlan);
  const checkpointStructuralSource = concreteBeat.structuralState || concreteBeat.variation;
  const hasDistinctCheckpointVariation = (
    concreteBeat.checkpoint
    && concreteBeat.variation
    && normalizeVideoLookup(concreteBeat.variation) !== normalizeVideoLookup(checkpointStructuralSource)
  );
  const promoteVariationToStructure = shouldPromoteVariationToStructure(concreteBeat, motionProfile);
  const anatomyHints = resolveFrameAnatomyHints(motionProfile, concreteBeat);
  const canonicalSubject = String(resolvedSequencePlan.canonicalSubject || '').trim();

  let structuralPrompt = defaultStructuralPrompt;
  // Si le beat vient du LLM anglais (variation en anglais), utiliser directement sans prefixe francais
  const beatIsEnglish = /\b(the|a|an|is|are|with|and|his|her|its|on|in|at|of|to|from|by|for)\b/i.test(
    String(concreteBeat.structuralState || concreteBeat.variation || '')
  );
  if (concreteBeat.checkpoint) {
    structuralPrompt = beatIsEnglish
      ? normalizeFramePromptFragment(checkpointStructuralSource)
      : buildCheckpointStructuralPrompt(subject, checkpointStructuralSource, defaultStructuralPrompt);
  } else if (concreteBeat.structuralState) {
    structuralPrompt = beatIsEnglish
      ? normalizeFramePromptFragment(concreteBeat.structuralState)
      : buildStructuralOverridePrompt(subject, concreteBeat.structuralState, defaultStructuralPrompt);
  } else if (promoteVariationToStructure && concreteBeat.variation) {
    structuralPrompt = beatIsEnglish
      ? normalizeFramePromptFragment(concreteBeat.variation)
      : buildStructuralOverridePrompt(subject, concreteBeat.variation, defaultStructuralPrompt);
  }

  let frameVariationPrompt = buildVariationPrompt(concreteBeat);
  if (concreteBeat.checkpoint && !hasDistinctCheckpointVariation) {
    frameVariationPrompt = buildCheckpointVariationPrompt(checkpointStructuralSource);
  }
  const frameActionPrompt = normalizePromptList([
    frameVariationPrompt,
    anatomyHints.length ? `clear anatomy: ${anatomyHints.join(', ')}` : '',
  ]).join('. ');
  let translatedStructuralPrompt = translateVideoPromptFragment(structuralPrompt, {
    subject,
    canonicalSubject,
    universe: resolvedSequencePlan.universe,
  });
  if (
    subject
    && !normalizeAsciiText(translatedStructuralPrompt).toLowerCase().includes(normalizeAsciiText(subject).toLowerCase())
  ) {
    translatedStructuralPrompt = `${subject}, ${translatedStructuralPrompt}`;
  }
  const translatedStableIdentityPrompt = translateVideoPromptFragment([sceneSentence, continuitySentence].filter(Boolean).join('. '), {
    subject,
    canonicalSubject,
    universe: resolvedSequencePlan.universe,
  });
  const translatedFrameVariationPrompt = translateVideoPromptFragment(frameActionPrompt || frameVariationPrompt, {
    subject,
    canonicalSubject,
    universe: resolvedSequencePlan.universe,
  });

  return {
    structuralPrompt: translatedStructuralPrompt,
    stableIdentityPrompt: translatedStableIdentityPrompt,
    frameVariationPrompt: translatedFrameVariationPrompt,
    prompt: transliterateForSd(`stable base structure: ${translatedStructuralPrompt}`),
    prompt_2: transliterateForSd(sanitizeWikidataArtifacts(translatedStableIdentityPrompt)),
    prompt_3: transliterateForSd(concreteBeat.checkpoint
      ? `visual checkpoint of this frame: ${translatedFrameVariationPrompt}`
      : `visible change in this frame: ${translatedFrameVariationPrompt}`),
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
