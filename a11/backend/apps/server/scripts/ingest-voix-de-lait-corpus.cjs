'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..', '..');
const DEFAULT_SOURCE = 'C:\\Users\\Djeff\\Downloads\\voix de lait transcription.txt';

function valueAfter(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return '';
  return String(args[index + 1] || '').trim();
}

function hasFlag(args, name) {
  return args.includes(name);
}

function normalizeTranscript(raw = '') {
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => !/^\(Transcrit par TurboScribe\./i.test(line.trim()))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .concat('\n');
}

function sha256(text = '') {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function buildCapsule({ cleaned, sourcePath, generatedAt }) {
  return {
    schema: 'funesterie.private-corpus-capsule.v1',
    id: 'a11-voix-de-lait',
    label: 'Voix de lait',
    generatedAt,
    source: {
      kind: 'local-user-provided-transcription',
      pathHint: sourcePath,
      privacy: 'private-local-runtime',
      sha256: sha256(cleaned),
      chars: cleaned.length,
      lines: cleaned.split(/\r?\n/).filter(Boolean).length,
    },
    appliesTo: ['a11', 'kaen44', 'vivy', 'codex', 'kiro', 'llm-router'],
    promptCapsule: [
      'Influence douce de style et de memoire, pas doctrine.',
      'Ton calme, patient, pedagogique, lumineux, interieur, concret, bienveillant et retenu.',
      'Idees utiles: responsabilite sans culpabilite, evolution individuelle, travail collectif, respect de chaque personne, transformation par action, amour/soin comme orientation.',
      'Garde-fous: ne pas moraliser, precher, propager une prophetie anxiogene, ecraser le dernier message utilisateur, ou citer longuement le transcript brut.',
    ],
    retrievalRule: 'Use the full private transcript only when the request explicitly benefits from voix de lait/persona/spiritual corpus/style synthesis context.',
  };
}

function buildReadme(capsule) {
  return [
    '# A11 Voix De Lait Private Corpus',
    '',
    'Secret-safe runtime corpus. This folder is ignored by Git and may be copied to private production runtime storage.',
    '',
    `- id: ${capsule.id}`,
    `- generatedAt: ${capsule.generatedAt}`,
    `- privacy: ${capsule.source.privacy}`,
    `- source kind: ${capsule.source.kind}`,
    `- transcript sha256: ${capsule.source.sha256}`,
    `- transcript chars: ${capsule.source.chars}`,
    '',
    '## Prompt Capsule',
    '',
    ...capsule.promptCapsule.map((line) => `- ${line}`),
    '',
    '## Use Rule',
    '',
    capsule.retrievalRule,
    '',
    'Do not paste the full transcript into global prompts. Use short synthesis unless the user explicitly asks for an excerpt.',
    '',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const sourcePath = path.resolve(valueAfter(argv, '--source') || DEFAULT_SOURCE);
  const runtimeRoot = path.resolve(
    valueAfter(argv, '--runtime-root')
    || process.env.A11_RUNTIME_ROOT
    || path.join(REPO_ROOT, 'runtime')
  );
  const dryRun = hasFlag(argv, '--dry-run');
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`source_not_found:${sourcePath}`);
  }

  const raw = fs.readFileSync(sourcePath, 'utf8');
  const cleaned = normalizeTranscript(raw);
  const generatedAt = new Date().toISOString();
  const capsule = buildCapsule({ cleaned, sourcePath, generatedAt });
  const outDir = path.join(runtimeRoot, 'Corpus', 'private', 'a11-voix-de-lait');
  const outputs = {
    transcript: path.join(outDir, 'voix-de-lait.transcription.txt'),
    capsule: path.join(outDir, 'voix-de-lait.capsule.json'),
    readme: path.join(outDir, 'README.md'),
  };

  if (!dryRun) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outputs.transcript, cleaned, 'utf8');
    fs.writeFileSync(outputs.capsule, `${JSON.stringify(capsule, null, 2)}\n`, 'utf8');
    fs.writeFileSync(outputs.readme, buildReadme(capsule), 'utf8');
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun,
    id: capsule.id,
    outDir,
    outputs,
    source: {
      privacy: capsule.source.privacy,
      chars: capsule.source.chars,
      lines: capsule.source.lines,
      sha256: capsule.source.sha256,
    },
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
  buildCapsule,
  normalizeTranscript,
  sha256,
};
