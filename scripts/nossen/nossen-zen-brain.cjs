#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  encodeZenContainer,
  ZEN_CANON
} = require('../../packages/nossen/zen/src/index.cjs');

function parseArgs(argv = []) {
  const out = {
    input: '',
    outDir: path.join(process.cwd(), 'a11', 'runtime', 'zen-brain'),
    intent: 'brain-seed',
    writeZen: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input' || arg === '--in') out.input = argv[++i] || '';
    else if (arg === '--out-dir') out.outDir = argv[++i] || out.outDir;
    else if (arg === '--intent') out.intent = argv[++i] || out.intent;
    else if (arg === '--no-zen') out.writeZen = false;
  }
  if (!out.input && argv[0] && !argv[0].startsWith('--')) out.input = argv[0];
  return out;
}

function slugify(value) {
  return String(value || 'zen-brain')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'zen-brain';
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function runJson(command, args) {
  try {
    return JSON.parse(execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024
    }));
  } catch {
    return null;
  }
}

function probeMedia(filePath) {
  return runJson('ffprobe', [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath
  ]);
}

function safeMediaSummary(probe) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video') || null;
  const audio = streams.find((stream) => stream.codec_type === 'audio') || null;
  return {
    durationSeconds: Number(probe?.format?.duration || video?.duration || audio?.duration || 0),
    sizeBytes: Number(probe?.format?.size || 0),
    format: probe?.format?.format_name || '',
    video: video ? {
      codec: video.codec_name || '',
      width: video.width || null,
      height: video.height || null,
      frameRate: video.avg_frame_rate || video.r_frame_rate || '',
      frames: video.nb_frames || null
    } : null,
    audio: audio ? {
      codec: audio.codec_name || '',
      sampleRate: audio.sample_rate || '',
      channels: audio.channels || null,
      channelLayout: audio.channel_layout || ''
    } : null
  };
}

function buildBrainSeed(filePath, options = {}) {
  const stat = fs.statSync(filePath);
  const probe = probeMedia(filePath);
  const summary = safeMediaSummary(probe);
  return {
    schema: 'nossen.zen-brain-seed.v1',
    createdAt: new Date().toISOString(),
    host: os.hostname(),
    intent: options.intent,
    source: {
      path: path.resolve(filePath),
      basename: path.basename(filePath),
      extension: path.extname(filePath).toLowerCase(),
      sizeBytes: stat.size,
      lastWriteTime: stat.mtime.toISOString(),
      sha256: sha256File(filePath)
    },
    media: summary,
    canon: {
      id: ZEN_CANON.id,
      label: ZEN_CANON.label,
      shortDefinition: ZEN_CANON.shortDefinition,
      spatialImaginaryMap: ZEN_CANON.spatialImaginaryMap,
      neo4jRelations: ZEN_CANON.neo4jRelations
    },
    graphHints: [
      ['MediaAsset', 'SEEDED_AS', 'ZEN Brain Seed'],
      ['ZEN', 'USES', 'Spatial Imaginary Map'],
      ['Qflush RGBA Cube', 'ROUTES', 'ZEN']
    ],
    next: [
      'transcribe audio into a redacted text shard if speech is present',
      'sample representative frames into visual descriptors',
      'link descriptors to Neo4j as metadata, not raw media',
      'encode enriched manifest with ZEN_KEY when available'
    ],
    privacy: {
      rawMediaCopied: false,
      rawMediaEmbedded: false,
      secretsIncluded: false
    }
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('Usage: node scripts/nossen/nossen-zen-brain.cjs --input "C:\\path\\file.mp4" [--out-dir a11\\runtime\\zen-brain]');
    process.exitCode = 2;
    return;
  }

  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const seed = buildBrainSeed(inputPath, { intent: args.intent });
  const id = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${slugify(path.basename(inputPath, path.extname(inputPath)))}`;
  fs.mkdirSync(args.outDir, { recursive: true });
  const manifestPath = path.join(args.outDir, `${id}.manifest.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(seed, null, 2)}\n`);

  let zenPath = null;
  if (args.writeZen && process.env.ZEN_KEY) {
    zenPath = path.join(args.outDir, `${id}.zen`);
    const archive = encodeZenContainer(seed, {
      key: process.env.ZEN_KEY,
      manifest: {
        intent: args.intent,
        source: seed.source,
        corpus: { kind: 'media-brain-seed' },
        axes: ['R', '+i', '-i', '+j', '-j'],
        zone: { model: 'Z_m(n)', m: 5 },
        fragments: [{ id: seed.source.sha256.slice(0, 16), role: 'media-metadata' }],
        graphHints: seed.graphHints
      }
    });
    fs.writeFileSync(zenPath, archive);
  }

  console.log(JSON.stringify({
    ok: true,
    manifestPath,
    zenPath,
    zenWritten: Boolean(zenPath),
    reasonZenSkipped: zenPath ? null : 'ZEN_KEY not set',
    source: seed.source.basename,
    sha256: seed.source.sha256,
    media: seed.media
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  buildBrainSeed,
  parseArgs,
  safeMediaSummary
};
