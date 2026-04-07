function normalizeWhitespace(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value = '') {
  return normalizeWhitespace(String(value || ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase();
}

function bindSemanticCompoundsRaw(value = '') {
  return normalizeWhitespace(String(value || '')
    .replace(/\bultra[\s-]+violet\b/gi, 'ultraviolet')
    .replace(/\brayons?\s+ultra[\s-]+violets?\b/gi, 'rayon ultraviolet')
    .replace(/\brayons?\s+ultraviolets?\b/gi, 'rayon ultraviolet')
  );
}

function bindSemanticCompoundsEnglish(value = '') {
  return normalizeWhitespace(String(value || '')
    .replace(/\bultra[\s-]+violet\b/gi, 'ultraviolet')
    .replace(/\bray(?:on)?s?\s+ultraviolet\b/gi, 'ultraviolet ray')
    .replace(/\bultraviolet\s+rays?\b/gi, 'ultraviolet ray')
    .replace(/\bthe ultraviolet ray\b/gi, 'ultraviolet ray')
  );
}

function uniqueSemanticStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const trimmed = bindSemanticCompoundsEnglish(normalizeWhitespace(value));
    if (!trimmed) continue;
    const key = normalizeKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function stripEnglishLeadingArticle(value = '') {
  return normalizeWhitespace(String(value || '').replace(/^(?:a|an|the)\s+/i, ''));
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SCENE_RELATION_ARTICLES = [
  { kind: 'the', forms: ["de la", "de l['’]?", 'du', 'le', 'la', 'les'] },
  { kind: 'a', forms: ['un', 'une'] },
  { kind: 'plural', forms: ['des'] },
];

const SCENE_RELATION_RULES = [
  {
    id: 'coming_out',
    type: 'scoped',
    starters: [String.raw`sort(?:ant|i|ie)\s+d(?:['’]|\s+)`],
    english: {
      a: 'coming out of a',
      plural: 'coming out of',
      the: 'coming out of the',
      bare: 'coming out of',
    },
  },
  {
    id: 'middle_of',
    type: 'scoped',
    starters: [String.raw`au milieu de\s+`],
    english: {
      a: 'in the middle of a',
      plural: 'in the middle of',
      the: 'in the middle of the',
      bare: 'in the middle of',
    },
  },
  {
    id: 'edge_of',
    type: 'scoped',
    starters: [String.raw`au bord de\s+`],
    english: {
      a: 'at the edge of a',
      plural: 'at the edge of',
      the: 'at the edge of the',
      bare: 'at the edge of',
    },
  },
  {
    id: 'in',
    type: 'scoped',
    starters: [String.raw`dans\s+`],
    english: {
      a: 'in a',
      plural: 'in',
      the: 'in the',
      bare: 'in',
    },
  },
  {
    id: 'on',
    type: 'scoped',
    starters: [String.raw`sur\s+`],
    english: {
      a: 'on a',
      plural: 'on',
      the: 'on the',
      bare: 'on',
    },
  },
  {
    id: 'under',
    type: 'scoped',
    starters: [String.raw`sous\s+`],
    english: {
      a: 'under a',
      plural: 'under',
      the: 'under the',
      bare: 'under',
    },
  },
  {
    id: 'with',
    type: 'scoped',
    starters: [String.raw`avec\s+`],
    english: {
      a: 'with a',
      plural: 'with',
      the: 'with the',
      bare: 'with',
    },
  },
  {
    id: 'holding',
    type: 'scoped',
    starters: [String.raw`tenant\s+`],
    english: {
      a: 'holding a',
      plural: 'holding',
      the: 'holding the',
      bare: 'holding',
    },
  },
  {
    id: 'wearing',
    type: 'scoped',
    starters: [String.raw`portant\s+`],
    english: {
      a: 'wearing a',
      plural: 'wearing',
      the: 'wearing the',
      bare: 'wearing',
    },
  },
  {
    id: 'bicycle',
    type: 'fixed',
    starters: [String.raw`\ben vélo\b`, String.raw`\bà vélo\b`, String.raw`\ba velo\b`],
    englishFixed: 'on a bicycle',
  },
];

function buildEnglishRelationPrefixes() {
  return [...new Set(
    SCENE_RELATION_RULES.flatMap((rule) => {
      if (rule.type === 'fixed') return [rule.englishFixed];
      return Object.values(rule.english || {}).filter(Boolean);
    })
  )]
    .sort((a, b) => b.length - a.length);
}

const ENGLISH_SCENE_RELATION_PREFIXES = buildEnglishRelationPrefixes();

function buildSceneRelationTranslationPatterns() {
  const patterns = [];
  for (const rule of SCENE_RELATION_RULES) {
    if (rule.type === 'fixed') {
      for (const starter of rule.starters || []) {
        patterns.push([new RegExp(starter, 'gi'), rule.englishFixed]);
      }
      continue;
    }

    for (const starter of rule.starters || []) {
      for (const article of SCENE_RELATION_ARTICLES) {
        const head = rule.english?.[article.kind];
        if (!head) continue;
        for (const form of [...article.forms].sort((a, b) => b.length - a.length)) {
          const followPattern = /['’]\?$/.test(form) || /['’]/.test(form)
            ? '(?=[A-Za-zÀ-ÿ])'
            : '(?=\\s|$)';
          patterns.push([
            new RegExp(`${starter}(?:${form})${followPattern}`, 'gi'),
            head,
          ]);
        }
      }
      if (rule.english?.bare) {
        patterns.push([new RegExp(starter, 'gi'), rule.english.bare]);
      }
    }
  }
  return patterns;
}

const SCENE_RELATION_TRANSLATION_PATTERNS = buildSceneRelationTranslationPatterns();

function findSceneRelationMarkers(source = '') {
  const markers = [];
  for (const rule of SCENE_RELATION_RULES) {
    for (const starter of rule.starters || []) {
      const regex = new RegExp(`(^|\\s)(${starter})`, 'gi');
      let match = regex.exec(source);
      while (match) {
        const leading = match[1] || '';
        const matchedText = match[2] || '';
        const start = (match.index || 0) + leading.length;
        const end = start + matchedText.length;
        markers.push({ start, end, matchedText, rule });
        match = regex.exec(source);
      }
    }
  }

  markers.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const filtered = [];
  for (const marker of markers) {
    const previous = filtered[filtered.length - 1];
    if (!previous) {
      filtered.push(marker);
      continue;
    }
    if (marker.start < previous.end) {
      if (marker.start === previous.start && (marker.end - marker.start) > (previous.end - previous.start)) {
        filtered[filtered.length - 1] = marker;
      }
      continue;
    }
    filtered.push(marker);
  }
  return filtered;
}

function stripSceneRelationStarter(fragment = '', rule = null) {
  const source = normalizeWhitespace(fragment);
  if (!source || !rule) return source;
  for (const starter of rule.starters || []) {
    const regex = new RegExp(`^${starter}`, 'i');
    if (regex.test(source)) {
      return normalizeWhitespace(source.replace(regex, ''));
    }
  }
  return source;
}

function isMeaningfulSceneRelationFragment(fragment = '', rule = null) {
  if (!fragment || !rule) return false;
  if (rule.type === 'fixed') return true;
  const rest = stripSceneRelationStarter(fragment, rule);
  if (!rest) return false;
  const articleOnlyPattern = new RegExp(
    `^(?:${SCENE_RELATION_ARTICLES.flatMap((entry) => entry.forms).sort((a, b) => b.length - a.length).join('|')})$`,
    'i'
  );
  return !articleOnlyPattern.test(rest);
}

function dedupeStructuralHints(hints = [], { primarySubject = '', pairMode = false } = {}) {
  const normalizedPrimarySubject = normalizeWhitespace(primarySubject);
  const normalizedPrimarySubjectCore = stripEnglishLeadingArticle(normalizedPrimarySubject) || normalizedPrimarySubject;
  const extraHints = [];
  let exactSingleHint = '';
  let exactPairHint = '';
  let pairIdentityHint = '';
  let hasBackgroundHint = false;
  let hasCenteredHint = false;
  let hasSoloHint = false;
  let hasPairBodiesHint = false;
  let hasPairFacesHint = false;
  let hasPairLayoutHint = false;

  for (const hint of hints) {
    const text = bindSemanticCompoundsEnglish(hint);
    const key = normalizeKey(text);
    if (!key) continue;

    if (pairMode && /exactly two distinct/.test(key)) {
      exactPairHint = text;
      continue;
    }
    if (pairMode && /^one .+ and one .+ only$/.test(key)) {
      pairIdentityHint = text;
      continue;
    }
    if (!pairMode && /^exactly one /.test(key)) {
      exactSingleHint = text;
      continue;
    }

    if (/simple clean background/.test(key)) {
      hasBackgroundHint = true;
      continue;
    }
    if (/clear centered composition|clear subject focus|centered subject focus/.test(key)) {
      hasCenteredHint = true;
      continue;
    }
    if (/solo composition|solo subject|single main subject|one subject only|one instance only|single isolated subject/.test(key)) {
      hasSoloHint = true;
      continue;
    }
    if (pairMode && /separate bodies/.test(key)) {
      hasPairBodiesHint = true;
      continue;
    }
    if (pairMode && /separate faces/.test(key)) {
      hasPairFacesHint = true;
      continue;
    }
    if (pairMode && /balanced two subject composition|clean non overlapping composition|two distinct subjects|no character fusion/.test(key)) {
      hasPairLayoutHint = true;
      continue;
    }
    if (!pairMode && (/^one .+ only$/.test(key) || /clean non[- ]repeated composition|no duplicate instances/.test(key))) {
      continue;
    }
    if (pairMode && (/single character focus|solo subject|clean non[- ]overlapping composition/.test(key))) {
      continue;
    }
    extraHints.push(text);
  }

  const baseHints = [];
  if (pairMode) {
    if (exactPairHint) baseHints.push(exactPairHint);
    if (pairIdentityHint) baseHints.push(pairIdentityHint);
    if (hasPairLayoutHint) baseHints.push('balanced two-subject composition');
    if (hasPairBodiesHint) baseHints.push('separate bodies');
    if (hasPairFacesHint) baseHints.push('separate faces');
    if (hasCenteredHint) baseHints.push('clear centered composition');
  } else {
    if (exactSingleHint) {
      baseHints.push(exactSingleHint);
    } else if (normalizedPrimarySubjectCore) {
      baseHints.push(`exactly one ${normalizedPrimarySubjectCore}`);
    } else if (hasSoloHint) {
      baseHints.push('exactly one main subject');
    }
    if (hasSoloHint || normalizedPrimarySubjectCore) baseHints.push('solo composition');
    if (hasCenteredHint) baseHints.push('clear centered composition');
  }
  if (hasBackgroundHint) baseHints.push('simple clean background');

  return uniqueSemanticStrings([...baseHints, ...extraHints]);
}

function buildBlockedDuplicates({ primarySubject = '', characterCountConstraints = null, singleSubjectConstraints = null } = {}) {
  const primary = stripEnglishLeadingArticle(normalizeWhitespace(primarySubject));
  const values = [];

  if (Array.isArray(characterCountConstraints?.negativeHints)) {
    values.push(...characterCountConstraints.negativeHints);
  }
  if (Array.isArray(singleSubjectConstraints?.negativeHints)) {
    values.push(...singleSubjectConstraints.negativeHints);
  }
  if (primary && characterCountConstraints) {
    values.push(`multiple ${primary}`);
  }
  values.push('multiple subjects', 'second subject', 'crowd');
  return uniqueSemanticStrings(values);
}

function stripEnglishRelationClauses(value = '') {
  const prefixPattern = ENGLISH_SCENE_RELATION_PREFIXES.map((value) => escapeRegex(value)).join('|');
  if (!prefixPattern) return normalizeWhitespace(value);
  return normalizeWhitespace(String(value || '')
    .replace(new RegExp(`\\b(?:${prefixPattern})\\b.*$`, 'i'), '')
  );
}

function stripEnglishSubjectWrappers(value = '') {
  return normalizeWhitespace(String(value || '')
    .replace(/^(?:a|an)\s+image\s+of\s+/i, '')
    .replace(/^(?:image|illustration|drawing|photo|visual|portrait)\s+of\s+/i, '')
    .replace(/^(?:the\s+)?(?:hero|character)\s+/i, '')
    .replace(/^the\s+/i, '')
  );
}

function extractSceneRelationFragments(rawPrompt = '') {
  const source = normalizeWhitespace(rawPrompt);
  if (!source) return [];
  const markers = findSceneRelationMarkers(source);
  const fragments = [];

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const nextMarker = markers[index + 1];
    const sliceEnd = marker.rule?.type === 'fixed'
      ? marker.end
      : (nextMarker ? nextMarker.start : source.length);
    const rawFragment = normalizeWhitespace(
      source.slice(marker.start, sliceEnd).replace(/[.,;:!?]+$/g, '')
    );
    if (!isMeaningfulSceneRelationFragment(rawFragment, marker.rule)) continue;
    fragments.push(rawFragment);
  }

  return fragments;
}

function bindSemanticAtoms({
  rawPrompt = '',
  subjectPromptEnglish = '',
  styleHints = [],
  compositionHints = [],
  characterCountConstraints = null,
  singleSubjectConstraints = null,
  translatePrompt = (value) => value,
} = {}) {
  const boundRawPrompt = bindSemanticCompoundsRaw(rawPrompt);
  const boundSubjectPromptEnglish = bindSemanticCompoundsEnglish(subjectPromptEnglish);
  const pairSubjects = Array.isArray(characterCountConstraints?.subjects)
    ? characterCountConstraints.subjects.map((entry) => bindSemanticCompoundsEnglish(entry))
    : [];
  const relationAtoms = uniqueSemanticStrings(
    extractSceneRelationFragments(boundRawPrompt)
      .map((fragment) => bindSemanticCompoundsEnglish(translatePrompt(fragment)))
  );
  const strippedPromptLead = stripEnglishSubjectWrappers(
    stripEnglishRelationClauses(boundSubjectPromptEnglish)
  );
  const primarySubject = pairSubjects.length
    ? pairSubjects.join(' and ')
    : bindSemanticCompoundsEnglish(
      singleSubjectConstraints?.subject || strippedPromptLead || boundSubjectPromptEnglish
    );
  const pairMode = pairSubjects.length === 2;

  const structuralSourceHints = pairMode
    ? [
      ...(characterCountConstraints?.promptHints || []),
      ...(compositionHints || []),
    ]
    : [
      ...(singleSubjectConstraints?.promptHints || []),
      ...(compositionHints || []),
    ];

  const structuralAtoms = dedupeStructuralHints(structuralSourceHints, {
    primarySubject,
    pairMode,
  });
  const styleAtoms = uniqueSemanticStrings(styleHints);
  const subjectAtoms = pairMode
    ? uniqueSemanticStrings(pairSubjects)
    : uniqueSemanticStrings(primarySubject ? [primarySubject] : [strippedPromptLead || boundSubjectPromptEnglish]);
  const blockedDuplicates = buildBlockedDuplicates({
    primarySubject,
    characterCountConstraints,
    singleSubjectConstraints,
  });

  const compounds = uniqueSemanticStrings([
    /\bultraviolet\b/i.test(boundRawPrompt) || /\bultraviolet\b/i.test(boundSubjectPromptEnglish)
      ? 'ultraviolet'
      : '',
    subjectAtoms.length ? subjectAtoms.join(' | ') : '',
  ]);

  return {
    rawPrompt: boundRawPrompt,
    promptLead: strippedPromptLead || boundSubjectPromptEnglish,
    primarySubject,
    subjectAtoms,
    styleAtoms,
    relationAtoms,
    structuralAtoms,
    blockedDuplicates,
    compounds,
    pairMode,
  };
}

module.exports = {
  bindSemanticCompoundsRaw,
  bindSemanticCompoundsEnglish,
  bindSemanticAtoms,
  SCENE_RELATION_TRANSLATION_PATTERNS,
  stripEnglishSubjectWrappers,
  uniqueSemanticStrings,
};
