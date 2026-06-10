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

const DEFAULT_MAX_MB = 80;
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_OUTPUT_FORMAT = 'source';

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
  if (ext === 'wave') return 'wav';
  if (ext === 'aac' || ext === 'mp4' || ext === 'mov' || ext === 'webm') return 'm4a';
  if (Object.prototype.hasOwnProperty.call(OUTPUT_FORMATS, ext)) return ext;
  return 'mp3';
}

function resolveOutputFormat(value, sourceExt = '') {
  const requested = String(value || process.env.A11_DH_OUTPUT_FORMAT || DEFAULT_OUTPUT_FORMAT)
    .trim()
    .toLowerCase()
    .replace(/^\./, '');
  const key = !requested || requested === 'source'
    ? normalizeOutputSourceExt(sourceExt)
    : normalizeOutputSourceExt(requested);
  return OUTPUT_FORMATS[key] || OUTPUT_FORMATS.mp3;
}

function isAllowedUpload(file = {}) {
  const mime = String(file.mimetype || '').toLowerCase();
  const ext = String(file.originalname || '').split('.').pop().toLowerCase();
  return ALLOWED_MIME.has(mime) || ALLOWED_EXT.has(ext);
}

function routePublicBase(req) {
  const configured = String(process.env.A11_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
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

  router.use(['/process', '/v2/analyze', '/v2/process'], (err, _req, res, _next) => {
    return res.status(400).json({
      ok: false,
      error: 'double_harmonic_upload_failed',
      message: String(err?.message || err || 'Upload audio impossible.'),
    });
  });

  return router;
}

module.exports = createDoubleHarmonicRouter;
