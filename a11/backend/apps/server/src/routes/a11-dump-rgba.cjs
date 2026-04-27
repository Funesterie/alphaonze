'use strict';
/**
 * Route A11 Dump RGBA Brotli — /api/dump/rgba-brotli
 *
 * POST /api/dump/rgba-brotli         — encoder des données en PNG RGBA Brotli
 * POST /api/dump/rgba-brotli/decode  — décoder un PNG RGBA Brotli (upload)
 * GET  /api/dump/rgba-brotli/verify/:filename — vérifier un dump dans le runtime
 */

const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  encodeDumpToRgbaPng,
  decodeDumpFromRgbaPng,
  verifyDump,
} = require('../dump/a11-dump-rgba-brotli.cjs');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
  fileFilter(_req, file, cb) {
    if (file.mimetype === 'image/png' || file.originalname.endsWith('.png')) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PNG sont acceptés'));
    }
  },
});

function getDumpDir(runtimeRoot) {
  const root = runtimeRoot
    || process.env.A11_RUNTIME_ROOT
    || path.resolve(__dirname, '..', '..', '..', '..', '..', 'runtime');
  const dir = path.join(root, 'dumps');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createDumpRouter({ runtimeRoot } = {}) {
  const router = express.Router();

  // ── POST /api/dump/rgba-brotli ────────────────────────────────────────────
  router.post('/', express.json({ limit: '10mb' }), async (req, res) => {
    try {
      const { data, source, conversationId, userId, tags, contentType, brotliQuality } = req.body || {};

      if (!data) {
        return res.status(400).json({ ok: false, error: 'missing_data', message: 'Champ "data" requis.' });
      }

      const dumpDir = getDumpDir(runtimeRoot);
      const filename = `a11dump_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.dump.png`;
      const outPath = path.join(dumpDir, filename);

      const result = await encodeDumpToRgbaPng(data, outPath, {
        source: source || 'api',
        conversationId: conversationId || req.user?.conversationId,
        userId: userId || req.user?.id,
        tags: tags || ['a11', 'api'],
        contentType: contentType || 'application/json',
        brotliQuality: brotliQuality,
      });

      return res.json({
        ok: true,
        filename,
        pngPath: path.relative(getDumpDir(runtimeRoot), result.pngPath),
        manifestPath: path.basename(result.manifestPath),
        sha256Raw: result.sha256Raw,
        sha256Payload: result.sha256Payload,
        width: result.width,
        height: result.height,
        totalPixels: result.totalPixels,
        source: result.jsonHeader.source,
        tags: result.jsonHeader.tags,
        createdAt: result.jsonHeader.createdAt,
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'encode_failed', message: err.message });
    }
  });

  // ── POST /api/dump/rgba-brotli/decode ─────────────────────────────────────
  router.post('/decode', upload.single('png'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: 'missing_file', message: 'Envoie un fichier PNG en champ "png".' });
      }

      // Écrire dans un fichier temporaire pour sharp
      const tmpPath = path.join(os.tmpdir(), `a11dump_decode_${Date.now()}.png`);
      fs.writeFileSync(tmpPath, req.file.buffer);

      try {
        const result = await decodeDumpFromRgbaPng(tmpPath, { verify: true });
        return res.json({
          ok: true,
          content: result.content,
          jsonHeader: result.jsonHeader,
          sha256Raw: result.sha256Raw,
          verified: result.verified,
        });
      } finally {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'decode_failed', message: err.message });
    }
  });

  // ── GET /api/dump/rgba-brotli/verify/:filename ────────────────────────────
  router.get('/verify/:filename', async (req, res) => {
    try {
      const filename = path.basename(req.params.filename || '');
      if (!filename || !filename.endsWith('.png')) {
        return res.status(400).json({ ok: false, error: 'invalid_filename' });
      }

      const dumpDir = getDumpDir(runtimeRoot);
      const pngPath = path.join(dumpDir, filename);

      if (!fs.existsSync(pngPath)) {
        return res.status(404).json({ ok: false, error: 'not_found', message: `Dump introuvable : ${filename}` });
      }

      const result = await verifyDump(pngPath);
      return res.json({ ok: result.ok, filename, ...result });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'verify_failed', message: err.message });
    }
  });

  // ── GET /api/dump/rgba-brotli/list ────────────────────────────────────────
  router.get('/list', (req, res) => {
    try {
      const dumpDir = getDumpDir(runtimeRoot);
      const files = fs.readdirSync(dumpDir)
        .filter(f => f.endsWith('.dump.png'))
        .map(f => {
          const manifestPath = path.join(dumpDir, `${f}.dump.json`);
          let manifest = null;
          try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) {}
          const stat = fs.statSync(path.join(dumpDir, f));
          return { filename: f, size: stat.size, mtime: stat.mtime.toISOString(), manifest };
        })
        .sort((a, b) => b.mtime.localeCompare(a.mtime));

      return res.json({ ok: true, dumps: files, total: files.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'list_failed', message: err.message });
    }
  });

  return router;
}

module.exports = createDumpRouter;
