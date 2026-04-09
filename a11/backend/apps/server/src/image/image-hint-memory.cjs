const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

function resolveWorkspaceRoot() {
  const envCandidates = [
    process.env.A11_WORKSPACE_ROOT,
    process.env.WORKSPACE_ROOT,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  for (const candidate of envCandidates) {
    return path.resolve(candidate);
  }

  const filesystemCandidates = [
    path.resolve(__dirname, '..', '..', '..'),
    process.cwd(),
    path.resolve(__dirname, '..'),
  ];

  for (const candidate of filesystemCandidates) {
    if (fs.existsSync(path.join(candidate, 'a11_memory'))) {
      return candidate;
    }
  }

  return process.cwd();
}

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLookup(value = '') {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase();
}

function toUniqueStrings(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [values])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  )];
}

function normalizeHintArray(values = []) {
  return toUniqueStrings(values)
    .filter((entry) => entry.length <= 180)
    .filter((entry) => !/\b(ne pas|pas de|sans|eviter|éviter|do not|don't|avoid)\b/i.test(entry))
    .filter((entry) => !/negative[_ -]?prompt/i.test(entry))
    .slice(0, 3);
}

function normalizeHintBundle(bundle = {}) {
  return {
    composition_hints: normalizeHintArray(bundle.composition_hints || bundle.compositionHints || []),
    environment_hints: normalizeHintArray(bundle.environment_hints || bundle.environmentHints || []),
    style_hints: normalizeHintArray(bundle.style_hints || bundle.styleHints || []),
    prompt_instructions: normalizeHintArray(bundle.prompt_instructions || bundle.promptInstructions || []),
  };
}

function countHintBundleEntries(bundle = {}) {
  return (
    Number(bundle?.composition_hints?.length || 0)
    + Number(bundle?.environment_hints?.length || 0)
    + Number(bundle?.style_hints?.length || 0)
    + Number(bundle?.prompt_instructions?.length || 0)
  );
}

function buildSemanticFamilyList(entries = []) {
  return toUniqueStrings(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => (
        normalizeText(
          entry?.key
          || entry?.label
          || entry?.canonical
          || entry
        )
      ))
      .filter(Boolean)
  ).slice(0, 5);
}

function buildImageHintMemorySignature(mask = {}) {
  const semantic = mask?.meta?.semantic && typeof mask.meta.semantic === 'object'
    ? mask.meta.semantic
    : {};
  const profileType = normalizeText(mask?.meta?.subjectProfile?.type || 'generic_subject') || 'generic_subject';
  const subject = normalizeText(mask?.inputs?.subject?.[0] || '');
  const accessories = buildSemanticFamilyList(semantic?.accessories);
  const elements = buildSemanticFamilyList(semantic?.elements);
  const metiers = buildSemanticFamilyList(semantic?.metiers);
  const scenes = buildSemanticFamilyList(semantic?.scenes);

  const parts = [
    `profile:${profileType || 'generic_subject'}`,
    `accessories:${accessories.join('+') || '-'}`,
    `elements:${elements.join('+') || '-'}`,
    `metiers:${metiers.join('+') || '-'}`,
    `scenes:${scenes.join('+') || '-'}`,
  ];

  return {
    signature: parts.join('|'),
    profileType,
    subject,
    semanticFamilies: {
      accessories,
      elements,
      metiers,
      scenes,
    },
  };
}

function isImageHintMemoryEnabled(explicitValue) {
  if (typeof explicitValue === 'boolean') return explicitValue;
  const envValue = process.env.A11_IMAGE_HINT_MEMORY;
  if (envValue === undefined || envValue === '') return true;
  return ['1', 'true', 'yes', 'on'].includes(String(envValue).trim().toLowerCase());
}

function resolveImageHintMemoryPath(options = {}) {
  const explicit = String(options.storePath || process.env.A11_IMAGE_HINT_MEMORY_PATH || '').trim();
  if (explicit) return path.resolve(explicit);
  return path.join(resolveWorkspaceRoot(), 'a11_memory', 'image-hint-memory.json');
}

async function ensureImageHintMemoryDir(storePath) {
  await fsp.mkdir(path.dirname(storePath), { recursive: true });
}

async function loadImageHintMemoryStore(options = {}) {
  const storePath = resolveImageHintMemoryPath(options);
  try {
    const raw = await fsp.readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { version: 1, buckets: {} };
    }
    return {
      version: 1,
      buckets: parsed.buckets && typeof parsed.buckets === 'object' ? parsed.buckets : {},
    };
  } catch {
    return { version: 1, buckets: {} };
  }
}

async function saveImageHintMemoryStore(store, options = {}) {
  const storePath = resolveImageHintMemoryPath(options);
  await ensureImageHintMemoryDir(storePath);
  await fsp.writeFile(
    storePath,
    JSON.stringify({
      version: 1,
      buckets: store?.buckets && typeof store.buckets === 'object' ? store.buckets : {},
    }, null, 2),
    'utf8'
  );
}

function buildTopHintsFromBucket(bucket = {}, limitPerType = 3) {
  const rankingEntries = (bucket?.hintEntries && typeof bucket.hintEntries === 'object')
    ? bucket.hintEntries
    : {};

  function selectTop(kind) {
    const entries = Object.values(rankingEntries)
      .filter((entry) => String(entry?.kind || '').trim() === kind)
      .sort((left, right) => {
        const leftScore = Number(left?.successCount || 0);
        const rightScore = Number(right?.successCount || 0);
        if (leftScore !== rightScore) return rightScore - leftScore;
        return String(right?.lastUsedAt || '').localeCompare(String(left?.lastUsedAt || ''));
      })
      .map((entry) => normalizeText(entry?.text || ''))
      .filter(Boolean);
    return toUniqueStrings(entries).slice(0, limitPerType);
  }

  return {
    composition_hints: selectTop('composition'),
    environment_hints: selectTop('environment'),
    style_hints: selectTop('style'),
    prompt_instructions: selectTop('instruction'),
  };
}

async function readPreferredImageHintMemory(mask = {}, options = {}) {
  if (!isImageHintMemoryEnabled(options.enabled)) {
    return {
      available: false,
      skipped: true,
      reason: 'hint_memory_disabled',
      hints: normalizeHintBundle({}),
    };
  }

  const signatureInfo = buildImageHintMemorySignature(mask);
  const store = await loadImageHintMemoryStore(options);
  const bucket = store?.buckets?.[signatureInfo.signature];
  if (!bucket || typeof bucket !== 'object') {
    return {
      available: false,
      signature: signatureInfo.signature,
      profileType: signatureInfo.profileType,
      hints: normalizeHintBundle({}),
    };
  }

  const hints = buildTopHintsFromBucket(bucket, Math.max(1, Number(options.limitPerType || 3) || 3));
  return {
    available: countHintBundleEntries(hints) > 0,
    signature: signatureInfo.signature,
    profileType: signatureInfo.profileType,
    hints,
    meta: {
      updatedAt: String(bucket.updatedAt || '').trim(),
      successCount: Number(bucket.successCount || 0),
    },
  };
}

function buildHintEntryKey(kind = '', text = '') {
  return `${normalizeLookup(kind)}::${normalizeLookup(text)}`;
}

function updateBucketHintEntries(bucket, kind, values, nowIso) {
  const normalizedKind = String(kind || '').trim();
  if (!normalizedKind) return 0;
  const list = normalizeHintArray(values);
  if (!list.length) return 0;

  bucket.hintEntries = bucket.hintEntries && typeof bucket.hintEntries === 'object'
    ? bucket.hintEntries
    : {};

  let added = 0;
  for (const text of list) {
    const key = buildHintEntryKey(normalizedKind, text);
    const entry = bucket.hintEntries[key] && typeof bucket.hintEntries[key] === 'object'
      ? bucket.hintEntries[key]
      : {
          kind: normalizedKind,
          text,
          successCount: 0,
          createdAt: nowIso,
          lastUsedAt: nowIso,
        };
    entry.successCount = Number(entry.successCount || 0) + 1;
    entry.lastUsedAt = nowIso;
    entry.text = text;
    bucket.hintEntries[key] = entry;
    added += 1;
  }
  return added;
}

async function recordSuccessfulImageHintMemory({
  mask = {},
  workingHints = {},
  judgeResult = {},
} = {}, options = {}) {
  if (!isImageHintMemoryEnabled(options.enabled)) {
    return { ok: false, skipped: true, reason: 'hint_memory_disabled' };
  }

  const hints = normalizeHintBundle(workingHints);
  if (countHintBundleEntries(hints) === 0) {
    return { ok: false, skipped: true, reason: 'no_working_hints' };
  }

  const signatureInfo = buildImageHintMemorySignature(mask);
  const store = await loadImageHintMemoryStore(options);
  const existingBucket = store.buckets?.[signatureInfo.signature];
  const nowIso = new Date().toISOString();
  const bucket = existingBucket && typeof existingBucket === 'object'
    ? existingBucket
    : {
        signature: signatureInfo.signature,
        profileType: signatureInfo.profileType,
        subject: signatureInfo.subject,
        semanticFamilies: signatureInfo.semanticFamilies,
        createdAt: nowIso,
        updatedAt: nowIso,
        successCount: 0,
        lastReason: '',
        hintEntries: {},
      };

  bucket.profileType = signatureInfo.profileType;
  bucket.subject = signatureInfo.subject;
  bucket.semanticFamilies = signatureInfo.semanticFamilies;
  bucket.updatedAt = nowIso;
  bucket.successCount = Number(bucket.successCount || 0) + 1;
  bucket.lastReason = normalizeText(judgeResult?.decision?.reason || judgeResult?.reason || '');

  let addedCount = 0;
  addedCount += updateBucketHintEntries(bucket, 'composition', hints.composition_hints, nowIso);
  addedCount += updateBucketHintEntries(bucket, 'environment', hints.environment_hints, nowIso);
  addedCount += updateBucketHintEntries(bucket, 'style', hints.style_hints, nowIso);
  addedCount += updateBucketHintEntries(bucket, 'instruction', hints.prompt_instructions, nowIso);

  store.buckets[signatureInfo.signature] = bucket;
  await saveImageHintMemoryStore(store, options);

  return {
    ok: true,
    signature: signatureInfo.signature,
    profileType: signatureInfo.profileType,
    addedCount,
    hints,
  };
}

module.exports = {
  buildImageHintMemorySignature,
  countHintBundleEntries,
  isImageHintMemoryEnabled,
  loadImageHintMemoryStore,
  normalizeHintBundle,
  readPreferredImageHintMemory,
  recordSuccessfulImageHintMemory,
  resolveImageHintMemoryPath,
  saveImageHintMemoryStore,
};
