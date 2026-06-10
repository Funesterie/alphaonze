'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getCanonicalRuntimeRoot } = require('../lib/runtime-root.cjs');
const {
  analyzeWavBuffer,
  getUserKey,
} = require('../src/tts/voice-reference-store.cjs');

const DEFAULT_AUDACITY_DIR = 'C:\\Users\\Djeff\\Documents\\Audacity';
const DEFAULT_OWNER_EMAILS = Object.freeze([
  'cellaurojeffrey@gmail.com',
  'local-dev@funesterie.local',
  'djeff-local@funesterie.local',
]);

const DEFAULT_CLIPS = Object.freeze([
  { audio: 'Djeffvoice.wav', transcript: 'Djeffvoice.txt', source: 'audacity-djeffvoice', label: 'Djeff voice' },
  { audio: 'pignon.wav', transcript: 'pignon.txt', source: 'audacity-pignon', label: 'Pignon rap' },
  { audio: 'valable.wav', transcript: 'valable.txt', source: 'audacity-valable', label: 'Valable' },
  { audio: 'moine.wav', transcript: 'moine.txt', source: 'audacity-moine', label: 'Moine' },
  { audio: 'temps.wav', transcript: 'temps.txt', source: 'audacity-temps', label: 'Temps' },
]);

function valueAfter(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return '';
  return String(args[index + 1] || '').trim();
}

function hasFlag(args, name) {
  return args.includes(name);
}

function splitList(value = '') {
  return String(value || '')
    .split(/[,\n;]+/g)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function resolveRuntimeRoot(argv = []) {
  return path.resolve(
    valueAfter(argv, '--runtime-root')
    || getCanonicalRuntimeRoot(process.env)
  );
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256Text(text = '') {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function transcriptPreview(filePath = '') {
  try {
    if (!filePath || !fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8')
      .replace(/^\uFEFF/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
  } catch {
    return '';
  }
}

function makeOwnerAccess(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const local = normalizedEmail.endsWith('@funesterie.local');
  return {
    persona: 'djeff',
    email: normalizedEmail,
    ownerKey: getUserKey({
      id: local ? normalizedEmail.replace(/@.*/, '') : normalizedEmail,
      username: normalizedEmail,
      email: normalizedEmail,
    }),
    contributorRole: local ? 'family-admin-curator' : 'official-source',
    isOfficialSource: !local,
    voiceIdentityKey: 'djeff',
    voiceIdentityLabel: 'Djeff',
    voiceStyle: 'djeff-rap',
  };
}

function buildClip({ access, clip, audioPath, transcriptPath, audioBuffer, hash, now }) {
  const ext = path.extname(audioPath).toLowerCase() || '.wav';
  const stableStem = clip.audio
    .replace(/\.[^.]+$/i, '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const id = `audacity_${stableStem}_${hash.slice(0, 10)}`;
  const filename = `${id}${ext}`;
  const analysis = ext === '.wav'
    ? analyzeWavBuffer(audioBuffer)
    : { ok: false, reason: 'non_wav_seed', kind: 'opaque_audio', bytes: audioBuffer.length };
  const transcript = transcriptPreview(transcriptPath);
  return {
    id,
    persona: access.persona,
    ownerKey: access.ownerKey,
    emailHash: sha256Text(access.email).slice(0, 16),
    contributorRole: access.contributorRole,
    isOfficialSource: access.isOfficialSource,
    voiceIdentityKey: access.voiceIdentityKey,
    voiceIdentityLabel: access.voiceIdentityLabel,
    voiceStyle: access.voiceStyle,
    consent: 'voice-learning-v1',
    filename,
    mimeType: ext === '.wav' ? 'audio/wav' : null,
    originalName: clip.audio,
    label: clip.label,
    bytes: audioBuffer.length,
    sha256: hash,
    durationMs: analysis.ok ? Number(analysis.durationMs || 0) : 0,
    analysis,
    source: clip.source,
    transcriptPreview: transcript,
    transcriptSha256: transcript ? sha256Text(transcript) : null,
    status: 'collected',
    createdAt: now,
  };
}

function seedOwner({ runtimeRoot, sourceDir, access, clips, dryRun }) {
  const corpusDir = path.join(runtimeRoot, 'voice-learning', access.persona, access.ownerKey);
  const indexPath = path.join(corpusDir, 'index.json');
  const index = readJson(indexPath, { clips: [], trainRequests: [] });
  const existingHashes = new Set((index.clips || []).map((item) => item?.sha256).filter(Boolean));
  const added = [];
  const skipped = [];

  for (const clip of clips) {
    const audioPath = path.join(sourceDir, clip.audio);
    const transcriptPath = path.join(sourceDir, clip.transcript);
    if (!fs.existsSync(audioPath)) {
      skipped.push({ audio: clip.audio, reason: 'missing_audio' });
      continue;
    }
    const audioBuffer = fs.readFileSync(audioPath);
    const hash = sha256Buffer(audioBuffer);
    if (existingHashes.has(hash)) {
      skipped.push({ audio: clip.audio, reason: 'duplicate' });
      continue;
    }

    const seeded = buildClip({
      access,
      clip,
      audioPath,
      transcriptPath,
      audioBuffer,
      hash,
      now: new Date().toISOString(),
    });
    const targetPath = path.join(corpusDir, seeded.filename);
    if (!dryRun) {
      fs.mkdirSync(corpusDir, { recursive: true });
      fs.copyFileSync(audioPath, targetPath);
    }
    index.clips.push(seeded);
    existingHashes.add(hash);
    added.push({
      audio: clip.audio,
      filename: seeded.filename,
      durationMs: seeded.durationMs,
      bytes: seeded.bytes,
    });
  }

  if (!dryRun) {
    writeJson(indexPath, {
      clips: index.clips || [],
      trainRequests: index.trainRequests || [],
    });
  }

  const totalDurationMs = (index.clips || []).reduce((total, item) => total + Math.max(0, Number(item?.durationMs || 0)), 0);
  return {
    email: access.email,
    ownerKey: access.ownerKey,
    corpusDir,
    dryRun,
    added,
    skipped,
    clipCount: (index.clips || []).length,
    secondsCollected: Math.round((totalDurationMs / 1000) * 10) / 10,
    corpusReady: totalDurationMs >= 180_000,
  };
}

function main(argv = process.argv.slice(2)) {
  const sourceDir = path.resolve(valueAfter(argv, '--source-dir') || DEFAULT_AUDACITY_DIR);
  const runtimeRoot = resolveRuntimeRoot(argv);
  const dryRun = hasFlag(argv, '--dry-run');
  const ownerEmails = splitList(valueAfter(argv, '--emails') || process.env.DJEFF_VOICE_LEARNING_EMAILS)
    .concat(splitList(valueAfter(argv, '--email')))
    .filter(Boolean);
  const emails = ownerEmails.length ? ownerEmails : DEFAULT_OWNER_EMAILS;

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`source_dir_not_found:${sourceDir}`);
  }

  const owners = [...new Set(emails)].map(makeOwnerAccess);
  const results = owners.map((access) => seedOwner({
    runtimeRoot,
    sourceDir,
    access,
    clips: DEFAULT_CLIPS,
    dryRun,
  }));

  console.log(JSON.stringify({
    ok: true,
    dryRun,
    sourceDir,
    runtimeRoot,
    owners: results,
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: String(error?.message || error),
    }, null, 2));
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_AUDACITY_DIR,
  DEFAULT_CLIPS,
  DEFAULT_OWNER_EMAILS,
  makeOwnerAccess,
  seedOwner,
};
