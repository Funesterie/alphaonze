'use strict';
/**
 * A11 Dump RGBA Brotli — Format d'archive visuelle interne pour A11
 *
 * Pipeline :
 *   information A11 → JSON canonique → Brotli → bytes → PNG RGBA lossless
 *                   → manifest .dump.json → décodage exact possible
 *
 * Format binaire v1 :
 *   magic         8 bytes   "A11DMP1\0"
 *   version       1 byte    1
 *   codec         1 byte    1 = brotli
 *   pixelMode     1 byte    4 = RGBA
 *   flags         1 byte    0
 *   headerLength  4 bytes   LE uint32 — longueur du jsonHeader UTF-8
 *   rawLength     8 bytes   LE BigUInt64 — longueur du contenu brut
 *   payloadLength 8 bytes   LE BigUInt64 — longueur du payload Brotli
 *   createdAtMs   8 bytes   LE BigUInt64 — timestamp ms
 *   sha256Raw     32 bytes  SHA-256 du contenu brut
 *   sha256Payload 32 bytes  SHA-256 du payload Brotli
 *   reserved      32 bytes  zéros
 *   jsonHeader    variable  UTF-8 JSON (headerLength bytes)
 *   payload       variable  Brotli bytes (payloadLength bytes)
 *
 * Encodage PNG :
 *   1 pixel RGBA = 4 bytes
 *   Largeur = ceil(sqrt(totalPixels)), Hauteur = ceil(totalPixels / width)
 *   Pixels excédentaires = (0,0,0,0)
 *
 * Sécurité :
 *   - Ne lit jamais .env, secrets, tokens
 *   - Ne stocke pas de credentials par défaut
 *   - Archive explicite, pas de stéganographie cachée
 */

const zlib = require('node:zlib');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// ─── Constantes ───────────────────────────────────────────────────────────────

const MAGIC = Buffer.from('A11DMP1\0', 'ascii'); // 8 bytes
const VERSION = 1;
const CODEC_BROTLI = 1;
const PIXEL_MODE_RGBA = 4;
const FIXED_HEADER_SIZE = 8 + 1 + 1 + 1 + 1 + 4 + 8 + 8 + 8 + 32 + 32 + 32; // = 136 bytes

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest();
}

function writeBigUInt64LE(buf, value, offset) {
  const bigVal = BigInt(value);
  buf.writeBigUInt64LE(bigVal, offset);
}

function readBigUInt64LE(buf, offset) {
  return Number(buf.readBigUInt64LE(offset));
}

function ceilSqrt(n) {
  const s = Math.ceil(Math.sqrt(n));
  return s;
}

function canonicalJson(input) {
  if (typeof input === 'string') return input;
  if (Buffer.isBuffer(input)) return input.toString('utf8');
  return JSON.stringify(input, null, 0);
}

// ─── Encode ───────────────────────────────────────────────────────────────────

/**
 * Construit l'enveloppe binaire complète (header + jsonHeader + payload Brotli).
 *
 * @param {string|object|Buffer} input  — données à encoder
 * @param {object} [options]
 * @param {string} [options.source]     — "chat|vision|rag|graph|session|file"
 * @param {string} [options.conversationId]
 * @param {string} [options.userId]
 * @param {string[]} [options.tags]
 * @param {string} [options.contentType]
 * @param {number} [options.brotliQuality] — 0-11, défaut 6
 * @returns {{ envelope: Buffer, jsonHeader: object, sha256Raw: string, sha256Payload: string }}
 */
function buildDumpEnvelope(input, options = {}) {
  const rawStr = canonicalJson(input);
  const rawBuf = Buffer.from(rawStr, 'utf8');

  const brotliQuality = Math.max(0, Math.min(11, Number(options.brotliQuality ?? 6)));
  const payload = zlib.brotliCompressSync(rawBuf, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality },
  });

  const sha256Raw = sha256(rawBuf);
  const sha256Payload = sha256(payload);
  const createdAtMs = Date.now();

  const jsonHeaderObj = {
    type: 'a11.dump.rgba.brotli',
    version: VERSION,
    source: String(options.source || 'unknown'),
    conversationId: options.conversationId || null,
    userId: options.userId || null,
    tags: Array.isArray(options.tags) ? options.tags : ['a11', 'memory'],
    contentType: options.contentType || 'application/json',
    compression: 'brotli',
    createdBy: 'a11',
    createdAt: new Date(createdAtMs).toISOString(),
    rawLength: rawBuf.length,
    payloadLength: payload.length,
  };

  const jsonHeaderBuf = Buffer.from(JSON.stringify(jsonHeaderObj), 'utf8');

  // Construire le header fixe
  const fixedHeader = Buffer.alloc(FIXED_HEADER_SIZE, 0);
  let off = 0;
  MAGIC.copy(fixedHeader, off); off += 8;
  fixedHeader[off++] = VERSION;
  fixedHeader[off++] = CODEC_BROTLI;
  fixedHeader[off++] = PIXEL_MODE_RGBA;
  fixedHeader[off++] = 0; // flags
  fixedHeader.writeUInt32LE(jsonHeaderBuf.length, off); off += 4;
  writeBigUInt64LE(fixedHeader, rawBuf.length, off); off += 8;
  writeBigUInt64LE(fixedHeader, payload.length, off); off += 8;
  writeBigUInt64LE(fixedHeader, createdAtMs, off); off += 8;
  sha256Raw.copy(fixedHeader, off); off += 32;
  sha256Payload.copy(fixedHeader, off); off += 32;
  // reserved 32 bytes = already zero

  const envelope = Buffer.concat([fixedHeader, jsonHeaderBuf, payload]);

  return {
    envelope,
    jsonHeader: jsonHeaderObj,
    sha256Raw: sha256Raw.toString('hex'),
    sha256Payload: sha256Payload.toString('hex'),
    rawLength: rawBuf.length,
    payloadLength: payload.length,
  };
}

/**
 * Encode des données en PNG RGBA lossless et écrit le fichier + manifest sidecar.
 *
 * @param {string|object|Buffer} input
 * @param {string} outPath  — chemin du PNG de sortie (ex: "memory.dump.png")
 * @param {object} [options]
 * @returns {Promise<{ pngPath, manifestPath, jsonHeader, sha256Raw, sha256Payload, width, height, totalPixels }>}
 */
async function encodeDumpToRgbaPng(input, outPath, options = {}) {
  const sharp = require('sharp');

  const { envelope, jsonHeader, sha256Raw, sha256Payload, rawLength, payloadLength } = buildDumpEnvelope(input, options);

  // Calculer les dimensions PNG
  const totalBytes = envelope.length;
  const totalPixels = Math.ceil(totalBytes / 4);
  const width = ceilSqrt(totalPixels);
  const height = Math.ceil(totalPixels / width);
  const totalPngBytes = width * height * 4;

  // Pad avec des zéros si nécessaire
  const rgbaBuffer = Buffer.alloc(totalPngBytes, 0);
  envelope.copy(rgbaBuffer, 0);

  // Créer le PNG RGBA lossless
  await sharp(rgbaBuffer, {
    raw: { width, height, channels: 4 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(outPath);

  // Manifest sidecar
  const manifestPath = `${outPath}.dump.json`;
  const manifest = {
    format: 'a11.dump.rgba.brotli',
    version: VERSION,
    pngPath: path.basename(outPath),
    width,
    height,
    totalPixels,
    totalBytes,
    rawLength,
    payloadLength,
    sha256Raw,
    sha256Payload,
    source: jsonHeader.source,
    tags: jsonHeader.tags,
    contentType: jsonHeader.contentType,
    createdAt: jsonHeader.createdAt,
    createdBy: jsonHeader.createdBy,
    conversationId: jsonHeader.conversationId,
    userId: jsonHeader.userId,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return { pngPath: outPath, manifestPath, jsonHeader, sha256Raw, sha256Payload, width, height, totalPixels };
}

// ─── Decode ───────────────────────────────────────────────────────────────────

/**
 * Décode un PNG RGBA Brotli et retourne le contenu original.
 *
 * @param {string} pngPath
 * @param {object} [options]
 * @param {boolean} [options.verify] — vérifier les SHA-256 (défaut: true)
 * @returns {Promise<{ content: string, jsonHeader: object, sha256Raw: string, verified: boolean }>}
 */
async function decodeDumpFromRgbaPng(pngPath, options = {}) {
  const sharp = require('sharp');
  const shouldVerify = options.verify !== false;

  // Lire le PNG et extraire les bytes RGBA bruts
  const { data, info } = await sharp(pngPath)
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 4) {
    throw new Error(`a11-dump: PNG doit être RGBA (4 canaux), trouvé ${info.channels}`);
  }

  const rawBytes = data;

  // Lire le header fixe
  if (rawBytes.length < FIXED_HEADER_SIZE) {
    throw new Error('a11-dump: données trop courtes pour le header fixe');
  }

  let off = 0;
  const magic = rawBytes.slice(off, off + 8); off += 8;
  if (!magic.equals(MAGIC)) {
    throw new Error(`a11-dump: magic invalide: ${magic.toString('ascii')}`);
  }

  const version = rawBytes[off++];
  const codec = rawBytes[off++];
  const pixelMode = rawBytes[off++];
  const flags = rawBytes[off++]; // eslint-disable-line no-unused-vars

  if (version !== VERSION) throw new Error(`a11-dump: version non supportée: ${version}`);
  if (codec !== CODEC_BROTLI) throw new Error(`a11-dump: codec non supporté: ${codec}`);
  if (pixelMode !== PIXEL_MODE_RGBA) throw new Error(`a11-dump: pixelMode non supporté: ${pixelMode}`);

  const jsonHeaderLength = rawBytes.readUInt32LE(off); off += 4;
  const rawLength = readBigUInt64LE(rawBytes, off); off += 8;
  const payloadLength = readBigUInt64LE(rawBytes, off); off += 8;
  const createdAtMs = readBigUInt64LE(rawBytes, off); off += 8; // eslint-disable-line no-unused-vars
  const sha256RawStored = rawBytes.slice(off, off + 32); off += 32;
  const sha256PayloadStored = rawBytes.slice(off, off + 32); off += 32;
  off += 32; // reserved

  // Lire le jsonHeader
  const jsonHeaderBuf = rawBytes.slice(off, off + jsonHeaderLength); off += jsonHeaderLength;
  let jsonHeader;
  try {
    jsonHeader = JSON.parse(jsonHeaderBuf.toString('utf8'));
  } catch (e) {
    throw new Error(`a11-dump: jsonHeader invalide: ${e.message}`);
  }

  // Lire le payload Brotli
  const payload = rawBytes.slice(off, off + payloadLength);
  if (payload.length !== payloadLength) {
    throw new Error(`a11-dump: payload tronqué (attendu ${payloadLength}, lu ${payload.length})`);
  }

  // Vérifier SHA-256 du payload
  let verified = false;
  if (shouldVerify) {
    const sha256PayloadActual = sha256(payload);
    if (!sha256PayloadActual.equals(sha256PayloadStored)) {
      throw new Error('a11-dump: SHA-256 payload invalide — données corrompues');
    }
  }

  // Décompresser Brotli
  const rawBuf = zlib.brotliDecompressSync(payload);
  if (rawBuf.length !== rawLength) {
    throw new Error(`a11-dump: longueur brute incorrecte (attendu ${rawLength}, obtenu ${rawBuf.length})`);
  }

  // Vérifier SHA-256 du contenu brut
  if (shouldVerify) {
    const sha256RawActual = sha256(rawBuf);
    if (!sha256RawActual.equals(sha256RawStored)) {
      throw new Error('a11-dump: SHA-256 contenu brut invalide — données corrompues');
    }
    verified = true;
  }

  const content = rawBuf.toString('utf8');

  return {
    content,
    jsonHeader,
    sha256Raw: sha256RawStored.toString('hex'),
    sha256Payload: sha256PayloadStored.toString('hex'),
    verified,
    rawLength,
    payloadLength,
  };
}

// ─── Verify ───────────────────────────────────────────────────────────────────

/**
 * Vérifie l'intégrité d'un dump PNG sans décoder le contenu complet.
 *
 * @param {string} pngPath
 * @returns {Promise<{ ok, sha256Raw, sha256Payload, jsonHeader, error? }>}
 */
async function verifyDump(pngPath) {
  try {
    const result = await decodeDumpFromRgbaPng(pngPath, { verify: true });
    return {
      ok: true,
      sha256Raw: result.sha256Raw,
      sha256Payload: result.sha256Payload,
      jsonHeader: result.jsonHeader,
      verified: result.verified,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  buildDumpEnvelope,
  encodeDumpToRgbaPng,
  decodeDumpFromRgbaPng,
  verifyDump,
  MAGIC,
  VERSION,
  CODEC_BROTLI,
  PIXEL_MODE_RGBA,
  FIXED_HEADER_SIZE,
};
