'use strict';

const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const multer = require('multer');
const path = require('node:path');
const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');
const {
  DEFAULT_HARMONIC_INTENSITY,
  MAX_HARMONIC_INTENSITY,
  MICROGAP_HALF_PLUS_CANON_MG,
  MIN_HARMONIC_INTENSITY,
  processProtectMixD40,
  resolveD40Density,
  resolveHarmonicIntensity,
} = require('../audio/double-harmonic-d40.cjs');
const {
  analyzePhaseLockV2,
  buildPhaseLockPlan,
  processPhaseAwareD40V2,
} = require('../audio/double-harmonic-phase-lock-v2.cjs');
const {
  buildDynamicWeightPlanV3,
  processDynamicWeightD40V3,
} = require('../audio/double-harmonic-dynamic-v3.cjs');
const {
  buildNakedD40PlanV4,
  processNakedD40V4,
} = require('../audio/double-harmonic-naked-v4.cjs');
const {
  buildLogD40PlanV5,
  processLogD40V5,
} = require('../audio/double-harmonic-log-v5.cjs');
const {
  buildResonanceD40PlanV6,
  processResonanceD40V6,
} = require('../audio/double-harmonic-resonance-v6.cjs');
const {
  buildBricksD40PlanV7,
  processBricksD40V7,
} = require('../audio/double-harmonic-bricks-v7.cjs');
const {
  buildClosedPhaseD40PlanV8,
  buildClosedPhaseD40PlanV8Pivot,
  buildClosedPhaseD40PlanV8Plus,
  buildTurboD40PlanV9,
  DEFAULT_V9_TURBO_FRAME_MS,
  processClosedPhaseD40V8,
  processClosedPhaseD40V8Pivot,
  processClosedPhaseD40V8Plus,
  processTurboD40V9,
} = require('../audio/double-harmonic-closed-phase-v8.cjs');

const DEFAULT_MAX_MB = 80;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_OUTPUT_FORMAT = 'flac';

const OUTPUT_FORMATS = Object.freeze({
  mp3: Object.freeze({ ext: 'mp3', contentType: 'audio/mpeg' }),
  m4a: Object.freeze({ ext: 'm4a', contentType: 'audio/mp4' }),
  wav: Object.freeze({ ext: 'wav', contentType: 'audio/wav' }),
  flac: Object.freeze({ ext: 'flac', contentType: 'audio/flac' }),
  ogg: Object.freeze({ ext: 'ogg', contentType: 'audio/ogg' }),
});

const ALLOWED_MIME = new Set([
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'audio/ogg',
  'audio/webm',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

const ALLOWED_EXT = new Set(['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'webm', 'mp4', 'mov']);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function reqNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function reqBoolean(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return undefined;
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true;
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false;
  return undefined;
}

function safeBaseName(value = 'audio') {
  return path.basename(String(value || 'audio'))
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'audio';
}

function extForUpload(file = {}) {
  const fromName = String(file.originalname || '').split('.').pop().toLowerCase();
  if (ALLOWED_EXT.has(fromName)) return fromName;
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('flac')) return 'flac';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('webm')) return 'webm';
  return 'wav';
}

function contentTypeForFile(filename = '') {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.m4a') return 'audio/mp4';
  if (ext === '.aac') return 'audio/aac';
  if (ext === '.mp4') return 'audio/mp4';
  return 'audio/wav';
}

function normalizeOutputSourceExt(value) {
  const ext = String(value || '').trim().toLowerCase().replace(/^\./, '');
  if (ext === 'source') return 'source';
  if (ext === 'wave') return 'wav';
  if (ext === 'aac' || ext === 'mp4' || ext === 'mov' || ext === 'webm') return 'm4a';
  if (Object.prototype.hasOwnProperty.call(OUTPUT_FORMATS, ext)) return ext;
  return 'flac';
}

function resolveOutputFormat(value, sourceExt = '') {
  const requested = String(value || process.env.A11_DH_OUTPUT_FORMAT || DEFAULT_OUTPUT_FORMAT)
    .trim()
    .toLowerCase()
    .replace(/^\./, '');
  const key = !requested || requested === 'source'
    ? normalizeOutputSourceExt(sourceExt)
    : normalizeOutputSourceExt(requested);
  if (key === 'source') return OUTPUT_FORMATS[normalizeOutputSourceExt(sourceExt)] || OUTPUT_FORMATS.mp3;
  return OUTPUT_FORMATS[key] || OUTPUT_FORMATS.mp3;
}

function isAllowedUpload(file = {}) {
  const mime = String(file.mimetype || '').toLowerCase();
  const ext = String(file.originalname || '').split('.').pop().toLowerCase();
  return ALLOWED_MIME.has(mime) || ALLOWED_EXT.has(ext);
}

function isLocalRouteHost(host) {
  const value = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split(':')[0];
  if (!value) return false;
  if (value === 'localhost' || value === '::1' || value === '0.0.0.0') return true;
  if (/^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value)) return true;
  const private172 = value.match(/^172\.(\d+)\./);
  return private172 ? Number(private172[1]) >= 16 && Number(private172[1]) <= 31 : false;
}

function resolvePublicRouteProtocol(req, host) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const requestProto = String(req.protocol || '').trim().toLowerCase();
  const proto = (forwardedProto || requestProto || 'https').replace(/:$/, '');
  if (proto === 'https') return 'https';
  if (isLocalRouteHost(host)) return proto || 'http';
  if (req.secure || req.socket?.encrypted) return 'https';
  return 'https';
}

function routePublicBase(req) {
  const configured = String(process.env.A11_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = resolvePublicRouteProtocol(req, host);
  return host ? `${proto}://${host}` : '';
}

function readIndex(indexPath) {
  try {
    if (!fs.existsSync(indexPath)) return { assets: [] };
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return { assets: Array.isArray(parsed?.assets) ? parsed.assets : [] };
  } catch {
    return { assets: [] };
  }
}

function writeIndex(indexPath, index) {
  fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

function pruneIndex(indexPath, root, ttlMs) {
  const now = Date.now();
  const index = readIndex(indexPath);
  const kept = [];
  for (const asset of index.assets) {
    const createdAt = Date.parse(asset.createdAt || '') || 0;
    const expired = createdAt && now - createdAt > ttlMs;
    if (expired) {
      for (const key of ['inputFilename', 'outputFilename']) {
        const filename = path.basename(String(asset[key] || ''));
        if (!filename) continue;
        try { fs.rmSync(path.join(root, filename), { force: true }); } catch {}
      }
      continue;
    }
    kept.push(asset);
  }
  if (kept.length !== index.assets.length) writeIndex(indexPath, { assets: kept });
  return kept;
}

function createDoubleHarmonicRouter(options = {}) {
  const router = express.Router();
  const verifyJWT = typeof options.verifyJWT === 'function' ? options.verifyJWT : (_req, _res, next) => next();
  const processAudio = typeof options.processProtectMixD40 === 'function'
    ? options.processProtectMixD40
    : processProtectMixD40;
  const analyzeAudio = typeof options.analyzePhaseLockV2 === 'function'
    ? options.analyzePhaseLockV2
    : analyzePhaseLockV2;
  const processAudioV2 = typeof options.processPhaseAwareD40V2 === 'function'
    ? options.processPhaseAwareD40V2
    : processPhaseAwareD40V2;
  const processAudioV3 = typeof options.processDynamicWeightD40V3 === 'function'
    ? options.processDynamicWeightD40V3
    : processDynamicWeightD40V3;
  const processAudioV4 = typeof options.processNakedD40V4 === 'function'
    ? options.processNakedD40V4
    : processNakedD40V4;
  const processAudioV5 = typeof options.processLogD40V5 === 'function'
    ? options.processLogD40V5
    : processLogD40V5;
  const processAudioV6 = typeof options.processResonanceD40V6 === 'function'
    ? options.processResonanceD40V6
    : processResonanceD40V6;
  const processAudioV7 = typeof options.processBricksD40V7 === 'function'
    ? options.processBricksD40V7
    : processBricksD40V7;
  const processAudioV8 = typeof options.processClosedPhaseD40V8 === 'function'
    ? options.processClosedPhaseD40V8
    : processClosedPhaseD40V8;
  const processAudioV8Plus = typeof options.processClosedPhaseD40V8Plus === 'function'
    ? options.processClosedPhaseD40V8Plus
    : processClosedPhaseD40V8Plus;
  const processAudioV8Pivot = typeof options.processClosedPhaseD40V8Pivot === 'function'
    ? options.processClosedPhaseD40V8Pivot
    : processClosedPhaseD40V8Pivot;
  const processAudioV9Turbo = typeof options.processTurboD40V9 === 'function'
    ? options.processTurboD40V9
    : processTurboD40V9;
  const runtimeRoot = path.resolve(options.runtimeRoot || getCanonicalRuntimeRoot(process.env));
  const assetRoot = ensureDir(path.join(runtimeRoot, 'double-harmonic-d40'));
  const indexPath = path.join(assetRoot, 'index.json');
  const ttlMs = Math.max(60_000, Number(process.env.A11_DH_ASSET_TTL_MS || DEFAULT_TTL_MS) || DEFAULT_TTL_MS);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: Math.max(1, Math.min(500, Number(process.env.A11_DH_MAX_MB || DEFAULT_MAX_MB) || DEFAULT_MAX_MB)) * 1024 * 1024,
      files: 1,
    },
    fileFilter(_req, file, cb) {
      if (isAllowedUpload(file)) return cb(null, true);
      return cb(new Error(`Type audio non supporte: ${file.mimetype || 'unknown'}`));
    },
  });

  router.get('/status', (_req, res) => {
    const outputFormat = resolveOutputFormat();
    return res.json({
      ok: true,
      method: 'dry-master-plus-adaptive-d40-harmonic-overlay-v1',
      maxMb: Math.max(1, Math.min(500, Number(process.env.A11_DH_MAX_MB || DEFAULT_MAX_MB) || DEFAULT_MAX_MB)),
      d40: resolveD40Density(),
      mg: MICROGAP_HALF_PLUS_CANON_MG,
      intensity: {
        default: DEFAULT_HARMONIC_INTENSITY,
        min: MIN_HARMONIC_INTENSITY,
        max: MAX_HARMONIC_INTENSITY,
      },
      outputFormat: DEFAULT_OUTPUT_FORMAT,
      defaultResolvedOutputFormat: outputFormat.contentType,
      outputFormats: Object.keys(OUTPUT_FORMATS),
      v2: buildPhaseLockPlan(),
      v3: buildDynamicWeightPlanV3(),
      v4: buildNakedD40PlanV4(),
      v5: buildLogD40PlanV5(),
      v6: buildResonanceD40PlanV6(),
      v7: buildBricksD40PlanV7(),
      v71: buildBricksD40PlanV7({ binaryGrid: 'exact1024' }),
      v8: buildClosedPhaseD40PlanV8(),
      v8plus: buildClosedPhaseD40PlanV8Plus(),
      v8pivot: buildClosedPhaseD40PlanV8Pivot(),
      v9turbo: buildTurboD40PlanV9(),
    });
  });

  router.get('/v2/status', (_req, res) => {
    return res.json({
      ok: true,
      v2: buildPhaseLockPlan({
        frameMs: reqNumber(_req.query?.frameMs),
        cycleSeconds: reqNumber(_req.query?.cycleSeconds),
        smoothing: _req.query?.smoothing,
      }),
    });
  });

  router.get('/v3/status', (_req, res) => {
    return res.json({
      ok: true,
      v3: buildDynamicWeightPlanV3({
        frameMs: reqNumber(_req.query?.frameMs),
        maxSeconds: reqNumber(_req.query?.maxSeconds),
      }),
    });
  });

  router.get('/v4/status', (_req, res) => {
    return res.json({
      ok: true,
      v4: buildNakedD40PlanV4({
        frameMs: reqNumber(_req.query?.frameMs),
        maxSeconds: reqNumber(_req.query?.maxSeconds),
        cycleSeconds: reqNumber(_req.query?.cycleSeconds),
        lowGrainMultiplier: reqNumber(_req.query?.lowGrainMultiplier),
        highGrainPower: reqNumber(_req.query?.highGrainPower),
        weightScale: reqNumber(_req.query?.weightScale || _req.query?.intensity || _req.query?.harmonicIntensity),
      }),
    });
  });

  router.get('/v5/status', (_req, res) => {
    return res.json({
      ok: true,
      v5: buildLogD40PlanV5({
        frameMs: reqNumber(_req.query?.frameMs),
        maxSeconds: reqNumber(_req.query?.maxSeconds),
        cycleSeconds: reqNumber(_req.query?.cycleSeconds),
        weightScale: reqNumber(_req.query?.weightScale || _req.query?.intensity || _req.query?.harmonicIntensity),
      }),
    });
  });

  router.get('/v6/status', (_req, res) => {
    return res.json({
      ok: true,
      v6: buildResonanceD40PlanV6({
        frameMs: reqNumber(_req.query?.frameMs),
        maxSeconds: reqNumber(_req.query?.maxSeconds),
        cycleSeconds: reqNumber(_req.query?.cycleSeconds),
        userK: reqNumber(
          _req.query?.userK
          || _req.query?.resonanceK
          || _req.query?.weightScale
          || _req.query?.intensity
          || _req.query?.harmonicIntensity
        ),
        kCeiling: reqNumber(_req.query?.kCeiling),
      }),
    });
  });

  router.get('/v7/status', (_req, res) => {
    return res.json({
      ok: true,
      v7: buildBricksD40PlanV7({
        frameMs: reqNumber(_req.query?.frameMs),
        maxSeconds: reqNumber(_req.query?.maxSeconds),
        cycleSeconds: reqNumber(_req.query?.cycleSeconds),
        userK: reqNumber(
          _req.query?.userK
          || _req.query?.resonanceK
          || _req.query?.weightScale
          || _req.query?.intensity
          || _req.query?.harmonicIntensity
        ),
        kCeiling: reqNumber(_req.query?.kCeiling),
        minBricks: reqNumber(_req.query?.minBricks),
        maxBricks: reqNumber(_req.query?.maxBricks),
        brickInfluence: reqNumber(_req.query?.brickInfluence),
      }),
    });
  });

  router.get('/v71/status', (_req, res) => {
    return res.json({
      ok: true,
      v71: buildBricksD40PlanV7({
        frameMs: reqNumber(_req.query?.frameMs),
        maxSeconds: reqNumber(_req.query?.maxSeconds),
        cycleSeconds: reqNumber(_req.query?.cycleSeconds),
        userK: reqNumber(
          _req.query?.userK
          || _req.query?.resonanceK
          || _req.query?.weightScale
          || _req.query?.intensity
          || _req.query?.harmonicIntensity
        ),
        kCeiling: reqNumber(_req.query?.kCeiling),
        minBricks: reqNumber(_req.query?.minBricks),
        maxBricks: reqNumber(_req.query?.maxBricks),
        brickInfluence: reqNumber(_req.query?.brickInfluence),
        binaryGrid: _req.query?.binaryGrid || 'exact1024',
      }),
    });
  });

  router.get('/v8/status', (_req, res) => {
    return res.json({
      ok: true,
      v8: buildClosedPhaseD40PlanV8({
        frameMs: reqNumber(_req.query?.frameMs),
        maxSeconds: reqNumber(_req.query?.maxSeconds),
        cycleSeconds: reqNumber(_req.query?.cycleSeconds),
        userK: reqNumber(
          _req.query?.userK
          || _req.query?.resonanceK
          || _req.query?.weightScale
          || _req.query?.intensity
          || _req.query?.harmonicIntensity
        ),
        kCeiling: reqNumber(_req.query?.kCeiling),
        phaseSlots: reqNumber(_req.query?.phaseSlots || _req.query?.binaryGridSlots),
        c7PhaseScale: reqNumber(_req.query?.c7PhaseScale),
      }),
    });
  });

  router.get('/v8plus/status', (_req, res) => {
    return res.json({
      ok: true,
      v8plus: buildClosedPhaseD40PlanV8Plus({
        frameMs: reqNumber(_req.query?.frameMs),
        maxSeconds: reqNumber(_req.query?.maxSeconds),
        cycleSeconds: reqNumber(_req.query?.cycleSeconds),
        userK: reqNumber(
          _req.query?.userK
          || _req.query?.resonanceK
          || _req.query?.weightScale
          || _req.query?.intensity
          || _req.query?.harmonicIntensity
        ),
        kCeiling: reqNumber(_req.query?.kCeiling),
        phaseSlots: reqNumber(_req.query?.phaseSlots || _req.query?.binaryGridSlots),
        c7PhaseScale: reqNumber(_req.query?.c7PhaseScale),
      }),
    });
  });

  router.get('/v8pivot/status', (_req, res) => {
    return res.json({
      ok: true,
      v8pivot: buildClosedPhaseD40PlanV8Pivot({
        frameMs: reqNumber(_req.query?.frameMs),
        maxSeconds: reqNumber(_req.query?.maxSeconds),
        cycleSeconds: reqNumber(_req.query?.cycleSeconds),
        userK: reqNumber(
          _req.query?.userK
          || _req.query?.resonanceK
          || _req.query?.weightScale
          || _req.query?.intensity
          || _req.query?.harmonicIntensity
        ),
        kCeiling: reqNumber(_req.query?.kCeiling),
        phaseSlots: reqNumber(_req.query?.phaseSlots || _req.query?.binaryGridSlots),
        c7PhaseScale: reqNumber(_req.query?.c7PhaseScale),
      }),
    });
  });

  router.get('/v9turbo/status', (_req, res) => {
    return res.json({
      ok: true,
      v9turbo: buildTurboD40PlanV9({
        maxSeconds: reqNumber(_req.query?.maxSeconds),
        frameMs: reqNumber(_req.query?.frameMs),
        cycleSeconds: reqNumber(_req.query?.cycleSeconds),
        userK: reqNumber(
          _req.query?.userK
          || _req.query?.resonanceK
          || _req.query?.weightScale
          || _req.query?.intensity
          || _req.query?.harmonicIntensity
        ),
        kCeiling: reqNumber(_req.query?.kCeiling),
        phaseSlots: reqNumber(_req.query?.phaseSlots || _req.query?.binaryGridSlots),
        c7PhaseScale: reqNumber(_req.query?.c7PhaseScale),
        modulation: _req.query?.modulation || _req.query?.modulationMode,
        electrolysis: reqBoolean(_req.query?.electrolysis || _req.query?.electrolysisGuitar),
        frequencyHz: reqNumber(_req.query?.frequencyHz || _req.query?.modulationFrequencyHz || _req.query?.electrolysisHz || _req.query?.waterFrequencyHz),
        frequencyMinHz: reqNumber(_req.query?.frequencyMinHz || _req.query?.minFrequencyHz || _req.query?.frequencyLowHz || _req.query?.electrolysisMinHz || _req.query?.waterMinHz),
        frequencyMaxHz: reqNumber(_req.query?.frequencyMaxHz || _req.query?.maxFrequencyHz || _req.query?.frequencyHighHz || _req.query?.electrolysisMaxHz || _req.query?.waterMaxHz),
        amount: reqNumber(_req.query?.amount || _req.query?.modulationAmount),
        irregularity: reqNumber(_req.query?.irregularity),
        asymmetry: reqNumber(_req.query?.asymmetry),
        bidirectional: reqBoolean(_req.query?.bidirectional),
        followForce: reqNumber(_req.query?.followForce),
        schemaMix: reqNumber(_req.query?.schemaMix),
      }),
    });
  });

  router.post('/v2/analyze', verifyJWT, upload.single('audio'), async (req, res) => {
    const tempFiles = [];
    try {
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: 'missing_audio', message: 'Ajoute un fichier audio.' });
      }

      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const base = safeBaseName(req.body?.name || req.file.originalname || 'audio');
      const inputExt = extForUpload(req.file);
      const inputFilename = `${id}-${base}-v2-analyze.${inputExt}`;
      const inputPath = path.join(assetRoot, inputFilename);
      fs.writeFileSync(inputPath, req.file.buffer);
      tempFiles.push(inputPath);

      const analysis = await analyzeAudio({
        inputPath,
        profile: String(req.body?.profile || req.query?.profile || 'blend').trim() || 'blend',
        frameMs: reqNumber(req.body?.frameMs || req.query?.frameMs),
        cycleSeconds: reqNumber(req.body?.cycleSeconds || req.query?.cycleSeconds),
        smoothing: req.body?.smoothing || req.query?.smoothing,
        maxSeconds: reqNumber(req.body?.maxSeconds || req.query?.maxSeconds),
        maxFrames: reqNumber(req.body?.maxFrames || req.query?.maxFrames),
        maxFrameDetails: reqNumber(req.body?.maxFrameDetails || req.query?.maxFrameDetails),
      });

      return res.json({
        ok: true,
        id,
        method: analysis.method,
        v2: analysis,
        publicSummary: 'Analyse V2: f0, phase, energie par bandes, transitoires et enveloppe D40 pour synchronisation harmonique.',
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'double_harmonic_v2_analyze_failed',
        message: String(error?.message || error),
      });
    } finally {
      for (const filePath of tempFiles) {
        try { fs.rmSync(filePath, { force: true }); } catch {}
      }
    }
  });

  router.post('/v2/process', verifyJWT, upload.single('audio'), async (req, res) => {
    try {
      pruneIndex(indexPath, assetRoot, ttlMs);
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: 'missing_audio', message: 'Ajoute un fichier audio.' });
      }

      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const base = safeBaseName(req.body?.name || req.file.originalname || 'audio');
      const inputExt = extForUpload(req.file);
      const inputFilename = `${id}-${base}-v2-input.${inputExt}`;
      const outputFormat = resolveOutputFormat(req.body?.format || req.query?.format, inputExt);
      const outputFilename = `${id}-${base}-funesterie-d40-v2.${outputFormat.ext}`;
      const inputPath = path.join(assetRoot, inputFilename);
      const outputPath = path.join(assetRoot, outputFilename);
      fs.writeFileSync(inputPath, req.file.buffer);

      const profile = String(req.body?.profile || req.query?.profile || 'blend').trim() || 'blend';
      const intensity = resolveHarmonicIntensity(req.body?.intensity || req.query?.intensity);
      const processing = await processAudioV2({
        inputPath,
        outputPath,
        profile,
        intensity,
        analysisOptions: {
          frameMs: reqNumber(req.body?.frameMs || req.query?.frameMs),
          cycleSeconds: reqNumber(req.body?.cycleSeconds || req.query?.cycleSeconds),
          smoothing: req.body?.smoothing || req.query?.smoothing,
          maxSeconds: reqNumber(req.body?.maxSeconds || req.query?.maxSeconds),
          maxFrames: reqNumber(req.body?.maxFrames || req.query?.maxFrames),
        },
      });
      const token = crypto.randomBytes(18).toString('base64url');
      const createdAt = new Date().toISOString();
      const owner = String(req.user?.email || req.user?.username || req.user?.sub || '').trim();
      const asset = {
        id,
        token,
        createdAt,
        owner,
        originalName: req.file.originalname || '',
        inputFilename,
        outputFilename,
        contentType: outputFormat.contentType,
        method: processing.method,
        profile: processing.profile,
        intensity: processing.intensity || intensity,
        weights: processing.weights || null,
        analysisSummary: processing.analysis?.summary || null,
        bytes: fs.statSync(outputPath).size,
      };
      const index = readIndex(indexPath);
      index.assets = [asset, ...index.assets].slice(0, 300);
      writeIndex(indexPath, index);

      const baseUrl = routePublicBase(req);
      const audioUrl = `/api/double-harmonic/out/${encodeURIComponent(outputFilename)}`;
      const sharePath = `${audioUrl}?token=${encodeURIComponent(token)}`;
      return res.json({
        ok: true,
        id,
        method: processing.method,
        state: processing.state,
        profile: processing.profile,
        intensity: processing.intensity || intensity,
        phase: processing.phase,
        analysis: processing.analysis,
        weights: processing.weights || undefined,
        audioUrl,
        shareUrl: baseUrl ? `${baseUrl}${sharePath}` : sharePath,
        contentType: outputFormat.contentType,
        filename: outputFilename,
        bytes: asset.bytes,
        publicSummary: 'V2 experimentale: analyse f0/phase, Rubber Band phase laminar, transitoires crisp et mix D40 protege.',
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'double_harmonic_v2_process_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.post('/v3/process', verifyJWT, upload.single('audio'), async (req, res) => {
    try {
      pruneIndex(indexPath, assetRoot, ttlMs);
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: 'missing_audio', message: 'Ajoute un fichier audio.' });
      }

      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const base = safeBaseName(req.body?.name || req.file.originalname || 'audio');
      const inputExt = extForUpload(req.file);
      const inputFilename = `${id}-${base}-v3-input.${inputExt}`;
      const outputFormat = resolveOutputFormat(req.body?.format || req.query?.format, inputExt);
      const outputFilename = `${id}-${base}-funesterie-d40-v3.${outputFormat.ext}`;
      const inputPath = path.join(assetRoot, inputFilename);
      const outputPath = path.join(assetRoot, outputFilename);
      fs.writeFileSync(inputPath, req.file.buffer);

      const profile = String(req.body?.profile || req.query?.profile || 'blend').trim() || 'blend';
      const processing = await processAudioV3({
        inputPath,
        outputPath,
        profile,
        analysisOptions: {
          frameMs: reqNumber(req.body?.frameMs || req.query?.frameMs),
          maxSeconds: reqNumber(req.body?.maxSeconds || req.query?.maxSeconds),
          maxSegments: reqNumber(req.body?.maxSegments || req.query?.maxSegments),
          curve: req.body?.curve || req.query?.curve,
          curveAmount: reqNumber(req.body?.curveAmount || req.query?.curveAmount),
          riseLog: reqNumber(req.body?.riseLog || req.query?.riseLog),
          fallExp: reqNumber(req.body?.fallExp || req.query?.fallExp),
          attack: reqNumber(req.body?.attack || req.query?.attack),
          release: reqNumber(req.body?.release || req.query?.release),
          minDbSpan: reqNumber(req.body?.minDbSpan || req.query?.minDbSpan),
          invertGrain: reqBoolean(req.body?.invertGrain ?? req.query?.invertGrain),
          invertPitch: reqBoolean(req.body?.invertPitch ?? req.query?.invertPitch),
          swapPitchGrain: reqBoolean(req.body?.swapPitchGrain ?? req.query?.swapPitchGrain),
        },
      });
      const token = crypto.randomBytes(18).toString('base64url');
      const createdAt = new Date().toISOString();
      const owner = String(req.user?.email || req.user?.username || req.user?.sub || '').trim();
      const asset = {
        id,
        token,
        createdAt,
        owner,
        originalName: req.file.originalname || '',
        inputFilename,
        outputFilename,
        contentType: outputFormat.contentType,
        method: processing.method,
        profile: processing.profile,
        intensity: 'auto',
        weights: processing.weights || null,
        dynamicSummary: processing.dynamic?.summary || null,
        bytes: fs.statSync(outputPath).size,
      };
      const index = readIndex(indexPath);
      index.assets = [asset, ...index.assets].slice(0, 300);
      writeIndex(indexPath, index);

      const baseUrl = routePublicBase(req);
      const audioUrl = `/api/double-harmonic/out/${encodeURIComponent(outputFilename)}`;
      const sharePath = `${audioUrl}?token=${encodeURIComponent(token)}`;
      return res.json({
        ok: true,
        id,
        method: processing.method,
        state: processing.state,
        profile: processing.profile,
        intensity: 'auto',
        dynamic: processing.dynamic,
        weights: processing.weights || undefined,
        audioUrl,
        shareUrl: baseUrl ? `${baseUrl}${sharePath}` : sharePath,
        contentType: outputFormat.contentType,
        filename: outputFilename,
        bytes: asset.bytes,
        publicSummary: 'V3 auto: poids harmonique dynamique selon les dB, mg fixe, mix D40 protege.',
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'double_harmonic_v3_process_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.post('/v4/process', verifyJWT, upload.single('audio'), async (req, res) => {
    try {
      pruneIndex(indexPath, assetRoot, ttlMs);
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: 'missing_audio', message: 'Ajoute un fichier audio.' });
      }

      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const base = safeBaseName(req.body?.name || req.file.originalname || 'audio');
      const inputExt = extForUpload(req.file);
      const inputFilename = `${id}-${base}-v4-input.${inputExt}`;
      const outputFormat = resolveOutputFormat(req.body?.format || req.query?.format, inputExt);
      const outputFilename = `${id}-${base}-funesterie-d40-v4.${outputFormat.ext}`;
      const inputPath = path.join(assetRoot, inputFilename);
      const outputPath = path.join(assetRoot, outputFilename);
      fs.writeFileSync(inputPath, req.file.buffer);

      const profile = String(req.body?.profile || req.query?.profile || 'blend').trim() || 'blend';
      const processing = await processAudioV4({
        inputPath,
        outputPath,
        profile,
        analysisOptions: {
          frameMs: reqNumber(req.body?.frameMs || req.query?.frameMs),
          maxSeconds: reqNumber(req.body?.maxSeconds || req.query?.maxSeconds),
          maxSegments: reqNumber(req.body?.maxSegments || req.query?.maxSegments),
          curve: req.body?.curve || req.query?.curve,
          curveAmount: reqNumber(req.body?.curveAmount || req.query?.curveAmount),
          attack: reqNumber(req.body?.attack || req.query?.attack),
          release: reqNumber(req.body?.release || req.query?.release),
          minDbSpan: reqNumber(req.body?.minDbSpan || req.query?.minDbSpan),
          cycleSeconds: reqNumber(req.body?.cycleSeconds || req.query?.cycleSeconds),
          lowGrainMultiplier: reqNumber(req.body?.lowGrainMultiplier || req.query?.lowGrainMultiplier),
          highGrainPower: reqNumber(req.body?.highGrainPower || req.query?.highGrainPower),
          weightScale: reqNumber(
            req.body?.weightScale
            || req.query?.weightScale
            || req.body?.intensity
            || req.query?.intensity
            || req.body?.harmonicIntensity
            || req.query?.harmonicIntensity
          ),
        },
      });
      const token = crypto.randomBytes(18).toString('base64url');
      const createdAt = new Date().toISOString();
      const owner = String(req.user?.email || req.user?.username || req.user?.sub || '').trim();
      const asset = {
        id,
        token,
        createdAt,
        owner,
        originalName: req.file.originalname || '',
        inputFilename,
        outputFilename,
        contentType: outputFormat.contentType,
        method: processing.method,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'd40',
        weights: processing.weights || null,
        dynamicSummary: processing.dynamic?.summary || null,
        safety: processing.safety || null,
        bytes: fs.statSync(outputPath).size,
      };
      const index = readIndex(indexPath);
      index.assets = [asset, ...index.assets].slice(0, 300);
      writeIndex(indexPath, index);

      const baseUrl = routePublicBase(req);
      const audioUrl = `/api/double-harmonic/out/${encodeURIComponent(outputFilename)}`;
      const sharePath = `${audioUrl}?token=${encodeURIComponent(token)}`;
      return res.json({
        ok: true,
        id,
        method: processing.method,
        state: processing.state,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'd40',
        d40: processing.d40,
        dynamic: processing.dynamic,
        weights: processing.weights || undefined,
        safety: processing.safety || undefined,
        audioUrl,
        shareUrl: baseUrl ? `${baseUrl}${sharePath}` : sharePath,
        contentType: outputFormat.contentType,
        filename: outputFilename,
        bytes: asset.bytes,
        publicSummary: 'V4 Release: D40 nu, double harmonique sans filtres, sans limiteur et sans gain final.',
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'double_harmonic_v4_process_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.post('/v5/process', verifyJWT, upload.single('audio'), async (req, res) => {
    try {
      pruneIndex(indexPath, assetRoot, ttlMs);
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: 'missing_audio', message: 'Ajoute un fichier audio.' });
      }

      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const base = safeBaseName(req.body?.name || req.file.originalname || 'audio');
      const inputExt = extForUpload(req.file);
      const inputFilename = `${id}-${base}-v5-input.${inputExt}`;
      const outputFormat = resolveOutputFormat(req.body?.format || req.query?.format, inputExt);
      const outputFilename = `${id}-${base}-funesterie-d40-v5.${outputFormat.ext}`;
      const inputPath = path.join(assetRoot, inputFilename);
      const outputPath = path.join(assetRoot, outputFilename);
      fs.writeFileSync(inputPath, req.file.buffer);

      const profile = String(req.body?.profile || req.query?.profile || 'blend').trim() || 'blend';
      const processing = await processAudioV5({
        inputPath,
        outputPath,
        profile,
        analysisOptions: {
          frameMs: reqNumber(req.body?.frameMs || req.query?.frameMs),
          maxSeconds: reqNumber(req.body?.maxSeconds || req.query?.maxSeconds),
          maxSegments: reqNumber(req.body?.maxSegments || req.query?.maxSegments),
          curve: req.body?.curve || req.query?.curve,
          curveAmount: reqNumber(req.body?.curveAmount || req.query?.curveAmount),
          attack: reqNumber(req.body?.attack || req.query?.attack),
          release: reqNumber(req.body?.release || req.query?.release),
          minDbSpan: reqNumber(req.body?.minDbSpan || req.query?.minDbSpan),
          cycleSeconds: reqNumber(req.body?.cycleSeconds || req.query?.cycleSeconds),
          weightScale: reqNumber(
            req.body?.weightScale
            || req.query?.weightScale
            || req.body?.intensity
            || req.query?.intensity
            || req.body?.harmonicIntensity
            || req.query?.harmonicIntensity
          ),
        },
      });
      const token = crypto.randomBytes(18).toString('base64url');
      const createdAt = new Date().toISOString();
      const owner = String(req.user?.email || req.user?.username || req.user?.sub || '').trim();
      const asset = {
        id,
        token,
        createdAt,
        owner,
        originalName: req.file.originalname || '',
        inputFilename,
        outputFilename,
        contentType: outputFormat.contentType,
        method: processing.method,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'd40-log',
        weights: processing.weights || null,
        dynamicSummary: processing.dynamic?.summary || null,
        safety: processing.safety || null,
        bytes: fs.statSync(outputPath).size,
      };
      const index = readIndex(indexPath);
      index.assets = [asset, ...index.assets].slice(0, 300);
      writeIndex(indexPath, index);

      const baseUrl = routePublicBase(req);
      const audioUrl = `/api/double-harmonic/out/${encodeURIComponent(outputFilename)}`;
      const sharePath = `${audioUrl}?token=${encodeURIComponent(token)}`;
      return res.json({
        ok: true,
        id,
        method: processing.method,
        state: processing.state,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'd40-log',
        d40: processing.d40,
        dynamic: processing.dynamic,
        weights: processing.weights || undefined,
        safety: processing.safety || undefined,
        audioUrl,
        shareUrl: baseUrl ? `${baseUrl}${sharePath}` : sharePath,
        contentType: outputFormat.contentType,
        filename: outputFilename,
        bytes: asset.bytes,
        publicSummary: 'V5 Release: repli logarithmique 3D, bas 1/2D, haut ln(3D), D40 nu x2 par defaut.',
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'double_harmonic_v5_process_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.post('/v6/process', verifyJWT, upload.single('audio'), async (req, res) => {
    try {
      pruneIndex(indexPath, assetRoot, ttlMs);
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: 'missing_audio', message: 'Ajoute un fichier audio.' });
      }

      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const base = safeBaseName(req.body?.name || req.file.originalname || 'audio');
      const inputExt = extForUpload(req.file);
      const inputFilename = `${id}-${base}-v6-input.${inputExt}`;
      const outputFormat = resolveOutputFormat(req.body?.format || req.query?.format, inputExt);
      const outputFilename = `${id}-${base}-funesterie-d40-v6.${outputFormat.ext}`;
      const inputPath = path.join(assetRoot, inputFilename);
      const outputPath = path.join(assetRoot, outputFilename);
      fs.writeFileSync(inputPath, req.file.buffer);

      const profile = String(req.body?.profile || req.query?.profile || 'blend').trim() || 'blend';
      const processing = await processAudioV6({
        inputPath,
        outputPath,
        profile,
        analysisOptions: {
          frameMs: reqNumber(req.body?.frameMs || req.query?.frameMs),
          maxSeconds: reqNumber(req.body?.maxSeconds || req.query?.maxSeconds),
          maxSegments: reqNumber(req.body?.maxSegments || req.query?.maxSegments),
          curve: req.body?.curve || req.query?.curve,
          curveAmount: reqNumber(req.body?.curveAmount || req.query?.curveAmount),
          attack: reqNumber(req.body?.attack || req.query?.attack),
          release: reqNumber(req.body?.release || req.query?.release),
          minDbSpan: reqNumber(req.body?.minDbSpan || req.query?.minDbSpan),
          cycleSeconds: reqNumber(req.body?.cycleSeconds || req.query?.cycleSeconds),
          userK: reqNumber(
            req.body?.userK
            || req.query?.userK
            || req.body?.resonanceK
            || req.query?.resonanceK
            || req.body?.weightScale
            || req.query?.weightScale
            || req.body?.intensity
            || req.query?.intensity
            || req.body?.harmonicIntensity
            || req.query?.harmonicIntensity
          ),
          kCeiling: reqNumber(req.body?.kCeiling || req.query?.kCeiling),
        },
      });
      const token = crypto.randomBytes(18).toString('base64url');
      const createdAt = new Date().toISOString();
      const owner = String(req.user?.email || req.user?.username || req.user?.sub || '').trim();
      const asset = {
        id,
        token,
        createdAt,
        owner,
        originalName: req.file.originalname || '',
        inputFilename,
        outputFilename,
        contentType: outputFormat.contentType,
        method: processing.method,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'mk-log',
        resonance: processing.resonance || null,
        weights: processing.weights || null,
        dynamicSummary: processing.dynamic?.summary || null,
        safety: processing.safety || null,
        bytes: fs.statSync(outputPath).size,
      };
      const index = readIndex(indexPath);
      index.assets = [asset, ...index.assets].slice(0, 300);
      writeIndex(indexPath, index);

      const baseUrl = routePublicBase(req);
      const audioUrl = `/api/double-harmonic/out/${encodeURIComponent(outputFilename)}`;
      const sharePath = `${audioUrl}?token=${encodeURIComponent(token)}`;
      return res.json({
        ok: true,
        id,
        method: processing.method,
        state: processing.state,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'mk-log',
        d40: processing.d40,
        resonance: processing.resonance,
        dynamic: processing.dynamic,
        weights: processing.weights || undefined,
        safety: processing.safety || undefined,
        audioUrl,
        shareUrl: baseUrl ? `${baseUrl}${sharePath}` : sharePath,
        contentType: outputFormat.contentType,
        filename: outputFilename,
        bytes: asset.bytes,
        publicSummary: 'V6 Supreme: D40 stable, ratio haut/bas ln(3D/2D), transfert M/K, k=3 par defaut et resonance plafonnee a 1.',
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'double_harmonic_v6_process_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.post('/v7/process', verifyJWT, upload.single('audio'), async (req, res) => {
    try {
      pruneIndex(indexPath, assetRoot, ttlMs);
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: 'missing_audio', message: 'Ajoute un fichier audio.' });
      }

      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const base = safeBaseName(req.body?.name || req.file.originalname || 'audio');
      const inputExt = extForUpload(req.file);
      const inputFilename = `${id}-${base}-v7-input.${inputExt}`;
      const outputFormat = resolveOutputFormat(req.body?.format || req.query?.format, inputExt);
      const outputFilename = `${id}-${base}-funesterie-d40-v7.${outputFormat.ext}`;
      const inputPath = path.join(assetRoot, inputFilename);
      const outputPath = path.join(assetRoot, outputFilename);
      fs.writeFileSync(inputPath, req.file.buffer);

      const profile = String(req.body?.profile || req.query?.profile || 'blend').trim() || 'blend';
      const processing = await processAudioV7({
        inputPath,
        outputPath,
        profile,
        analysisOptions: {
          frameMs: reqNumber(req.body?.frameMs || req.query?.frameMs),
          maxSeconds: reqNumber(req.body?.maxSeconds || req.query?.maxSeconds),
          maxSegments: reqNumber(req.body?.maxSegments || req.query?.maxSegments),
          curve: req.body?.curve || req.query?.curve,
          curveAmount: reqNumber(req.body?.curveAmount || req.query?.curveAmount),
          attack: reqNumber(req.body?.attack || req.query?.attack),
          release: reqNumber(req.body?.release || req.query?.release),
          minDbSpan: reqNumber(req.body?.minDbSpan || req.query?.minDbSpan),
          cycleSeconds: reqNumber(req.body?.cycleSeconds || req.query?.cycleSeconds),
          userK: reqNumber(
            req.body?.userK
            || req.query?.userK
            || req.body?.resonanceK
            || req.query?.resonanceK
            || req.body?.weightScale
            || req.query?.weightScale
            || req.body?.intensity
            || req.query?.intensity
            || req.body?.harmonicIntensity
            || req.query?.harmonicIntensity
          ),
          kCeiling: reqNumber(req.body?.kCeiling || req.query?.kCeiling),
          minBricks: reqNumber(req.body?.minBricks || req.query?.minBricks),
          maxBricks: reqNumber(req.body?.maxBricks || req.query?.maxBricks),
          brickInfluence: reqNumber(req.body?.brickInfluence || req.query?.brickInfluence),
        },
      });
      const token = crypto.randomBytes(18).toString('base64url');
      const createdAt = new Date().toISOString();
      const owner = String(req.user?.email || req.user?.username || req.user?.sub || '').trim();
      const asset = {
        id,
        token,
        createdAt,
        owner,
        originalName: req.file.originalname || '',
        inputFilename,
        outputFilename,
        contentType: outputFormat.contentType,
        method: processing.method,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'bricks-adaptive',
        resonance: processing.resonance || null,
        bricks: processing.bricks || null,
        weights: processing.weights || null,
        dynamicSummary: processing.dynamic?.summary || null,
        safety: processing.safety || null,
        bytes: fs.statSync(outputPath).size,
      };
      const index = readIndex(indexPath);
      index.assets = [asset, ...index.assets].slice(0, 300);
      writeIndex(indexPath, index);

      const baseUrl = routePublicBase(req);
      const audioUrl = `/api/double-harmonic/out/${encodeURIComponent(outputFilename)}`;
      const sharePath = `${audioUrl}?token=${encodeURIComponent(token)}`;
      return res.json({
        ok: true,
        id,
        method: processing.method,
        state: processing.state,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'bricks-adaptive',
        d40: processing.d40,
        resonance: processing.resonance,
        bricks: processing.bricks,
        dynamic: processing.dynamic,
        weights: processing.weights || undefined,
        safety: processing.safety || undefined,
        audioUrl,
        shareUrl: baseUrl ? `${baseUrl}${sharePath}` : sharePath,
        contentType: outputFormat.contentType,
        filename: outputFilename,
        bytes: asset.bytes,
        publicSummary: 'V7 Briques: V6 Supreme reste intacte; les trous du signal recoivent plus de briques mg_phase adaptatives, sans changer mg_phase ni le format source.',
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'double_harmonic_v7_process_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.post('/v71/process', verifyJWT, upload.single('audio'), async (req, res) => {
    try {
      pruneIndex(indexPath, assetRoot, ttlMs);
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: 'missing_audio', message: 'Ajoute un fichier audio.' });
      }

      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const base = safeBaseName(req.body?.name || req.file.originalname || 'audio');
      const inputExt = extForUpload(req.file);
      const inputFilename = `${id}-${base}-v71-input.${inputExt}`;
      const outputFormat = resolveOutputFormat(req.body?.format || req.query?.format, inputExt);
      const outputFilename = `${id}-${base}-funesterie-d40-v71.${outputFormat.ext}`;
      const inputPath = path.join(assetRoot, inputFilename);
      const outputPath = path.join(assetRoot, outputFilename);
      fs.writeFileSync(inputPath, req.file.buffer);

      const profile = String(req.body?.profile || req.query?.profile || 'blend').trim() || 'blend';
      const processing = await processAudioV7({
        inputPath,
        outputPath,
        profile,
        analysisOptions: {
          frameMs: reqNumber(req.body?.frameMs || req.query?.frameMs),
          maxSeconds: reqNumber(req.body?.maxSeconds || req.query?.maxSeconds),
          maxSegments: reqNumber(req.body?.maxSegments || req.query?.maxSegments),
          curve: req.body?.curve || req.query?.curve,
          curveAmount: reqNumber(req.body?.curveAmount || req.query?.curveAmount),
          attack: reqNumber(req.body?.attack || req.query?.attack),
          release: reqNumber(req.body?.release || req.query?.release),
          minDbSpan: reqNumber(req.body?.minDbSpan || req.query?.minDbSpan),
          cycleSeconds: reqNumber(req.body?.cycleSeconds || req.query?.cycleSeconds),
          userK: reqNumber(
            req.body?.userK
            || req.query?.userK
            || req.body?.resonanceK
            || req.query?.resonanceK
            || req.body?.weightScale
            || req.query?.weightScale
            || req.body?.intensity
            || req.query?.intensity
            || req.body?.harmonicIntensity
            || req.query?.harmonicIntensity
          ),
          kCeiling: reqNumber(req.body?.kCeiling || req.query?.kCeiling),
          minBricks: reqNumber(req.body?.minBricks || req.query?.minBricks),
          maxBricks: reqNumber(req.body?.maxBricks || req.query?.maxBricks),
          brickInfluence: reqNumber(req.body?.brickInfluence || req.query?.brickInfluence),
          binaryGrid: req.body?.binaryGrid || req.query?.binaryGrid || 'exact1024',
        },
      });
      const token = crypto.randomBytes(18).toString('base64url');
      const createdAt = new Date().toISOString();
      const owner = String(req.user?.email || req.user?.username || req.user?.sub || '').trim();
      const asset = {
        id,
        token,
        createdAt,
        owner,
        originalName: req.file.originalname || '',
        inputFilename,
        outputFilename,
        contentType: outputFormat.contentType,
        method: processing.method,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'binary-bricks-adaptive',
        resonance: processing.resonance || null,
        bricks: processing.bricks || null,
        weights: processing.weights || null,
        dynamicSummary: processing.dynamic?.summary || null,
        safety: processing.safety || null,
        bytes: fs.statSync(outputPath).size,
      };
      const index = readIndex(indexPath);
      index.assets = [asset, ...index.assets].slice(0, 300);
      writeIndex(indexPath, index);

      const baseUrl = routePublicBase(req);
      const audioUrl = `/api/double-harmonic/out/${encodeURIComponent(outputFilename)}`;
      const sharePath = `${audioUrl}?token=${encodeURIComponent(token)}`;
      return res.json({
        ok: true,
        id,
        method: processing.method,
        state: processing.state,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'binary-bricks-adaptive',
        d40: processing.d40,
        resonance: processing.resonance,
        bricks: processing.bricks,
        dynamic: processing.dynamic,
        weights: processing.weights || undefined,
        safety: processing.safety || undefined,
        audioUrl,
        shareUrl: baseUrl ? `${baseUrl}${sharePath}` : sharePath,
        contentType: outputFormat.contentType,
        filename: outputFilename,
        bytes: asset.bytes,
        publicSummary: 'V7.1 1024: V7 Briques avec grille binaire interne pour placer les briques mg_phase, sans changer mg_phase ni V6 Supreme.',
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'double_harmonic_v71_process_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.post('/v8/process', verifyJWT, upload.single('audio'), async (req, res) => {
    try {
      pruneIndex(indexPath, assetRoot, ttlMs);
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: 'missing_audio', message: 'Ajoute un fichier audio.' });
      }

      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const base = safeBaseName(req.body?.name || req.file.originalname || 'audio');
      const inputExt = extForUpload(req.file);
      const inputFilename = `${id}-${base}-v8-input.${inputExt}`;
      const outputFormat = resolveOutputFormat(req.body?.format || req.query?.format, inputExt);
      const outputFilename = `${id}-${base}-funesterie-d40-v8.${outputFormat.ext}`;
      const inputPath = path.join(assetRoot, inputFilename);
      const outputPath = path.join(assetRoot, outputFilename);
      fs.writeFileSync(inputPath, req.file.buffer);

      const profile = String(req.body?.profile || req.query?.profile || 'blend').trim() || 'blend';
      const processing = await processAudioV8({
        inputPath,
        outputPath,
        profile,
        analysisOptions: {
          frameMs: reqNumber(req.body?.frameMs || req.query?.frameMs),
          maxSeconds: reqNumber(req.body?.maxSeconds || req.query?.maxSeconds),
          maxSegments: reqNumber(req.body?.maxSegments || req.query?.maxSegments),
          curve: req.body?.curve || req.query?.curve,
          curveAmount: reqNumber(req.body?.curveAmount || req.query?.curveAmount),
          attack: reqNumber(req.body?.attack || req.query?.attack),
          release: reqNumber(req.body?.release || req.query?.release),
          minDbSpan: reqNumber(req.body?.minDbSpan || req.query?.minDbSpan),
          cycleSeconds: reqNumber(req.body?.cycleSeconds || req.query?.cycleSeconds),
          userK: reqNumber(
            req.body?.userK
            || req.query?.userK
            || req.body?.resonanceK
            || req.query?.resonanceK
            || req.body?.weightScale
            || req.query?.weightScale
            || req.body?.intensity
            || req.query?.intensity
            || req.body?.harmonicIntensity
            || req.query?.harmonicIntensity
          ),
          kCeiling: reqNumber(req.body?.kCeiling || req.query?.kCeiling),
          phaseSlots: reqNumber(req.body?.phaseSlots || req.query?.phaseSlots || req.body?.binaryGridSlots || req.query?.binaryGridSlots),
          c7PhaseScale: reqNumber(req.body?.c7PhaseScale || req.query?.c7PhaseScale),
          modulation: req.body?.modulation || req.query?.modulation || req.body?.modulationMode || req.query?.modulationMode,
          electrolysis: reqBoolean(req.body?.electrolysis || req.query?.electrolysis || req.body?.electrolysisGuitar || req.query?.electrolysisGuitar),
          frequencyHz: reqNumber(req.body?.frequencyHz || req.query?.frequencyHz || req.body?.modulationFrequencyHz || req.query?.modulationFrequencyHz || req.body?.electrolysisHz || req.query?.electrolysisHz || req.body?.waterFrequencyHz || req.query?.waterFrequencyHz),
          frequencyMinHz: reqNumber(req.body?.frequencyMinHz || req.query?.frequencyMinHz || req.body?.minFrequencyHz || req.query?.minFrequencyHz || req.body?.frequencyLowHz || req.query?.frequencyLowHz || req.body?.electrolysisMinHz || req.query?.electrolysisMinHz || req.body?.waterMinHz || req.query?.waterMinHz),
          frequencyMaxHz: reqNumber(req.body?.frequencyMaxHz || req.query?.frequencyMaxHz || req.body?.maxFrequencyHz || req.query?.maxFrequencyHz || req.body?.frequencyHighHz || req.query?.frequencyHighHz || req.body?.electrolysisMaxHz || req.query?.electrolysisMaxHz || req.body?.waterMaxHz || req.query?.waterMaxHz),
          amount: reqNumber(req.body?.amount || req.query?.amount || req.body?.modulationAmount || req.query?.modulationAmount),
          irregularity: reqNumber(req.body?.irregularity || req.query?.irregularity),
          asymmetry: reqNumber(req.body?.asymmetry || req.query?.asymmetry),
          bidirectional: reqBoolean(req.body?.bidirectional || req.query?.bidirectional),
          followForce: reqNumber(req.body?.followForce || req.query?.followForce),
          schemaMix: reqNumber(req.body?.schemaMix || req.query?.schemaMix),
        },
      });
      const token = crypto.randomBytes(18).toString('base64url');
      const createdAt = new Date().toISOString();
      const owner = String(req.user?.email || req.user?.username || req.user?.sub || '').trim();
      const asset = {
        id,
        token,
        createdAt,
        owner,
        originalName: req.file.originalname || '',
        inputFilename,
        outputFilename,
        contentType: outputFormat.contentType,
        method: processing.method,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'closed-phase-1024',
        variant: processing.variant || 'v8',
        resonance: processing.resonance || null,
        operators: processing.operators || null,
        projection: processing.projection || null,
        grain: processing.grain || null,
        binaryGrid: processing.binaryGrid || null,
        phaseClosure: processing.phaseClosure || null,
        weights: processing.weights || null,
        dynamicSummary: processing.dynamic?.summary || null,
        modulation: processing.dynamic?.modulation || null,
        safety: processing.safety || null,
        bytes: fs.statSync(outputPath).size,
      };
      const index = readIndex(indexPath);
      index.assets = [asset, ...index.assets].slice(0, 300);
      writeIndex(indexPath, index);

      const baseUrl = routePublicBase(req);
      const audioUrl = `/api/double-harmonic/out/${encodeURIComponent(outputFilename)}`;
      const sharePath = `${audioUrl}?token=${encodeURIComponent(token)}`;
      return res.json({
        ok: true,
        id,
        method: processing.method,
        state: processing.state,
        variant: processing.variant || 'v8',
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'closed-phase-1024',
        d40: processing.d40,
        resonance: processing.resonance,
        operators: processing.operators,
        projection: processing.projection,
        grain: processing.grain,
        binaryGrid: processing.binaryGrid,
        phaseClosure: processing.phaseClosure,
        dynamic: processing.dynamic,
        weights: processing.weights || undefined,
        safety: processing.safety || undefined,
        audioUrl,
        shareUrl: baseUrl ? `${baseUrl}${sharePath}` : sharePath,
        contentType: outputFormat.contentType,
        filename: outputFilename,
        bytes: asset.bytes,
        publicSummary: 'V8 Fermeture: V6 Supreme conservee, mg_phase applique en increments recentres sur grille 1024, c7 projete sans changer le gain.',
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'double_harmonic_v8_process_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.post('/v8plus/process', verifyJWT, upload.single('audio'), async (req, res) => {
    try {
      pruneIndex(indexPath, assetRoot, ttlMs);
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: 'missing_audio', message: 'Ajoute un fichier audio.' });
      }

      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const base = safeBaseName(req.body?.name || req.file.originalname || 'audio');
      const inputExt = extForUpload(req.file);
      const inputFilename = `${id}-${base}-v8plus-input.${inputExt}`;
      const outputFormat = resolveOutputFormat(req.body?.format || req.query?.format, inputExt);
      const outputFilename = `${id}-${base}-funesterie-d40-v8plus.${outputFormat.ext}`;
      const inputPath = path.join(assetRoot, inputFilename);
      const outputPath = path.join(assetRoot, outputFilename);
      fs.writeFileSync(inputPath, req.file.buffer);

      const profile = String(req.body?.profile || req.query?.profile || 'blend').trim() || 'blend';
      const processing = await processAudioV8Plus({
        inputPath,
        outputPath,
        profile,
        analysisOptions: {
          frameMs: reqNumber(req.body?.frameMs || req.query?.frameMs),
          maxSeconds: reqNumber(req.body?.maxSeconds || req.query?.maxSeconds),
          maxSegments: reqNumber(req.body?.maxSegments || req.query?.maxSegments),
          curve: req.body?.curve || req.query?.curve,
          curveAmount: reqNumber(req.body?.curveAmount || req.query?.curveAmount),
          attack: reqNumber(req.body?.attack || req.query?.attack),
          release: reqNumber(req.body?.release || req.query?.release),
          minDbSpan: reqNumber(req.body?.minDbSpan || req.query?.minDbSpan),
          cycleSeconds: reqNumber(req.body?.cycleSeconds || req.query?.cycleSeconds),
          userK: reqNumber(
            req.body?.userK
            || req.query?.userK
            || req.body?.resonanceK
            || req.query?.resonanceK
            || req.body?.weightScale
            || req.query?.weightScale
            || req.body?.intensity
            || req.query?.intensity
            || req.body?.harmonicIntensity
            || req.query?.harmonicIntensity
          ),
          kCeiling: reqNumber(req.body?.kCeiling || req.query?.kCeiling),
          phaseSlots: reqNumber(req.body?.phaseSlots || req.query?.phaseSlots || req.body?.binaryGridSlots || req.query?.binaryGridSlots),
          c7PhaseScale: reqNumber(req.body?.c7PhaseScale || req.query?.c7PhaseScale),
        },
      });
      const token = crypto.randomBytes(18).toString('base64url');
      const createdAt = new Date().toISOString();
      const owner = String(req.user?.email || req.user?.username || req.user?.sub || '').trim();
      const asset = {
        id,
        token,
        createdAt,
        owner,
        originalName: req.file.originalname || '',
        inputFilename,
        outputFilename,
        contentType: outputFormat.contentType,
        method: processing.method,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'e2-grain-closed-phase-1024',
        variant: processing.variant || 'v8plus',
        resonance: processing.resonance || null,
        operators: processing.operators || null,
        projection: processing.projection || null,
        grain: processing.grain || null,
        binaryGrid: processing.binaryGrid || null,
        phaseClosure: processing.phaseClosure || null,
        weights: processing.weights || null,
        dynamicSummary: processing.dynamic?.summary || null,
        modulation: processing.dynamic?.modulation || null,
        safety: processing.safety || null,
        bytes: fs.statSync(outputPath).size,
      };
      const index = readIndex(indexPath);
      index.assets = [asset, ...index.assets].slice(0, 300);
      writeIndex(indexPath, index);

      const baseUrl = routePublicBase(req);
      const audioUrl = `/api/double-harmonic/out/${encodeURIComponent(outputFilename)}`;
      const sharePath = `${audioUrl}?token=${encodeURIComponent(token)}`;
      return res.json({
        ok: true,
        id,
        method: processing.method,
        state: processing.state,
        variant: processing.variant,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'e2-grain-closed-phase-1024',
        d40: processing.d40,
        resonance: processing.resonance,
        operators: processing.operators,
        projection: processing.projection,
        grain: processing.grain,
        binaryGrid: processing.binaryGrid,
        phaseClosure: processing.phaseClosure,
        dynamic: processing.dynamic,
        weights: processing.weights || undefined,
        safety: processing.safety || undefined,
        audioUrl,
        shareUrl: baseUrl ? `${baseUrl}${sharePath}` : sharePath,
        contentType: outputFormat.contentType,
        filename: outputFilename,
        bytes: asset.bytes,
        publicSummary: 'V8 Plus: test e2 parallele a V8, produit grainLow*grainHigh=1/2, fermeture 1024 et mg_phase recentre conserves.',
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'double_harmonic_v8plus_process_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.post('/v8pivot/process', verifyJWT, upload.single('audio'), async (req, res) => {
    try {
      pruneIndex(indexPath, assetRoot, ttlMs);
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: 'missing_audio', message: 'Ajoute un fichier audio.' });
      }

      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const base = safeBaseName(req.body?.name || req.file.originalname || 'audio');
      const inputExt = extForUpload(req.file);
      const inputFilename = `${id}-${base}-v8pivot-input.${inputExt}`;
      const outputFormat = resolveOutputFormat(req.body?.format || req.query?.format, inputExt);
      const outputFilename = `${id}-${base}-funesterie-d40-v8pivot.${outputFormat.ext}`;
      const inputPath = path.join(assetRoot, inputFilename);
      const outputPath = path.join(assetRoot, outputFilename);
      fs.writeFileSync(inputPath, req.file.buffer);

      const profile = String(req.body?.profile || req.query?.profile || 'blend').trim() || 'blend';
      const processing = await processAudioV8Pivot({
        inputPath,
        outputPath,
        profile,
        analysisOptions: {
          frameMs: reqNumber(req.body?.frameMs || req.query?.frameMs),
          maxSeconds: reqNumber(req.body?.maxSeconds || req.query?.maxSeconds),
          maxSegments: reqNumber(req.body?.maxSegments || req.query?.maxSegments),
          curve: req.body?.curve || req.query?.curve,
          curveAmount: reqNumber(req.body?.curveAmount || req.query?.curveAmount),
          attack: reqNumber(req.body?.attack || req.query?.attack),
          release: reqNumber(req.body?.release || req.query?.release),
          minDbSpan: reqNumber(req.body?.minDbSpan || req.query?.minDbSpan),
          cycleSeconds: reqNumber(req.body?.cycleSeconds || req.query?.cycleSeconds),
          userK: reqNumber(
            req.body?.userK
            || req.query?.userK
            || req.body?.resonanceK
            || req.query?.resonanceK
            || req.body?.weightScale
            || req.query?.weightScale
            || req.body?.intensity
            || req.query?.intensity
            || req.body?.harmonicIntensity
            || req.query?.harmonicIntensity
          ),
          kCeiling: reqNumber(req.body?.kCeiling || req.query?.kCeiling),
          phaseSlots: reqNumber(req.body?.phaseSlots || req.query?.phaseSlots || req.body?.binaryGridSlots || req.query?.binaryGridSlots),
          c7PhaseScale: reqNumber(req.body?.c7PhaseScale || req.query?.c7PhaseScale),
        },
      });
      const token = crypto.randomBytes(18).toString('base64url');
      const createdAt = new Date().toISOString();
      const owner = String(req.user?.email || req.user?.username || req.user?.sub || '').trim();
      const asset = {
        id,
        token,
        createdAt,
        owner,
        originalName: req.file.originalname || '',
        inputFilename,
        outputFilename,
        contentType: outputFormat.contentType,
        method: processing.method,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'pivot-1024-closed-phase',
        variant: processing.variant || 'v8pivot',
        resonance: processing.resonance || null,
        operators: processing.operators || null,
        projection: processing.projection || null,
        grain: processing.grain || null,
        binaryGrid: processing.binaryGrid || null,
        phaseClosure: processing.phaseClosure || null,
        weights: processing.weights || null,
        dynamicSummary: processing.dynamic?.summary || null,
        safety: processing.safety || null,
        bytes: fs.statSync(outputPath).size,
      };
      const index = readIndex(indexPath);
      index.assets = [asset, ...index.assets].slice(0, 300);
      writeIndex(indexPath, index);

      const baseUrl = routePublicBase(req);
      const audioUrl = `/api/double-harmonic/out/${encodeURIComponent(outputFilename)}`;
      const sharePath = `${audioUrl}?token=${encodeURIComponent(token)}`;
      return res.json({
        ok: true,
        id,
        method: processing.method,
        state: processing.state,
        variant: processing.variant,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'pivot-1024-closed-phase',
        d40: processing.d40,
        resonance: processing.resonance,
        operators: processing.operators,
        projection: processing.projection,
        grain: processing.grain,
        binaryGrid: processing.binaryGrid,
        phaseClosure: processing.phaseClosure,
        dynamic: processing.dynamic,
        weights: processing.weights || undefined,
        safety: processing.safety || undefined,
        audioUrl,
        shareUrl: baseUrl ? `${baseUrl}${sharePath}` : sharePath,
        contentType: outputFormat.contentType,
        filename: outputFilename,
        bytes: asset.bytes,
        publicSummary: 'V8 Pivot: version validee, fermeture 1024 exacte et pivot 0.292 exact avec mg_phase recentre conserve.',
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'double_harmonic_v8pivot_process_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.post(['/v9turbo/process', '/v9electrolysis/process'], verifyJWT, upload.single('audio'), async (req, res) => {
    try {
      pruneIndex(indexPath, assetRoot, ttlMs);
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: 'missing_audio', message: 'Ajoute un fichier audio.' });
      }

      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const base = safeBaseName(req.body?.name || req.file.originalname || 'audio');
      const requestedElectrolysis = /\/v9electrolysis\/process$/i.test(req.path)
        || reqBoolean(req.body?.electrolysis || req.query?.electrolysis)
        || reqBoolean(req.body?.electrolysisGuitar || req.query?.electrolysisGuitar)
        || String(req.body?.modulation || req.query?.modulation || req.body?.modulationMode || req.query?.modulationMode || '').toLowerCase() === 'electrolysis-guitar';
      const publicVariant = requestedElectrolysis ? 'v9electrolysis' : 'v9turbo';
      const inputExt = extForUpload(req.file);
      const inputFilename = `${id}-${base}-${publicVariant}-input.${inputExt}`;
      const outputFormat = resolveOutputFormat(req.body?.format || req.query?.format, inputExt);
      const outputFilename = `${id}-${base}-funesterie-d40-${publicVariant}.${outputFormat.ext}`;
      const inputPath = path.join(assetRoot, inputFilename);
      const outputPath = path.join(assetRoot, outputFilename);
      fs.writeFileSync(inputPath, req.file.buffer);

      const profile = String(req.body?.profile || req.query?.profile || 'blend').trim() || 'blend';
      const requestedAmount = reqNumber(req.body?.amount || req.query?.amount || req.body?.modulationAmount || req.query?.modulationAmount);
      const requestedIrregularity = reqNumber(req.body?.irregularity || req.query?.irregularity);
      const requestedAsymmetry = reqNumber(req.body?.asymmetry || req.query?.asymmetry);
      const requestedLegacyHotElectrolysis = requestedElectrolysis
        && Math.abs((requestedAmount ?? 0) - 0.05) < 1e-9
        && Math.abs((requestedIrregularity ?? 0) - 0.5) < 1e-9
        && Math.abs((requestedAsymmetry ?? 0) - 0.3) < 1e-9
        && !reqBoolean(req.body?.allowLegacyElectrolysisHot || req.query?.allowLegacyElectrolysisHot);
      const processing = await processAudioV9Turbo({
        inputPath,
        outputPath,
        profile,
        analysisOptions: {
          frameMs: DEFAULT_V9_TURBO_FRAME_MS,
          maxSeconds: reqNumber(req.body?.maxSeconds || req.query?.maxSeconds),
          cycleSeconds: reqNumber(req.body?.cycleSeconds || req.query?.cycleSeconds),
          userK: reqNumber(
            req.body?.userK
            || req.query?.userK
            || req.body?.resonanceK
            || req.query?.resonanceK
            || req.body?.weightScale
            || req.query?.weightScale
            || req.body?.intensity
            || req.query?.intensity
            || req.body?.harmonicIntensity
            || req.query?.harmonicIntensity
          ),
          kCeiling: reqNumber(req.body?.kCeiling || req.query?.kCeiling),
          phaseSlots: reqNumber(req.body?.phaseSlots || req.query?.phaseSlots || req.body?.binaryGridSlots || req.query?.binaryGridSlots),
          c7PhaseScale: reqNumber(req.body?.c7PhaseScale || req.query?.c7PhaseScale),
          modulation: req.body?.modulation || req.query?.modulation || req.body?.modulationMode || req.query?.modulationMode || (requestedElectrolysis ? 'electrolysis-guitar' : undefined),
          modulationMode: req.body?.modulationMode || req.query?.modulationMode || (requestedElectrolysis ? 'electrolysis-guitar' : undefined),
          electrolysis: requestedElectrolysis || reqBoolean(req.body?.electrolysis || req.query?.electrolysis),
          electrolysisGuitar: requestedElectrolysis || reqBoolean(req.body?.electrolysisGuitar || req.query?.electrolysisGuitar),
          frequencyHz: reqNumber(req.body?.frequencyHz || req.query?.frequencyHz || req.body?.modulationFrequencyHz || req.query?.modulationFrequencyHz || req.body?.electrolysisHz || req.query?.electrolysisHz || req.body?.waterFrequencyHz || req.query?.waterFrequencyHz) ?? (requestedElectrolysis ? 40.4583333333333 : undefined),
          frequencyMinHz: reqNumber(req.body?.frequencyMinHz || req.query?.frequencyMinHz || req.body?.minFrequencyHz || req.query?.minFrequencyHz || req.body?.frequencyLowHz || req.query?.frequencyLowHz || req.body?.electrolysisMinHz || req.query?.electrolysisMinHz || req.body?.waterMinHz || req.query?.waterMinHz) ?? (requestedElectrolysis ? 40.25 : undefined),
          frequencyMaxHz: reqNumber(req.body?.frequencyMaxHz || req.query?.frequencyMaxHz || req.body?.maxFrequencyHz || req.query?.maxFrequencyHz || req.body?.frequencyHighHz || req.query?.frequencyHighHz || req.body?.electrolysisMaxHz || req.query?.electrolysisMaxHz || req.body?.waterMaxHz || req.query?.waterMaxHz) ?? (requestedElectrolysis ? 40.6666666666666 : undefined),
          amount: requestedLegacyHotElectrolysis ? 0.042 : (requestedAmount ?? (requestedElectrolysis ? 0.042 : undefined)),
          modulationAmount: reqNumber(req.body?.modulationAmount || req.query?.modulationAmount),
          irregularity: requestedLegacyHotElectrolysis ? 0.36 : (requestedIrregularity ?? (requestedElectrolysis ? 0.36 : undefined)),
          asymmetry: requestedLegacyHotElectrolysis ? 0.27 : (requestedAsymmetry ?? (requestedElectrolysis ? 0.27 : undefined)),
          bidirectional: requestedElectrolysis ? true : reqBoolean(req.body?.bidirectional || req.query?.bidirectional),
          followForce: reqNumber(req.body?.followForce || req.query?.followForce),
          schemaMix: reqNumber(req.body?.schemaMix || req.query?.schemaMix),
        },
      });
      const token = crypto.randomBytes(18).toString('base64url');
      const createdAt = new Date().toISOString();
      const owner = String(req.user?.email || req.user?.username || req.user?.sub || '').trim();
      const asset = {
        id,
        token,
        createdAt,
        owner,
        originalName: req.file.originalname || '',
        inputFilename,
        outputFilename,
        contentType: outputFormat.contentType,
        method: processing.method,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'vocal-safe-99ms-turbo-1024',
        variant: publicVariant,
        resonance: processing.resonance || null,
        operators: processing.operators || null,
        projection: processing.projection || null,
        grain: processing.grain || null,
        binaryGrid: processing.binaryGrid || null,
        phaseClosure: processing.phaseClosure || null,
        weights: processing.weights || null,
        dynamicSummary: processing.dynamic?.summary || null,
        safety: processing.safety || null,
        bytes: fs.statSync(outputPath).size,
      };
      const index = readIndex(indexPath);
      index.assets = [asset, ...index.assets].slice(0, 300);
      writeIndex(indexPath, index);

      const baseUrl = routePublicBase(req);
      const audioUrl = `/api/double-harmonic/out/${encodeURIComponent(outputFilename)}`;
      const sharePath = `${audioUrl}?token=${encodeURIComponent(token)}`;
      return res.json({
        ok: true,
        id,
        method: processing.method,
        state: processing.state,
        variant: publicVariant,
        profile: processing.profile,
        preset: processing.preset,
        intensity: processing.intensity || 'vocal-safe-99ms-turbo-1024',
        d40: processing.d40,
        resonance: processing.resonance,
        operators: processing.operators,
        projection: processing.projection,
        grain: processing.grain,
        binaryGrid: processing.binaryGrid,
        phaseClosure: processing.phaseClosure,
        dynamic: processing.dynamic,
        weights: processing.weights || undefined,
        safety: processing.safety || undefined,
        audioUrl,
        shareUrl: baseUrl ? `${baseUrl}${sharePath}` : sharePath,
        contentType: outputFormat.contentType,
        filename: outputFilename,
        bytes: asset.bytes,
        publicSummary: requestedElectrolysis || processing.dynamic?.modulation?.enabled
          ? 'V9 Électrolyse: V8 Pivot conserve, micro-modulation asymétrique/irrégulière audio-only 40.25-40.6666666666666 Hz sur les enveloppes haut/bas.'
          : 'V9 Turbo: V8 Pivot valide, poids haut/bas dynamiques vocal-safe a 99 ms, fermeture 1024 et mg_phase recentre conserves.',
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'double_harmonic_v9turbo_process_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.post('/process', verifyJWT, upload.single('audio'), async (req, res) => {
    try {
      pruneIndex(indexPath, assetRoot, ttlMs);
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ ok: false, error: 'missing_audio', message: 'Ajoute un fichier audio.' });
      }

      const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const base = safeBaseName(req.body?.name || req.file.originalname || 'audio');
      const inputExt = extForUpload(req.file);
      const inputFilename = `${id}-${base}.${inputExt}`;
      const outputFormat = resolveOutputFormat(req.body?.format || req.query?.format, inputExt);
      const outputFilename = `${id}-${base}-funesterie-d40.${outputFormat.ext}`;
      const inputPath = path.join(assetRoot, inputFilename);
      const outputPath = path.join(assetRoot, outputFilename);
      fs.writeFileSync(inputPath, req.file.buffer);

      const profile = String(req.body?.profile || req.query?.profile || 'blend').trim() || 'blend';
      const intensity = resolveHarmonicIntensity(req.body?.intensity || req.query?.intensity);
      const processing = await processAudio({ inputPath, outputPath, profile, intensity });
      const token = crypto.randomBytes(18).toString('base64url');
      const createdAt = new Date().toISOString();
      const owner = String(req.user?.email || req.user?.username || req.user?.sub || '').trim();
      const asset = {
        id,
        token,
        createdAt,
        owner,
        originalName: req.file.originalname || '',
        inputFilename,
        outputFilename,
        contentType: outputFormat.contentType,
        method: processing.method,
        profile: processing.profile,
        intensity: processing.intensity || intensity,
        weights: processing.weights || null,
        bytes: fs.statSync(outputPath).size,
      };
      const index = readIndex(indexPath);
      index.assets = [asset, ...index.assets].slice(0, 300);
      writeIndex(indexPath, index);

      const baseUrl = routePublicBase(req);
      const audioUrl = `/api/double-harmonic/out/${encodeURIComponent(outputFilename)}`;
      const sharePath = `${audioUrl}?token=${encodeURIComponent(token)}`;
      return res.json({
        ok: true,
        id,
        method: processing.method,
        profile: processing.profile,
        intensity: processing.intensity || intensity,
        weights: processing.weights || undefined,
        audioUrl,
        shareUrl: baseUrl ? `${baseUrl}${sharePath}` : sharePath,
        contentType: outputFormat.contentType,
        filename: outputFilename,
        bytes: asset.bytes,
        publicSummary: 'Densite D40 + mg + double harmonique synchronisee en overlay protege.',
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: 'double_harmonic_process_failed',
        message: String(error?.message || error),
      });
    }
  });

  router.get('/out/:filename', (req, res, next) => {
    try {
      pruneIndex(indexPath, assetRoot, ttlMs);
      const filename = path.basename(String(req.params.filename || ''));
      if (!/^[\w.-]+\.(?:mp3|m4a|wav|flac|ogg)$/i.test(filename)) {
        return res.status(400).json({ ok: false, error: 'invalid_audio_asset' });
      }
      const index = readIndex(indexPath);
      const asset = index.assets.find((item) => item.outputFilename === filename);
      const token = String(req.query?.token || '').trim();
      if (!asset) return res.status(404).json({ ok: false, error: 'audio_asset_not_found' });

      const sendAsset = () => {
        const filePath = path.join(assetRoot, filename);
        if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'audio_asset_not_found' });
        res.setHeader('Content-Type', contentTypeForFile(filename));
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        return res.sendFile(filePath);
      };

      if (token && asset.token === token) return sendAsset();
      return verifyJWT(req, res, () => sendAsset());
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'audio_asset_failed', message: String(error?.message || error) });
    }
  });

  router.use(['/process', '/v2/analyze', '/v2/process', '/v3/process', '/v4/process', '/v5/process', '/v6/process', '/v7/process', '/v71/process', '/v8/process', '/v8plus/process', '/v8pivot/process', '/v9turbo/process', '/v9electrolysis/process'], (err, _req, res, _next) => {
    return res.status(400).json({
      ok: false,
      error: 'double_harmonic_upload_failed',
      message: String(err?.message || err || 'Upload audio impossible.'),
    });
  });

  return router;
}

module.exports = createDoubleHarmonicRouter;
