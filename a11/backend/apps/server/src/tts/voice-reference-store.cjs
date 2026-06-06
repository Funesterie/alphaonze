'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getBackendRoot } = require('../../lib/tts-paths.cjs');
const { hasFullAccess, normalizeEmail } = require('../auth/full-access.cjs');
const { assertAccountStorageQuota } = require('../storage/account-storage-quota.cjs');

const AUDIO_EXTENSIONS = new Set(['.wav', '.wave', '.mp3', '.ogg', '.webm', '.m4a', '.mp4', '.mov', '.flac']);
const AUDIO_MIME_TYPES = new Set([
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/flac',
  'audio/x-m4a',
  'video/webm',
  'video/quicktime',
  'video/mp4',
]);
const libraryReferenceCache = new Map();

function uniqueValues(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = String(value || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function sanitizeSegment(value, fallback = 'item') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function getUserKey(user = null) {
  const email = normalizeEmail(user?.email);
  const id = String(user?.id || user?.sub || user?.username || '').trim().toLowerCase();
  return sanitizeSegment(email || id || 'anonymous', 'anonymous');
}

function resolveVoiceReferenceRoot() {
  const configured = String(process.env.A11_VOICE_REFERENCE_DIR || '').trim();
  if (configured) return path.resolve(configured);

  const runtimeRoot = String(process.env.A11_RUNTIME_ROOT || '').trim();
  if (runtimeRoot) return path.resolve(runtimeRoot, 'voice-references');

  return path.resolve(getBackendRoot(), 'runtime', 'voice-references');
}

function resolveRuntimeRootCandidates() {
  const backendRoot = getBackendRoot();
  return uniqueValues([
    process.env.A11_RUNTIME_ROOT,
    path.resolve(backendRoot, 'runtime'),
    path.resolve(backendRoot, '..', 'runtime'),
    path.resolve(backendRoot, '..', '..', 'runtime'),
    path.resolve(backendRoot, '..', '..', '..', 'runtime'),
    path.resolve(backendRoot, '..', '..', '..', '..', 'runtime'),
    '/app/runtime',
    '/srv/a11/runtime',
  ]);
}

function parseLibraryPathList(value = '') {
  return String(value || '')
    .split(/[;\n]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isVoiceReferenceLibraryDisabled() {
  const raw = String(process.env.A11_VOICE_REFERENCE_LIBRARY_DISABLED || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function getVoiceReferenceLibraryCandidates() {
  if (isVoiceReferenceLibraryDisabled()) return [];
  const configured = [
    ...parseLibraryPathList(process.env.A11_VOICE_REFERENCE_LIBRARY_DIRS),
    ...parseLibraryPathList(process.env.A11_VOICE_REFERENCE_LIBRARY_DIR),
    ...parseLibraryPathList(process.env.A11_VOICE_REFERENCE_LIBRARY_PATHS),
  ];
  const defaults = [];
  for (const runtimeRoot of resolveRuntimeRootCandidates()) {
    defaults.push(
      path.join(runtimeRoot, 'sfx', 'terminator'),
      path.join(runtimeRoot, 'sfx', 'terminator.wav'),
      path.join(runtimeRoot, 'sfx', 'a11-official-stern-french.wav'),
      path.join(runtimeRoot, 'voice-library', 'a11-terminator.wav'),
      path.join(runtimeRoot, 'voice-library', 'a11-official-stern-french.wav'),
      path.join(runtimeRoot, 'voice-library', 'vivy.wav'),
      path.join(runtimeRoot, 'voice-library', 'vivy-official-french-conversational.wav'),
      path.join(runtimeRoot, 'voice-library', 'kaen44-official-french-narrator.wav'),
      path.join(runtimeRoot, 'voice-library', 'kaen44-donna.wav'),
      path.join(runtimeRoot, 'voice-library'),
      path.join(runtimeRoot, 'voice-references', 'library')
    );
  }
  return uniqueValues([...configured, ...defaults]).map((candidate) => path.resolve(candidate));
}

function ensureVoiceReferenceRoot() {
  const root = resolveVoiceReferenceRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function getIndexPath() {
  return path.join(ensureVoiceReferenceRoot(), 'index.json');
}

function readIndex() {
  const indexPath = getIndexPath();
  try {
    if (!fs.existsSync(indexPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Array.isArray(parsed?.references) ? parsed.references : [];
  } catch {
    return [];
  }
}

function writeIndex(references) {
  const indexPath = getIndexPath();
  const tmpPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify({ references }, null, 2));
  fs.renameSync(tmpPath, indexPath);
}

function isAllowedAudioUpload(file = {}) {
  const mime = String(file.mimetype || '').trim().toLowerCase();
  const ext = path.extname(String(file.originalname || '')).trim().toLowerCase();
  return AUDIO_MIME_TYPES.has(mime) || AUDIO_EXTENSIONS.has(ext);
}

function inferAudioExtension(file = {}) {
  const ext = path.extname(String(file.originalname || '')).trim().toLowerCase();
  if (AUDIO_EXTENSIONS.has(ext)) return ext === '.wave' ? '.wav' : ext;
  const mime = String(file.mimetype || '').trim().toLowerCase();
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('webm')) return '.webm';
  if (mime.includes('flac')) return '.flac';
  if (mime.includes('quicktime')) return '.mov';
  if (mime.includes('mp4') || mime.includes('m4a')) return '.m4a';
  return '.wav';
}

function readPcmSample(buffer, offset, audioFormat, bitsPerSample) {
  if (audioFormat === 3 && bitsPerSample === 32 && offset + 4 <= buffer.length) {
    const value = buffer.readFloatLE(offset);
    return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  }

  if (audioFormat !== 1) return 0;

  if (bitsPerSample === 8 && offset < buffer.length) {
    return (buffer.readUInt8(offset) - 128) / 128;
  }
  if (bitsPerSample === 16 && offset + 2 <= buffer.length) {
    return buffer.readInt16LE(offset) / 32768;
  }
  if (bitsPerSample === 24 && offset + 3 <= buffer.length) {
    const raw = buffer.readIntLE(offset, 3);
    return raw / 8388608;
  }
  if (bitsPerSample === 32 && offset + 4 <= buffer.length) {
    return buffer.readInt32LE(offset) / 2147483648;
  }
  return 0;
}

function analyzeWavBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
    return { ok: false, reason: 'audio_too_small' };
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { ok: false, reason: 'not_wav' };
  }

  let offset = 12;
  let fmt = null;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const bodyOffset = offset + 8;
    if (bodyOffset + size > buffer.length) break;

    if (id === 'fmt ' && size >= 16) {
      fmt = {
        audioFormat: buffer.readUInt16LE(bodyOffset),
        channels: buffer.readUInt16LE(bodyOffset + 2),
        sampleRate: buffer.readUInt32LE(bodyOffset + 4),
        byteRate: buffer.readUInt32LE(bodyOffset + 8),
        blockAlign: buffer.readUInt16LE(bodyOffset + 12),
        bitsPerSample: buffer.readUInt16LE(bodyOffset + 14),
      };
    } else if (id === 'data') {
      dataOffset = bodyOffset;
      dataSize = size;
    }

    offset = bodyOffset + size + (size % 2);
  }

  if (!fmt || !dataOffset || !dataSize || !fmt.blockAlign || !fmt.sampleRate) {
    return { ok: false, reason: 'wav_missing_fmt_or_data' };
  }

  const sampleBytes = Math.max(1, Math.floor(fmt.bitsPerSample / 8));
  const sampleCount = Math.max(0, Math.floor(dataSize / sampleBytes));
  if (!sampleCount) return { ok: false, reason: 'wav_empty_data' };

  const maxInspectedSamples = 220000;
  const stride = Math.max(1, Math.floor(sampleCount / maxInspectedSamples));
  let inspected = 0;
  let sumSquares = 0;
  let peak = 0;
  let zeroCrossings = 0;
  let previousSign = 0;

  for (let index = 0; index < sampleCount; index += stride) {
    const sampleOffset = dataOffset + (index * sampleBytes);
    const sample = readPcmSample(buffer, sampleOffset, fmt.audioFormat, fmt.bitsPerSample);
    const abs = Math.abs(sample);
    peak = Math.max(peak, abs);
    sumSquares += sample * sample;
    const sign = sample > 0 ? 1 : sample < 0 ? -1 : 0;
    if (previousSign && sign && sign !== previousSign) zeroCrossings += 1;
    if (sign) previousSign = sign;
    inspected += 1;
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, inspected));
  const durationMs = Math.round((dataSize / Math.max(1, fmt.byteRate)) * 1000);
  const loudnessDb = rms > 0 ? Math.round(20 * Math.log10(rms) * 10) / 10 : -96;

  return {
    ok: true,
    kind: 'wav',
    audioFormat: fmt.audioFormat,
    channels: fmt.channels,
    sampleRate: fmt.sampleRate,
    bitsPerSample: fmt.bitsPerSample,
    durationMs,
    rms: Number(rms.toFixed(5)),
    peak: Number(peak.toFixed(5)),
    loudnessDb,
    zeroCrossingRate: Number((zeroCrossings / Math.max(1, inspected)).toFixed(5)),
    inspectedSamples: inspected,
  };
}

function analyzeAudioBuffer(buffer, file = {}) {
  const wav = analyzeWavBuffer(buffer);
  if (wav.ok) return wav;
  return {
    ok: false,
    reason: wav.reason || 'analysis_unavailable',
    kind: 'opaque_audio',
    mimeType: file.mimetype || null,
    bytes: buffer?.length || 0,
  };
}

function compareAudioAnalysis(generated, reference) {
  if (!generated?.ok || !reference?.ok) {
    return {
      ok: false,
      reason: 'analysis_unavailable',
      generatedAvailable: Boolean(generated?.ok),
      referenceAvailable: Boolean(reference?.ok),
      notes: ['Comparaison detaillee disponible avec des fichiers WAV PCM.'],
    };
  }

  const rmsDelta = Math.abs(Number(generated.rms || 0) - Number(reference.rms || 0));
  const peakDelta = Math.abs(Number(generated.peak || 0) - Number(reference.peak || 0));
  const zcrDelta = Math.abs(Number(generated.zeroCrossingRate || 0) - Number(reference.zeroCrossingRate || 0));
  const sampleRatePenalty = generated.sampleRate === reference.sampleRate ? 0 : 0.08;
  const channelsPenalty = generated.channels === reference.channels ? 0 : 0.04;
  const penalty = Math.min(1, (rmsDelta * 1.35) + (peakDelta * 0.55) + (zcrDelta * 3.5) + sampleRatePenalty + channelsPenalty);
  const similarity = Number(Math.max(0, 1 - penalty).toFixed(3));
  const notes = [];

  if (rmsDelta > 0.08) {
    notes.push(generated.rms > reference.rms ? 'La sortie est plus forte que la reference.' : 'La sortie est plus douce que la reference.');
  }
  if (zcrDelta > 0.035) {
    notes.push('La texture sonore diverge; verifier articulation, bruit ou souffle.');
  }
  if (generated.sampleRate !== reference.sampleRate) {
    notes.push(`Sample rate different: sortie ${generated.sampleRate} Hz, reference ${reference.sampleRate} Hz.`);
  }
  if (!notes.length) notes.push('Profil sonore proche sur les mesures disponibles.');

  return {
    ok: true,
    similarity,
    rmsDelta: Number(rmsDelta.toFixed(5)),
    peakDelta: Number(peakDelta.toFixed(5)),
    zeroCrossingDelta: Number(zcrDelta.toFixed(5)),
    generated,
    reference,
    notes,
  };
}

function serializeReference(ref, { includePath = false } = {}) {
  if (!ref) return null;
  const safe = {
    id: ref.id,
    label: ref.label,
    scope: ref.scope || 'private',
    source: ref.source || 'upload',
    ownerKey: ref.ownerKey,
    mimeType: ref.mimeType || null,
    originalName: ref.originalName || null,
    bytes: ref.bytes || 0,
    analysis: ref.analysis || null,
    createdAt: ref.createdAt || null,
    updatedAt: ref.updatedAt || null,
  };
  if (includePath) safe.filePath = ref.filePath;
  return safe;
}

function canAccessReference(user, ref) {
  if (!ref) return false;
  if (ref.scope === 'library') return true;
  if (!user) return false;
  const userKey = getUserKey(user);
  if (ref.ownerKey && ref.ownerKey === userKey) return true;
  if (ref.scope === 'family' && hasFullAccess(user)) return true;
  return false;
}

function getVoiceReferenceStorageUsageBytes(user) {
  if (!user) return 0;
  const ownerKey = getUserKey(user);
  return readIndex()
    .filter((ref) => ref && ref.scope !== 'library' && ref.source !== 'library' && ref.ownerKey === ownerKey)
    .reduce((total, ref) => total + Math.max(0, Number(ref.bytes || 0)), 0);
}

function inferMimeTypeFromPath(filePath = '') {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.wav' || ext === '.wave') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  if (ext === '.mov') return 'video/quicktime';
  return 'application/octet-stream';
}

function makeLibraryReferenceId(filePath = '') {
  const digest = crypto.createHash('sha1').update(path.resolve(filePath)).digest('hex').slice(0, 18);
  return `library_${digest}`;
}

function makeLibraryReferenceLabel(filePath = '') {
  const base = path.basename(String(filePath || ''), path.extname(String(filePath || '')));
  const parent = path.basename(path.dirname(String(filePath || '')));
  const raw = base && base.toLowerCase() !== 'reference' ? base : parent;
  return sanitizeSegment(raw || 'reference-voix', 'reference-voix')
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, 80) || 'Reference voix';
}

function listAudioFilesFromPath(candidatePath, limit = 80) {
  try {
    const resolved = path.resolve(candidatePath);
    if (!fs.existsSync(resolved)) return [];
    const stat = fs.statSync(resolved);
    if (stat.isFile()) {
      return AUDIO_EXTENSIONS.has(path.extname(resolved).toLowerCase()) ? [resolved] : [];
    }
    if (!stat.isDirectory()) return [];

    const files = [];
    const queue = [resolved];
    while (queue.length && files.length < limit) {
      const dir = queue.shift();
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= limit) break;
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          queue.push(entryPath);
        } else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          files.push(entryPath);
        }
      }
    }
    return files;
  } catch {
    return [];
  }
}

function buildLibraryReference(filePath) {
  try {
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || !AUDIO_EXTENSIONS.has(path.extname(resolved).toLowerCase())) return null;
    const cacheKey = `${resolved}:${stat.size}:${Math.round(stat.mtimeMs)}`;
    if (libraryReferenceCache.has(cacheKey)) return libraryReferenceCache.get(cacheKey);

    const mimeType = inferMimeTypeFromPath(resolved);
    const buffer = fs.readFileSync(resolved);
    const reference = {
      id: makeLibraryReferenceId(resolved),
      label: makeLibraryReferenceLabel(resolved),
      scope: 'library',
      source: 'library',
      ownerKey: 'a11-library',
      ownerEmail: null,
      mimeType,
      originalName: path.basename(resolved),
      bytes: stat.size,
      filePath: resolved,
      analysis: analyzeAudioBuffer(buffer, { mimetype: mimeType, originalname: path.basename(resolved) }),
      createdAt: stat.birthtime?.toISOString?.() || stat.mtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
    };

    libraryReferenceCache.set(cacheKey, reference);
    return reference;
  } catch {
    return null;
  }
}

function listLibraryVoiceReferences({ includePath = false } = {}) {
  const files = [];
  for (const candidate of getVoiceReferenceLibraryCandidates()) {
    files.push(...listAudioFilesFromPath(candidate));
  }
  const refs = uniqueValues(files)
    .map((filePath) => buildLibraryReference(filePath))
    .filter(Boolean)
    .sort((a, b) => {
      const affinityDelta = getRuntimeAffinityScore(b) - getRuntimeAffinityScore(a);
      if (affinityDelta) return affinityDelta;
      return String(a.filePath || '').localeCompare(String(b.filePath || ''));
    });
  const seen = new Set();
  return refs
    .filter((ref) => {
      const key = [
        String(ref.originalName || '').toLowerCase(),
        Number(ref.bytes || 0),
        Number(ref.analysis?.durationMs || 0),
      ].join(':');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')))
    .map((ref) => serializeReference(ref, { includePath }));
}

function saveVoiceReference({ user, file, label, scope = 'private' } = {}) {
  if (!user) throw new Error('missing_user');
  if (!file?.buffer?.length) throw new Error('missing_audio');
  if (!isAllowedAudioUpload(file)) throw new Error(`unsupported_audio_type:${file.mimetype || 'unknown'}`);

  const familyScope = String(scope || '').trim().toLowerCase() === 'family';
  const resolvedScope = familyScope && hasFullAccess(user) ? 'family' : 'private';
  const ownerKey = getUserKey(user);
  assertAccountStorageQuota({
    user,
    currentBytes: getVoiceReferenceStorageUsageBytes(user),
    incomingBytes: file.buffer.length,
    subject: 'voice_reference',
  });
  const root = ensureVoiceReferenceRoot();
  const userDir = path.join(root, ownerKey);
  fs.mkdirSync(userDir, { recursive: true });

  const id = crypto.randomBytes(12).toString('hex');
  const ext = inferAudioExtension(file);
  const filename = `${id}${ext}`;
  const filePath = path.join(userDir, filename);
  fs.writeFileSync(filePath, file.buffer);

  const now = new Date().toISOString();
  const reference = {
    id,
    label: String(label || file.originalname || 'Reference voix').trim().slice(0, 80) || 'Reference voix',
    scope: resolvedScope,
    ownerKey,
    ownerEmail: normalizeEmail(user.email) || null,
    mimeType: file.mimetype || 'application/octet-stream',
    originalName: String(file.originalname || filename).slice(0, 180),
    bytes: file.buffer.length,
    filePath,
    analysis: analyzeAudioBuffer(file.buffer, file),
    createdAt: now,
    updatedAt: now,
  };

  const references = readIndex().filter((entry) => entry.id !== id);
  references.push(reference);
  writeIndex(references);
  return serializeReference(reference);
}

function listVoiceReferences({ user } = {}) {
  const stored = readIndex()
    .filter((ref) => canAccessReference(user, ref))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map((ref) => serializeReference(ref));
  const library = listLibraryVoiceReferences().filter((ref) => canAccessReference(user, ref));
  return [...stored, ...library];
}

function referenceMatchesPreference(ref, preferredLabel = '') {
  const needle = String(preferredLabel || '').trim().toLowerCase();
  if (!needle || !ref) return false;
  const haystack = [
    ref.label,
    ref.originalName,
    ref.source,
    ref.id,
  ].map((value) => String(value || '').toLowerCase());
  return haystack.some((value) => value.includes(needle));
}

function referenceMatchesPreferenceExactly(ref, preferredLabel = '') {
  const needle = String(preferredLabel || '').trim().toLowerCase();
  if (!needle || !ref) return false;
  const originalName = String(ref.originalName || '');
  const baseName = originalName
    ? path.basename(originalName, path.extname(originalName))
    : '';
  const haystack = [
    ref.label,
    baseName,
    ref.id,
  ].map((value) => String(value || '').trim().toLowerCase());
  return haystack.some((value) => value === needle);
}

function getRuntimeAffinityScore(ref) {
  const filePath = String(ref?.filePath || '').trim();
  if (!filePath) return 0;
  let resolvedFile = '';
  try {
    resolvedFile = path.resolve(filePath).toLowerCase();
  } catch {
    return 0;
  }

  const configuredRoots = [
    process.env.A11_RUNTIME_ROOT,
    ...parseLibraryPathList(process.env.A11_VOICE_REFERENCE_LIBRARY_DIRS),
    ...parseLibraryPathList(process.env.A11_VOICE_REFERENCE_LIBRARY_DIR),
    ...parseLibraryPathList(process.env.A11_VOICE_REFERENCE_LIBRARY_PATHS),
  ];

  for (const root of configuredRoots) {
    if (!root) continue;
    try {
      const resolvedRoot = path.resolve(root).toLowerCase();
      if (resolvedFile === resolvedRoot || resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
        return 1000;
      }
    } catch {
      // Keep scoring best-effort; bad env paths should not block voice fallback.
    }
  }
  return 0;
}

function getReferencePreferenceScore(ref, preferredLabel = '') {
  const needle = String(preferredLabel || '').trim().toLowerCase();
  if (!needle || !ref) return 0;
  const originalName = String(ref.originalName || '');
  const baseName = originalName
    ? path.basename(originalName, path.extname(originalName))
    : '';
  const label = String(ref.label || '').trim().toLowerCase();
  const base = String(baseName || '').trim().toLowerCase();
  const id = String(ref.id || '').trim().toLowerCase();
  const searchable = [label, base, id].filter(Boolean);
  const tokens = new Set(
    searchable
      .flatMap((value) => value.split(/[-_.\s]+/g))
      .map((value) => value.trim())
      .filter(Boolean)
  );

  let score = 0;
  if (searchable.some((value) => value === needle)) score = Math.max(score, 100);
  if (tokens.has(needle)) score = Math.max(score, 90);
  if (referenceMatchesPreference(ref, preferredLabel)) score = Math.max(score, 50);

  const agentVoiceAliases = {
    terminator: ['a11', 'alpha', 'alphaonze'],
    'a11-official-stern-french': ['a11', 'alpha', 'alphaonze'],
    donna: ['kaen44', 'k44', 'kaen'],
    'kaen44-official-french-narrator': ['kaen44', 'k44', 'kaen'],
    vivy: ['vivy'],
    'vivy-official-french-conversational': ['vivy'],
  };
  const agentAliases = agentVoiceAliases[needle] || [];
  if (score > 0 && agentAliases.some((alias) => tokens.has(alias) || base.includes(alias))) {
    score += 30;
  }

  return score > 0 ? score + getRuntimeAffinityScore(ref) : 0;
}

function pickPreferredReference(refs = [], preferredLabel = '') {
  if (!preferredLabel) return refs[0] || null;
  let best = null;
  let bestScore = 0;
  for (const ref of refs) {
    const score = getReferencePreferenceScore(ref, preferredLabel);
    if (score > bestScore) {
      best = ref;
      bestScore = score;
    }
  }
  return best || null;
}

function findVoiceReference({ user, id, includePath = false } = {}) {
  const safeId = String(id || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(safeId)) return null;
  const ref = readIndex().find((entry) => entry.id === safeId)
    || listLibraryVoiceReferences({ includePath: true }).find((entry) => entry.id === safeId)
    || null;
  if (!canAccessReference(user, ref)) return null;
  return serializeReference(ref, { includePath });
}

function resolveVoiceReferenceForRequest({ user, requestedId, preferredLabel = '' } = {}) {
  if (requestedId) {
    const requested = findVoiceReference({ user, id: requestedId, includePath: true });
    if (!preferredLabel || referenceMatchesPreference(requested, preferredLabel)) {
      return requested;
    }
  }
  const accessible = user
    ? readIndex()
      .filter((ref) => canAccessReference(user, ref))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    : [];
  const preferredStored = pickPreferredReference(accessible, preferredLabel);
  if (preferredStored) return serializeReference(preferredStored, { includePath: true });

  const library = listLibraryVoiceReferences({ includePath: true })
    .filter((ref) => canAccessReference(user, ref));
  const preferredLibrary = pickPreferredReference(library, preferredLabel);
  if (preferredLibrary) return serializeReference(preferredLibrary, { includePath: true });
  if (preferredLabel) return null;
  return serializeReference(accessible[0] || library[0] || null, { includePath: true });
}

function deleteVoiceReference({ user, id } = {}) {
  const safeId = String(id || '').trim();
  if (safeId.startsWith('library_')) return false;
  const references = readIndex();
  const ref = references.find((entry) => entry.id === safeId) || null;
  if (!canAccessReference(user, ref)) return false;

  const next = references.filter((entry) => entry.id !== safeId);
  writeIndex(next);
  try {
    if (ref.filePath && fs.existsSync(ref.filePath)) fs.unlinkSync(ref.filePath);
  } catch {
    // Metadata deletion already happened; stale files can be cleaned later.
  }
  return true;
}

function compareAudioBuffers({ generatedBuffer, referenceBuffer, generatedFile = {}, referenceFile = {} } = {}) {
  return compareAudioAnalysis(
    analyzeAudioBuffer(generatedBuffer, generatedFile),
    analyzeAudioBuffer(referenceBuffer, referenceFile)
  );
}

module.exports = {
  AUDIO_EXTENSIONS,
  AUDIO_MIME_TYPES,
  analyzeAudioBuffer,
  analyzeWavBuffer,
  canAccessReference,
  compareAudioAnalysis,
  compareAudioBuffers,
  deleteVoiceReference,
  findVoiceReference,
  getUserKey,
  getVoiceReferenceStorageUsageBytes,
  getVoiceReferenceLibraryCandidates,
  isAllowedAudioUpload,
  listLibraryVoiceReferences,
  listVoiceReferences,
  resolveVoiceReferenceForRequest,
  resolveVoiceReferenceRoot,
  saveVoiceReference,
};
