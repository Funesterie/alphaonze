const { normalizeIntentType } = require('./semantic/semantic-utils.cjs');
const {
  collectUniqueColorsFromWordItems,
  detectColorMatchesFromText,
  stripTrailingColorPhrase,
} = require('./semantic/color-library.cjs');
const {
  stripTrailingStylePhrase,
} = require('./semantic/style-library.cjs');
const {
  collectUniqueElementsFromWordItems,
} = require('./semantic/element-library.cjs');
const {
  collectUniqueMetiersFromWordItems,
} = require('./semantic/metier-library.cjs');
const {
  collectUniqueAccessoriesFromWordItems,
} = require('./semantic/accessory-library.cjs');
const {
  resolveSubjectProfile,
} = require('./semantic/subject-profile-library.cjs');
const {
  resolveImageDimensionConfig,
} = require('./normalize-mask-image-generate.cjs');

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function toUniqueStrings(values = []) {
  return [...new Set(
    values
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  )];
}

function splitCsvValues(value) {
  return toUniqueStrings(
    String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function normalizeLookupText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getSemanticMeta(wazaa = null, opts = {}) {
  if (opts?.semanticAnalysis && typeof opts.semanticAnalysis === 'object') {
    const wordItems = Array.isArray(opts.semanticAnalysis?.levels?.words?.items)
      ? opts.semanticAnalysis.levels.words.items
      : [];
    const semanticColors = collectUniqueColorsFromWordItems(wordItems).slice(0, 6);
    const semanticStyles = wordItems
      .filter((item) => item?.style?.label)
      .map((item) => item.style)
      .filter((entry, index, items) => entry?.key && items.findIndex((candidate) => candidate?.key === entry.key) === index)
      .slice(0, 6);
    const semanticScenes = wordItems
      .filter((item) => item?.scene?.label)
      .map((item) => item.scene)
      .filter((entry, index, items) => entry?.key && items.findIndex((candidate) => candidate?.key === entry.key) === index)
      .slice(0, 6);
    const semanticElements = collectUniqueElementsFromWordItems(wordItems).slice(0, 6);
    const semanticMetiers = collectUniqueMetiersFromWordItems(wordItems).slice(0, 6);
    const semanticAccessories = collectUniqueAccessoriesFromWordItems(wordItems).slice(0, 6);
    const colorWords = semanticColors.map((entry) => entry.label).slice(0, 6);
    const styleWords = semanticStyles.map((entry) => String(entry.label || '').trim()).filter(Boolean);
    const sceneWords = semanticScenes.map((entry) => String(entry.label || '').trim()).filter(Boolean);
    const elementWords = semanticElements.map((entry) => String(entry.label || '').trim()).filter(Boolean);
    const metierWords = semanticMetiers.map((entry) => String(entry.label || '').trim()).filter(Boolean);
    const accessoryWords = semanticAccessories.map((entry) => String(entry.label || '').trim()).filter(Boolean);
    return {
      subject: String(opts.semanticAnalysis?.subject || '').trim(),
      confidence: Number(opts.semanticAnalysis?.summary?.confidence || 0),
      activeModuleIds: Array.isArray(opts.semanticAnalysis?.knowledge?.activeModules)
        ? opts.semanticAnalysis.knowledge.activeModules.map((entry) => String(entry?.id || '').trim()).filter(Boolean)
        : [],
      colors: semanticColors,
      colorWords,
      styles: semanticStyles,
      styleWords,
      scenes: semanticScenes,
      sceneWords,
      elements: semanticElements,
      elementWords,
      metiers: semanticMetiers,
      metierWords,
      accessories: semanticAccessories,
      accessoryWords,
      subjectProfile: resolveSubjectProfile({
        subject: String(opts.semanticAnalysis?.subject || '').trim(),
        sourceText: String(opts.semanticAnalysis?.sourceText || '').trim(),
      }),
      wordTags: wordItems
        .map((item) => ({
          word: String(item.word || '').trim(),
          tags: Array.isArray(item.tags) ? item.tags.filter(Boolean) : [],
        }))
        .filter((item) => item.word),
    };
  }
  return wazaa?.meta?.semantic && typeof wazaa.meta.semantic === 'object'
    ? wazaa.meta.semantic
    : {};
}

function semanticHasWordTag(semanticMeta = {}, tag = '') {
  const normalizedTag = String(tag || '').trim();
  if (!normalizedTag) return false;
  const wordTags = Array.isArray(semanticMeta?.wordTags) ? semanticMeta.wordTags : [];
  return wordTags.some((entry) => Array.isArray(entry?.tags) && entry.tags.includes(normalizedTag));
}

function semanticHasModule(semanticMeta = {}, moduleId = '') {
  const normalizedModuleId = String(moduleId || '').trim();
  if (!normalizedModuleId) return false;
  const activeModuleIds = Array.isArray(semanticMeta?.activeModuleIds) ? semanticMeta.activeModuleIds : [];
  return activeModuleIds.includes(normalizedModuleId);
}

function buildPositiveCompositionHints(subject = '', sourceText = '', semanticMeta = {}) {
  const hints = [];
  const hasSubject = Boolean(String(subject || semanticMeta?.subject || '').trim());

  if (hasSubject) {
    hints.push(
      'sujet unique bien cadré',
      'silhouette lisible',
      'forme complète visible'
    );
  }

  if (semanticHasModule(semanticMeta, 'image.composition.core')) {
    hints.push('espace visuel équilibré');
  }

  if (semanticHasModule(semanticMeta, 'image.reference.characters')) {
    hints.push('silhouette reconnaissable');
    hints.push('focus sur le sujet');
  }

  if (semanticHasWordTag(semanticMeta, 'color')) {
    hints.push('couleurs lisibles sur le sujet');
  }

  if (Number(semanticMeta?.confidence || 0) >= 0.58) {
    hints.push('lecture simple et claire');
  }

  return toUniqueStrings(hints);
}

function buildMetierSemanticHints(semanticMeta = {}, subjectProfile = null) {
  const metiers = Array.isArray(semanticMeta?.metiers) ? semanticMeta.metiers : [];
  const hints = {
    style: [],
    composition: [],
    environment: [],
    promptInstructions: [],
  };

  for (const metier of metiers) {
    const family = String(metier?.family || '').trim().toLowerCase();
    const label = String(metier?.label || '').trim();
    if (family !== 'human_role') continue;

    hints.composition.push('figure humaine lisible', 'présence humaine claire');
    if (label) {
      hints.promptInstructions.push(`Montrer clairement une figure de ${label} unique et reconnaissable.`);
    }
  }

  if (subjectProfile?.type === 'single_human_figure' && metiers.length) {
    hints.composition.push('une seule personne complète', 'posture claire et lisible');
    hints.environment.push('fond simple cohérent avec le personnage');
  }

  return {
    style: toUniqueStrings(hints.style),
    composition: toUniqueStrings(hints.composition),
    environment: toUniqueStrings(hints.environment),
    promptInstructions: toUniqueStrings(hints.promptInstructions),
  };
}

function buildElementSemanticHints(semanticMeta = {}, subjectProfile = null) {
  const elements = Array.isArray(semanticMeta?.elements) ? semanticMeta.elements : [];
  const hints = {
    style: [],
    composition: [],
    environment: [],
    promptInstructions: [],
  };

  for (const element of elements) {
    const family = String(element?.family || '').trim().toLowerCase();
    switch (family) {
      case 'ice':
        hints.style.push('matière glacée lisible', 'textures cristallines');
        hints.composition.push('givre visible sur le sujet', 'formes nettes et froides');
        hints.environment.push('atmosphère froide et cristalline');
        hints.promptInstructions.push('Montrer clairement la matière glacée sur le sujet.');
        break;
      case 'fire':
        hints.style.push('énergie chaude lisible');
        hints.composition.push('flammes lisibles autour du sujet');
        hints.environment.push('lueur chaude simple');
        hints.promptInstructions.push('Montrer clairement le feu autour du sujet sans le rendre confus.');
        break;
      case 'ghost':
        hints.composition.push('forme spectrale lisible', 'contours bien visibles');
        hints.environment.push('ambiance surnaturelle simple');
        hints.promptInstructions.push('Montrer clairement une présence spectrale complète et lisible.');
        break;
      case 'electric':
        hints.composition.push('énergie électrique lisible');
        hints.environment.push('lueur électrique simple');
        hints.promptInstructions.push('Montrer clairement l énergie électrique autour du sujet.');
        break;
      case 'water':
        hints.composition.push('matière fluide lisible');
        hints.environment.push('ambiance fraîche et fluide');
        break;
      default:
        break;
    }
  }

  if (subjectProfile?.type === 'phoenix_creature' && elements.some((entry) => String(entry?.family || '').trim().toLowerCase() === 'ice')) {
    hints.promptInstructions.push('Représenter un phénix de glace avec des ailes claires, complètes et bien visibles.');
  }

  if (subjectProfile?.type === 'pokemon_creature' && elements.some((entry) => String(entry?.family || '').trim().toLowerCase() === 'ghost')) {
    hints.promptInstructions.push('Représenter un seul pokémon spectre complet, reconnaissable et bien lisible.');
  }

  return {
    style: toUniqueStrings(hints.style),
    composition: toUniqueStrings(hints.composition),
    environment: toUniqueStrings(hints.environment),
    promptInstructions: toUniqueStrings(hints.promptInstructions),
  };
}

function buildAccessorySemanticHints(semanticMeta = {}, sourceText = '') {
  const accessories = Array.isArray(semanticMeta?.accessories) ? semanticMeta.accessories : [];
  const normalizedSource = normalizeLookupText(sourceText);
  const hasSmokingAction = /\b(fume|fumer|fumant|fumante|smoking)\b/.test(normalizedSource);
  const hints = {
    style: [],
    composition: [],
    environment: [],
    promptInstructions: [],
  };

  for (const accessory of accessories) {
    const family = String(accessory?.family || '').trim().toLowerCase();
    const label = String(accessory?.label || '').trim();
    const normalizedLabel = normalizeLookupText(label);
    const explicitlyRequestedWithSubject = normalizedLabel
      && /\bavec\b/.test(normalizedSource)
      && new RegExp(`\\b${normalizedLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(normalizedSource);
    if (!label) continue;

    hints.composition.push('accessoire bien visible');

    switch (family) {
      case 'weapon':
        hints.composition.push('prise claire de l accessoire');
        if (!explicitlyRequestedWithSubject) {
          hints.promptInstructions.push(`Montrer clairement l accessoire ${label} avec le sujet principal.`);
        }
        break;
      case 'wearable':
        if (!explicitlyRequestedWithSubject) {
          hints.promptInstructions.push(`Montrer clairement ${label} porté par le sujet principal.`);
        }
        break;
      case 'food_prop':
        if (!/\bdans la bouche\b/.test(normalizedSource) && !explicitlyRequestedWithSubject) {
          hints.promptInstructions.push(`Montrer clairement l accessoire ${label} avec le sujet principal.`);
        }
        break;
      case 'smoking_prop':
        hints.composition.push('geste de l accessoire lisible');
        if (hasSmokingAction) {
          hints.composition.push('cigarette bien visible près de la bouche');
          hints.promptInstructions.push(`Montrer clairement le sujet principal en train de fumer avec ${label} visible près de la bouche.`);
        } else if (!explicitlyRequestedWithSubject) {
          hints.promptInstructions.push(`Montrer clairement l accessoire ${label} tenu par le sujet principal.`);
        }
        break;
      default:
        if (!explicitlyRequestedWithSubject) {
          hints.promptInstructions.push(`Inclure clairement l accessoire ${label} avec le sujet principal.`);
        }
        break;
    }
  }

  return {
    style: toUniqueStrings(hints.style),
    composition: toUniqueStrings(hints.composition),
    environment: toUniqueStrings(hints.environment),
    promptInstructions: toUniqueStrings(hints.promptInstructions),
  };
}

function sanitizeEnvironmentCandidate(value = '') {
  const normalized = String(value || '')
    .trim()
    .replace(/^(?:dans|sur|sous|devant|derriere|derrière|au milieu de|au bord de|pres de|près de|a cote de|à côté de)\s+/i, (match) => match.toLowerCase())
    .replace(/\b(?:en style|style|haute qualite|haute qualité|high quality|ultra detaille|ultra détaillé|avec une?|avec un|portant|tenant)\b.*$/i, '')
    .replace(/[,.!?;:]+$/g, '')
    .trim();
  if (!normalized) return '';
  const normalizedLookup = normalizeLookupText(normalized);
  if (/^(?:dans|sur|sous)\s+(?:la|le|les|un|une|des|sa|son|ses)\s+(?:bouche|gueule|main|mains|bec|tete|tête|dos|bras|jambe|jambes|patte|pattes|epaule|épaule|epaules|épaules|visage|oeil|oeils|yeux)$/.test(normalizedLookup)) {
    return '';
  }
  if (normalized.split(/\s+/).length > 12) return '';
  return normalized;
}

function extractFallbackEnvironmentFromSourceText(sourceText = '') {
  const raw = String(sourceText || '').trim();
  if (!raw) return '';

  const patterns = [
    /\b(au milieu de\s+[^,.!?;:]+)/i,
    /\b(au bord de\s+[^,.!?;:]+)/i,
    /\b(dans\s+[^,.!?;:]+)/i,
    /\b(sur\s+[^,.!?;:]+)/i,
    /\b(sous\s+[^,.!?;:]+)/i,
    /\b(devant\s+[^,.!?;:]+)/i,
    /\b(derriere\s+[^,.!?;:]+)/i,
    /\b(derrière\s+[^,.!?;:]+)/i,
    /\b(pres de\s+[^,.!?;:]+)/i,
    /\b(près de\s+[^,.!?;:]+)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    const candidate = sanitizeEnvironmentCandidate(match?.[1] || '');
    if (candidate) return candidate;
  }

  return '';
}

function buildCoherentEnvironmentHints(subject = '', sourceText = '', definitionSummary = '') {
  const hints = [];
  const normalizedDefinitionSummary = normalizeLookupText(definitionSummary);
  const normalizedSource = normalizeLookupText(sourceText);
  const hasSubject = Boolean(String(subject || '').trim());

  if (normalizedDefinitionSummary) {
    hints.push('décor cohérent avec le sujet décrit');
  }

  if (!hints.length && /\b(dans|sur|sous|devant|derriere|derrière|milieu|bord)\b/.test(normalizedSource)) {
    hints.push('décor cohérent avec la scène demandée');
  }

  if (!hints.length && hasSubject) {
    hints.push('décor simple et cohérent avec le sujet');
  }

  return toUniqueStrings(hints);
}

function extractSimplePalette(sourceText = '') {
  return toUniqueStrings(
    detectColorMatchesFromText(sourceText).map((entry) => entry.label)
  );
}

function extractSearchQueryFromText(sourceText) {
  const raw = String(sourceText || '').trim();
  if (!raw) return '';

  const patterns = [
    /\bimage\s+de\s+(.+)$/i,
    /^(?:montre(?:-|\s)?moi|affiche|cherche|trouve|show me|find)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    if (!match) continue;
    return String(match[1] || '')
      .replace(/^(?:une?|des)\s+/i, '')
      .replace(/[?.!]\s*$/, '')
      .trim();
  }

  return raw;
}

function getWazaaIntent(wazaa) {
  return normalizeIntentType(
    wazaa?.intent?.type || wazaa?.intents?.[0]?.type || 'chat.reply',
    'chat.reply'
  );
}

function getEntityValue(wazaa, role) {
  const entry = toList(wazaa?.entities).find((item) => String(item?.role || '').trim() === role);
  return String(entry?.value || '').trim();
}

function getSourceText(wazaa) {
  return String(
    wazaa?.meta?.sourceText
    || wazaa?.meta?.translatedText
    || ''
  ).trim();
}

function shouldPreferSemanticPrompt(wazaa) {
  return Boolean(
    wazaa?.meta?.llmEnriched === true
    || String(wazaa?.meta?.promptText || '').trim()
    || String(wazaa?.meta?.translatedText || '').trim()
  );
}

function sanitizeImageSubjectCandidate(value = '') {
  const normalized = String(value || '')
    .trim()
    .replace(/^(?:d['’]\s*un|d['’]\s*une|d['’]\s*des|d\s+un|d\s+une|d\s+des|de\s+la|de\s+l['’]?|du|des|un|une|le|la|les)\s+/i, '');
  if (!normalized) return '';
  if (/\b(?:image\s+of|generate|g[eé]n[eè]re|show me|montre(?:-|\s)?moi|dessine|draw|create|cr[eée]e|je veux|i want)\b/i.test(normalized)) {
    return '';
  }
  if (
    /^(?:d['’]?(?:un|une)?|de|du|des|de\s+la|de\s+l['’]|la|le|les|un|une)$/i.test(normalized)
    || /^(?:d['’](?:un|une)|de\s+la|de\s+l['’])\s*$/i.test(normalized)
  ) {
    return '';
  }
  if (/^(?:one|a|an|the|un|une|des|du|de|la|le|les)$/i.test(normalized)) {
    return '';
  }
  return normalized;
}

function extractAccessoryPromptInstructions(sourceText = '') {
  const raw = String(sourceText || '').trim();
  if (!raw) return [];

  const bodyAttachmentMatch = raw.match(
    /\bavec\s+((?:un|une|des)\s+[^,.!?;:]+?)\s+(dans\s+(?:la|le|les)\s+(?:bouche|gueule|main|mains|bec)|sur\s+(?:la|le|les)\s+(?:tete|tête|dos|epaule|épaule|epaules|épaules))\b/i
  );
  if (bodyAttachmentMatch) {
    const phrase = `${String(bodyAttachmentMatch[1] || '').trim()} ${String(bodyAttachmentMatch[2] || '').trim()}`.trim();
    if (phrase) return [`Montrer clairement ${phrase} du sujet principal.`];
  }

  const genericAccessoryMatch = raw.match(
    /\bavec\s+((?:un|une|des)\s+[^,.!?;:]+?)(?=\s+(?:dans|sur|sous|au milieu de|au bord de|près de|pres de)\b|[,.!?;:]|$)/i
  );
  if (!genericAccessoryMatch) return [];
  const phrase = String(genericAccessoryMatch[1] || '').trim();
  if (!phrase || phrase.split(/\s+/).length > 7) return [];
  return [`Inclure clairement ${phrase} avec le sujet principal.`];
}

function extractFallbackSubjectFromSourceText(sourceText = '') {
  const raw = String(sourceText || '').trim();
  if (!raw) return '';

  return sanitizeImageSubjectCandidate(
    raw
      .replace(/^(?:tu peux|peux[- ]?tu|tu pourrais|pourrais[- ]?tu|je veux|je voudrais|j aimerais|j'aimerais)\s+/i, '')
      .replace(/^que\s+tu\s+/i, '')
      .replace(/^(?:genere|g[eé]n[eéè]r(?:e|er|é|ée)|cree|cr[eé]e(?:r|é|ée)?|dessine(?:r|é|ée)?|fabrique(?:r|é|ée)?|produis|produire|prepare|pr[eé]par(?:e|er|é|ée)|montre|affiche)\s+(?:moi\s+)?/i, '')
      .replace(/^(?:une?\s+)?(?:image|illustration|dessin|photo|visuel|portrait)\s+(?:de|du|de la|de l['’]?|d['’])?\s*/i, '')
      .replace(/\b(?:avec|dans|sur|au milieu de|au bord de|sous|portant|tenant|sortant|sorti|sortie)\b.*$/i, '')
      .trim()
  );
}

function stripPaletteSuffixFromSubject(value = '', palette = []) {
  let output = stripTrailingStylePhrase(stripTrailingColorPhrase(value));
  if (!output) return '';

  const phrases = toUniqueStrings(Array.isArray(palette) ? palette : [])
    .map((entry) => normalizeLookupText(entry))
    .filter(Boolean)
    .map((entry) => entry.split(/\s+/).filter(Boolean))
    .sort((left, right) => right.length - left.length);

  if (!phrases.length) return output;

  let tokens = String(output || '').trim().split(/\s+/).filter(Boolean);
  let normalizedTokens = tokens.map((entry) => normalizeLookupText(entry));
  let changed = true;

  while (tokens.length > 1 && changed) {
    changed = false;
    for (const phraseTokens of phrases) {
      if (!phraseTokens.length || phraseTokens.length >= tokens.length) continue;
      const startIndex = normalizedTokens.length - phraseTokens.length;
      const matches = phraseTokens.every((entry, index) => normalizedTokens[startIndex + index] === entry);
      if (!matches) continue;
      tokens = tokens.slice(0, startIndex);
      normalizedTokens = normalizedTokens.slice(0, startIndex);
      changed = true;
      break;
    }
  }

  output = tokens.join(' ').trim();
  return output || String(value || '').trim();
}

function buildImageGenerateMask(wazaa, sourceText, opts = {}) {
  const imageDimensionConfig = resolveImageDimensionConfig(process.env);
  const promptText = String(wazaa?.meta?.promptText || '').trim();
  const promptSeedText = String(sourceText || promptText || wazaa?.meta?.translatedText || '').trim();
  const semanticMeta = getSemanticMeta(wazaa, opts);
  const subject = sanitizeImageSubjectCandidate(getEntityValue(wazaa, 'subject'))
    || extractFallbackSubjectFromSourceText(sourceText)
    || extractFallbackSubjectFromSourceText(promptText)
    || extractFallbackSubjectFromSourceText(String(wazaa?.meta?.translatedText || '').trim())
    || sourceText
    || promptText;
  const explicitEnvironment = getEntityValue(wazaa, 'environment')
    || extractFallbackEnvironmentFromSourceText(promptSeedText);
  const styleEntity = getEntityValue(wazaa, 'style');
  const attribute = getEntityValue(wazaa, 'attribute');
  const llmColors = Array.isArray(wazaa?.meta?.llmColors) ? wazaa.meta.llmColors : [];
  const definitionSummary = String(wazaa?.meta?.definitionLookup?.summary || '').trim();
  const palette = toUniqueStrings([
    ...llmColors,
    ...(Array.isArray(semanticMeta?.colorWords) ? semanticMeta.colorWords : []),
    ...extractSimplePalette(sourceText),
    ...splitCsvValues(attribute),
  ]);
  const normalizedSubject = sanitizeImageSubjectCandidate(stripPaletteSuffixFromSubject(subject, palette));
  const resolvedSubjectProfile = resolveSubjectProfile({
    subject: normalizedSubject || subject,
    definitionSummary,
    sourceText: promptSeedText,
  });
  const subjectProfile = resolvedSubjectProfile || semanticMeta?.subjectProfile || null;
  const canonicalSubject = sanitizeImageSubjectCandidate(
    String(subjectProfile?.canonicalSubject || '').trim()
  );
  const finalSubject = canonicalSubject || normalizedSubject;
  const metierHints = buildMetierSemanticHints(semanticMeta, subjectProfile);
  const elementHints = buildElementSemanticHints(semanticMeta, subjectProfile);
  const accessoryHints = buildAccessorySemanticHints(semanticMeta, promptSeedText);
  const accessoryPromptInstructions = extractAccessoryPromptInstructions(promptSeedText);
  const style = toUniqueStrings([
    styleEntity,
    ...(Array.isArray(semanticMeta?.styleWords) ? semanticMeta.styleWords : []),
    ...metierHints.style,
    ...elementHints.style,
    ...accessoryHints.style,
    ...(Array.isArray(subjectProfile?.styleHints) ? subjectProfile.styleHints : []),
    'haute qualité',
  ]);
  const composition = toUniqueStrings([
    ...buildPositiveCompositionHints(finalSubject, promptSeedText, semanticMeta),
    ...metierHints.composition,
    ...elementHints.composition,
    ...accessoryHints.composition,
    ...(Array.isArray(subjectProfile?.composition) ? subjectProfile.composition : []),
  ]);
  const profileEnvironment = Array.isArray(subjectProfile?.environment) ? subjectProfile.environment : [];
  const environment = explicitEnvironment
    ? [explicitEnvironment]
    : (
      profileEnvironment.length > 0
        ? toUniqueStrings([
            ...(Array.isArray(semanticMeta?.sceneWords) ? semanticMeta.sceneWords : []),
            ...metierHints.environment,
            ...elementHints.environment,
            ...accessoryHints.environment,
            ...profileEnvironment,
          ])
        : toUniqueStrings([
            ...(Array.isArray(semanticMeta?.sceneWords) ? semanticMeta.sceneWords : []),
            ...metierHints.environment,
            ...elementHints.environment,
            ...accessoryHints.environment,
            ...buildCoherentEnvironmentHints(finalSubject, promptSeedText, definitionSummary),
          ])
    );

  return {
    version: 'mask-1',
    intent: 'image.generate',
    task: { domain: 'image', action: 'generate' },
    compiler: { target: 'image-prompt-en', version: '1.0' },
    inputs: {
      subject: finalSubject ? [finalSubject] : [],
      environment,
      style,
      composition,
      lighting: [],
      palette,
    },
    options: {
      width: imageDimensionConfig.defaultWidth,
      height: imageDimensionConfig.defaultHeight,
      steps: 40,
      guidance_scale: 8,
    },
    constraints: {
      safe_mode: true,
      no_text: true,
    },
    ambiguities: Array.isArray(wazaa?.ambiguities) ? wazaa.ambiguities : [],
    meta: {
      ...(wazaa?.meta && typeof wazaa.meta === 'object' ? wazaa.meta : {}),
      promptCompiler: 'a11-fr-minimal',
      canonicalMaskProducer: 'text-to-wazaa -> wazaa-to-mask',
      promptSeedText,
      promptText: promptSeedText,
      ...(canonicalSubject && canonicalSubject !== normalizedSubject
        ? { canonicalSubject }
        : {}),
      ...(metierHints.promptInstructions.length || elementHints.promptInstructions.length || accessoryHints.promptInstructions.length || accessoryPromptInstructions.length
        ? {
            promptInstructions: toUniqueStrings([
              ...metierHints.promptInstructions,
              ...elementHints.promptInstructions,
              ...accessoryHints.promptInstructions,
              ...accessoryPromptInstructions,
            ]),
          }
        : {}),
      ...(subjectProfile ? { subjectProfile } : {}),
    },
    raw: sourceText,
  };
}

function buildWebImageSearchMask(wazaa, sourceText) {
  const translatedText = String(wazaa?.meta?.translatedText || '').trim();
  const query = extractSearchQueryFromText(sourceText)
    || getEntityValue(wazaa, 'subject')
    || translatedText
    || sourceText;
  return {
    version: 'mask-1',
    intent: 'web.image.search',
    task: { domain: 'web', action: 'image.search' },
    compiler: { target: 'duckduckgo-image-search', version: '1.0' },
    inputs: {
      query,
    },
    options: {},
    constraints: {
      safe_mode: true,
    },
    ambiguities: Array.isArray(wazaa?.ambiguities) ? wazaa.ambiguities : [],
    raw: sourceText,
  };
}

function buildWebSearchMask(wazaa, sourceText) {
  const translatedText = String(wazaa?.meta?.translatedText || '').trim();
  const query = translatedText || getEntityValue(wazaa, 'subject') || sourceText;
  return {
    version: 'mask-1',
    intent: 'web.search',
    task: { domain: 'web', action: 'search' },
    compiler: { target: 'web-search', version: '1.0' },
    inputs: {
      query,
    },
    options: {},
    constraints: {
      safe_mode: true,
    },
    ambiguities: Array.isArray(wazaa?.ambiguities) ? wazaa.ambiguities : [],
    raw: sourceText,
  };
}

function buildFilesystemSortImagesMask(sourceText) {
  const raw = String(sourceText || '').trim();
  const normalized = raw.toLowerCase();
  const triRegex = /trie(?:r|z)?\s+les?\s+([a-z0-9]+)s?\s+(?:de\s+ce\s+dossier|du\s+dossier|dans\s+ce\s+dossier|dans\s+le\s+dossier)?\s*(par\s+(date|nom|taille))?/i;
  const match = triRegex.exec(normalized);
  if (!match) return null;

  const ext = String(match[1] || 'png').replace(/^\./, '');
  let sortBy = 'name';
  if (match[3]) {
    if (match[3].includes('date')) sortBy = 'date';
    else if (match[3].includes('taille')) sortBy = 'size';
    else if (match[3].includes('nom')) sortBy = 'name';
  }

  return {
    version: 'mask-1',
    intent: 'code.python.generate',
    task: {
      domain: 'filesystem',
      action: 'sort_images',
    },
    compiler: {
      target: 'python',
      version: '1.0',
    },
    inputs: {
      path: '.',
      extensions: [ext],
    },
    options: {
      sort_by: sortBy,
      recursive: false,
    },
    constraints: {
      safe_mode: true,
      no_delete: true,
    },
    ambiguities: [],
    raw: raw,
  };
}

function buildGenericCodeMask(sourceText, wazaa) {
  const translatedText = String(wazaa?.meta?.translatedText || '').trim();
  const prompt = translatedText || sourceText;
  return {
    version: 'mask-1',
    intent: 'code.python.generate',
    task: {
      domain: 'python',
      action: 'generate',
    },
    compiler: {
      target: 'python',
      version: '1.0',
    },
    inputs: {
      prompt,
    },
    options: {
      style: 'script',
    },
    constraints: {
      safe_mode: true,
      no_delete: true,
    },
    ambiguities: Array.isArray(wazaa?.ambiguities) ? wazaa.ambiguities : [],
    raw: sourceText,
  };
}

function buildCodePythonMask(wazaa, sourceText) {
  return buildFilesystemSortImagesMask(sourceText) || buildGenericCodeMask(sourceText, wazaa);
}

function buildChatReplyMask(wazaa, sourceText) {
  return {
    version: 'mask-1',
    intent: 'chat.reply',
    task: { domain: 'chat', action: 'reply' },
    compiler: { target: 'chat-response', version: '1.0' },
    inputs: {
      message: sourceText,
    },
    options: {},
    constraints: {},
    ambiguities: Array.isArray(wazaa?.ambiguities) ? wazaa.ambiguities : [],
    raw: sourceText,
  };
}

function wazaaToMask(wazaa, opts = {}) {
  if (!isObject(wazaa)) return null;

  const intent = normalizeIntentType(opts.intentType || getWazaaIntent(wazaa), 'chat.reply');
  const sourceText = String(opts.sourceText || getSourceText(wazaa)).trim();

  if (intent === 'image.generate') return buildImageGenerateMask(wazaa, sourceText, opts);
  if (intent === 'web.image.search') return buildWebImageSearchMask(wazaa, sourceText);
  if (intent === 'web.search') return buildWebSearchMask(wazaa, sourceText);
  if (intent === 'code.python.generate') return buildCodePythonMask(wazaa, sourceText);
  if (intent === 'chat.reply') return buildChatReplyMask(wazaa, sourceText);

  return null;
}

module.exports = wazaaToMask;
module.exports.buildChatReplyMask = buildChatReplyMask;
module.exports.buildCodePythonMask = buildCodePythonMask;
module.exports.buildFilesystemSortImagesMask = buildFilesystemSortImagesMask;
module.exports.buildGenericCodeMask = buildGenericCodeMask;
module.exports.buildImageGenerateMask = buildImageGenerateMask;
module.exports.buildWebImageSearchMask = buildWebImageSearchMask;
module.exports.buildWebSearchMask = buildWebSearchMask;
