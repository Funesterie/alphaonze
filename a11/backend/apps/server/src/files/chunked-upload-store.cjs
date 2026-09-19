'use strict';

// Envoi de gros fichiers en morceaux.
//
// Cloudflare refuse toute requete de plus de 100 Mo (413), et la page envoyait
// les fichiers en base64 dans du JSON (+33 %) : une video d'iPhone de ~75 Mo ne
// passait deja plus (Vivy, 19/09/2026). La page decoupe maintenant en morceaux de
// 16 Mo, le serveur les colle ici, puis /api/files/upload reprend le fichier
// assemble comme n'importe quel envoi.
//
// Les morceaux vivent dans le runtime PARTAGE (monte par toutes les couleurs) :
// si Caddy bascule d'un backend a l'autre en plein envoi, rien n'est perdu.

const fs = require('node:fs');
const path = require('node:path');

const UPLOAD_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

function httpError(code, status, extra = {}) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function createChunkedUploadStore({ root, maxBytes }) {
  const baseDir = path.join(root, 'tmp', 'chunked-uploads');

  function filePath(userId, uploadId) {
    if (!UPLOAD_ID_PATTERN.test(String(uploadId || ''))) throw httpError('invalid_upload_id', 400);
    const safeUser = String(userId || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
    if (!safeUser) throw httpError('missing_user', 401);
    return path.join(baseDir, safeUser, `${uploadId}.part`);
  }

  function sweepStale(now = Date.now()) {
    let users = [];
    try { users = fs.readdirSync(baseDir); } catch { return; }
    for (const user of users) {
      const dir = path.join(baseDir, user);
      let files = [];
      try { files = fs.readdirSync(dir); } catch { continue; }
      for (const name of files) {
        const full = path.join(dir, name);
        try {
          if (now - fs.statSync(full).mtimeMs > STALE_AFTER_MS) fs.rmSync(full, { force: true });
        } catch { /* un autre backend l'a deja retire */ }
      }
    }
  }

  // offset = taille deja recue selon la page. Un morceau renvoye apres une coupure
  // reseau (offset deja couvert) est accepte sans etre recolle : la reprise est sure.
  function appendChunk({ userId, uploadId, offset, buffer }) {
    const target = filePath(userId, uploadId);
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw httpError('empty_chunk', 400);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    let current = 0;
    try { current = fs.statSync(target).size; } catch { current = 0; }
    if (current === 0 && Number(offset) === 0) sweepStale();
    const start = Number(offset);
    if (!Number.isFinite(start) || start < 0) throw httpError('invalid_offset', 400);
    if (start + buffer.length <= current) return { received: current, duplicate: true };
    if (start !== current) throw httpError('offset_mismatch', 409, { received: current });
    if (current + buffer.length > maxBytes) {
      fs.rmSync(target, { force: true });
      throw httpError('file_too_large', 413, { maxBytes });
    }
    fs.appendFileSync(target, buffer);
    return { received: current + buffer.length, duplicate: false };
  }

  // Lit le fichier assemble et le retire : un identifiant ne sert qu'une fois.
  function takeAssembled({ userId, uploadId, expectedBytes }) {
    const target = filePath(userId, uploadId);
    let buffer;
    try { buffer = fs.readFileSync(target); } catch { throw httpError('chunked_upload_not_found', 404); }
    if (Number(expectedBytes) > 0 && buffer.length !== Number(expectedBytes)) {
      throw httpError('chunked_upload_incomplete', 409, { received: buffer.length });
    }
    fs.rmSync(target, { force: true });
    return buffer;
  }

  return { appendChunk, takeAssembled, sweepStale, baseDir };
}

module.exports = { createChunkedUploadStore, UPLOAD_ID_PATTERN };
