'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getCanonicalRuntimeRoot } = require('../lib/runtime-root.cjs');

const SERVER_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..', '..', '..', '..');
const DEFAULT_AUDACITY_DIR = 'C:\\Users\\Djeff\\Documents\\Audacity';
const DEFAULT_SOURCE = path.join(DEFAULT_AUDACITY_DIR, 'pignon.txt');
const DEFAULT_SUPPLEMENTAL_DIR = DEFAULT_AUDACITY_DIR;

const TRANSCRIPT_CORRECTION_RULES = Object.freeze([
  [/\bquatorzieme\b/gi, 'quatorzième'],
  [/\b2\s*point\s*2\b/gi, 'deux-point-deux'],
  [/\bmillimietre\b/gi, 'millimètre'],
  [/\bfreshh\b/gi, 'fresh'],
  [/\bet et que\b/gi, 'et que'],
  [/visière\s+vissé(?!e)/gi, 'visière vissée'],
  [/\bmetal\b/gi, 'métal'],
  [/\bpignon couronne\b/gi, 'pignon-couronne'],
]);

function valueAfter(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return '';
  return String(args[index + 1] || '').trim();
}

function hasFlag(args, name) {
  return args.includes(name);
}

function applyTranscriptCorrections(text = '') {
  return TRANSCRIPT_CORRECTION_RULES.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    String(text || '')
  );
}

function normalizeTranscript(raw = '') {
  return applyTranscriptCorrections(String(raw || ''))
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^vous$/i.test(line))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .concat('\n');
}

function normalizeSupplementalTranscript(raw = '') {
  return String(raw || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .concat('\n');
}

function sha256(text = '') {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function isSupplementalTranscriptName(name = '') {
  const normalized = String(name || '').trim();
  if (!/\.txt$/i.test(normalized)) return false;
  if (/^pignon(?:\.transcription)?\.txt$/i.test(normalized)) return false;
  if (/^djeffvoice(?:\.transcription)?\.txt$/i.test(normalized)) return false;
  return true;
}

function getSupplementalTranscriptLabel(name = '') {
  return String(name || '')
    .replace(/\.transcription\.txt$/i, '')
    .replace(/\.txt$/i, '');
}

function readSupplementalTranscripts(supplementalDir = '') {
  if (!supplementalDir || !fs.existsSync(supplementalDir)) return [];
  return fs.readdirSync(supplementalDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(isSupplementalTranscriptName)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const filePath = path.join(supplementalDir, name);
      const cleaned = normalizeSupplementalTranscript(fs.readFileSync(filePath, 'utf8'));
      return {
        name: getSupplementalTranscriptLabel(name),
        pathHint: path.relative(REPO_ROOT, filePath).replace(/\\/g, '/'),
        sha256: sha256(cleaned),
        chars: cleaned.length,
        lines: cleaned.split(/\r?\n/).filter(Boolean).length,
      };
    })
    .filter((item) => item.chars > 0);
}

function buildCapsule({ cleaned, sourcePath, generatedAt, supplementalClips = [] }) {
  return {
    schema: 'funesterie.private-corpus-capsule.v1',
    id: 'djeff-pignon-rap',
    label: 'Pignon - Djeff rap voice',
    generatedAt,
    source: {
      kind: 'local-user-provided-rap-lyrics-and-owned-voice-reference',
      pathHint: sourcePath,
      privacy: 'private-local-runtime',
      sha256: sha256(cleaned),
      chars: cleaned.length,
      lines: cleaned.split(/\r?\n/).filter(Boolean).length,
      supplementalClips,
    },
    appliesTo: ['vivy', 'a11', 'kaen44', 'codex', 'kiro', 'llm-router', 'voice-router'],
    promptCapsule: [
      'Use as Djeff rap style memory and voice-routing context, not as a generic A11 voice.',
      'Tone: French technical rap, direct, mechanic, concrete, nervous but controlled.',
      'Core images: pignon-couronne, double radiateur, Ipone, moteur qui respire, roues, pneus comme crayons, guidon, visière, métal, wheeling.',
      'Supplemental clips: mood simple, avancer droit, instant présent, admettre avoir tort, ne pas faire le moine, passer au futur par action présente, système D, débrouille, détermination, responsabilité.',
      'Flow: tight diction, internal rhymes, percussive line endings, street-mechanic vocabulary, no service-client politeness.',
      'Guardrails: keep the raw audio private, do not publish the reference clip, do not smooth the slang into generic lyrics, and do not confuse Djeff rap with A11 official voice.',
    ],
    retrievalRule: 'Use this capsule when Vivy/A11 is asked for Djeff rap voice, Pignon lyrics, motorcycle rap, duo Djeff + Vivy, or voiceStyle=djeff-rap.',
  };
}

function buildReadme(capsule) {
  return [
    '# Djeff Pignon Rap Private Corpus',
    '',
    'Secret-safe runtime corpus. This folder is ignored by Git and may be copied to private production runtime storage.',
    '',
    `- id: ${capsule.id}`,
    `- generatedAt: ${capsule.generatedAt}`,
    `- privacy: ${capsule.source.privacy}`,
    `- source kind: ${capsule.source.kind}`,
    `- transcript sha256: ${capsule.source.sha256}`,
    `- transcript chars: ${capsule.source.chars}`,
    `- supplemental clips: ${capsule.source.supplementalClips.length}`,
    '',
    '## Prompt Capsule',
    '',
    ...capsule.promptCapsule.map((line) => `- ${line}`),
    '',
    '## Use Rule',
    '',
    capsule.retrievalRule,
    '',
    'Do not publish the raw reference audio. Use the cleaned voice style only in private/local voice tooling unless Djeff explicitly approves publication.',
    '',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const sourcePath = path.resolve(valueAfter(argv, '--source') || DEFAULT_SOURCE);
  const runtimeRoot = path.resolve(
    valueAfter(argv, '--runtime-root')
    || getCanonicalRuntimeRoot(process.env)
  );
  const supplementalDir = path.resolve(
    valueAfter(argv, '--supplemental-dir')
    || process.env.DJEFF_PIGNON_SUPPLEMENTAL_DIR
    || DEFAULT_SUPPLEMENTAL_DIR
  );
  const dryRun = hasFlag(argv, '--dry-run');
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`source_not_found:${sourcePath}`);
  }

  const raw = fs.readFileSync(sourcePath, 'utf8');
  const cleaned = normalizeTranscript(raw);
  const supplementalClips = hasFlag(argv, '--no-supplemental')
    ? []
    : readSupplementalTranscripts(supplementalDir);
  const generatedAt = new Date().toISOString();
  const capsule = buildCapsule({ cleaned, sourcePath, generatedAt, supplementalClips });
  const outDir = path.join(runtimeRoot, 'Corpus', 'private', 'djeff-pignon-rap');
  const outputs = {
    transcript: path.join(outDir, 'pignon.transcription.txt'),
    capsule: path.join(outDir, 'pignon.capsule.json'),
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
      supplementalClips: capsule.source.supplementalClips.length,
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
  applyTranscriptCorrections,
  buildCapsule,
  normalizeTranscript,
  normalizeSupplementalTranscript,
  readSupplementalTranscripts,
  isSupplementalTranscriptName,
  sha256,
};
