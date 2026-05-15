'use strict';

/**
 * secret-sharding.cjs
 *
 * DÃ©coupe un secret en N fragments XOR distribuÃ©s entre les LLMs du pipeline A11.
 * Chaque LLM ne dÃ©tient qu'une part â€” aucun ne peut reconstituer seul.
 *
 * La reconstitution nÃ©cessite :
 *   1. Tous les N fragments
 *   2. La phrase de dÃ©blocage exacte
 *
 * SchÃ©ma :
 *   secret_bytes XOR passphrase_key â†’ masked
 *   masked â†’ split en N parts XOR (part1 XOR part2 XOR ... XOR partN = masked)
 *   Chaque part â†’ encodÃ©e en RGBA PNG (4 bytes/pixel) â†’ stockÃ©e dans le Corpus
 *
 * Usage :
 *   const { shard, reconstruct } = require('./secret-sharding.cjs');
 *   const parts = await shard(secret, passphrase, 3);
 *   const recovered = await reconstruct(parts, passphrase);
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const PASSPHRASE_REQUIRED = 'La Funesterie n\'est jamais finie';
const CORPUS_DIR = process.env.A11_CORPUS_DIR
  || path.join(__dirname, '..', '..', '..', '..', '..', 'runtime', 'Corpus');
const SHARD_DIR = path.join(CORPUS_DIR, 'shards');

// Taille d'un pixel RGBA = 4 bytes
const BYTES_PER_PIXEL = 4;

// ---------------------------------------------------------------------------
// Helpers crypto
// ---------------------------------------------------------------------------

/**
 * DÃ©rive une clÃ© 32 bytes depuis la passphrase via SHA-256.
 * @param {string} passphrase
 * @returns {Buffer}
 */
function deriveKey(passphrase) {
  return crypto.createHash('sha256').update(passphrase, 'utf8').digest();
}

/**
 * VÃ©rifie que la passphrase est correcte.
 * LÃ¨ve une erreur si elle ne correspond pas.
 * @param {string} passphrase
 */
function assertPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.trim() !== PASSPHRASE_REQUIRED) {
    throw new Error(
      'Phrase de deblocage incorrecte. Acces refuse.'
    );
  }
}

/**
 * XOR deux buffers de mÃªme longueur.
 * @param {Buffer} a
 * @param {Buffer} b
 * @returns {Buffer}
 */
function xorBuffers(a, b) {
  const result = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i % b.length];
  }
  return result;
}

/**
 * Pad un buffer Ã  un multiple de `align` bytes.
 * @param {Buffer} buf
 * @param {number} align
 * @returns {Buffer}
 */
function padToAlign(buf, align) {
  const rem = buf.length % align;
  if (rem === 0) return buf;
  const padded = Buffer.alloc(buf.length + (align - rem), 0);
  buf.copy(padded);
  return padded;
}

// ---------------------------------------------------------------------------
// Encodage RGBA PNG (sans dÃ©pendance externe â€” format PNG minimal)
// ---------------------------------------------------------------------------

/**
 * Encode des bytes bruts en PNG RGBA minimal.
 * Chaque groupe de 4 bytes = 1 pixel RGBA.
 *
 * Utilise le module 'sharp' si disponible, sinon Ã©crit un PNG raw maison.
 *
 * @param {Buffer} data - DonnÃ©es Ã  encoder (longueur multiple de 4)
 * @param {string} label - Label pour le nom de fichier
 * @returns {Promise<string>} Chemin du fichier PNG crÃ©Ã©
 */
async function encodeToRgbaPng(data, label) {
  ensureDir(SHARD_DIR);

  const pixelCount = Math.ceil(data.length / BYTES_PER_PIXEL);
  // Dimensions : carrÃ© le plus proche
  const side = Math.ceil(Math.sqrt(pixelCount));
  const totalPixels = side * side;
  const paddedData = Buffer.alloc(totalPixels * BYTES_PER_PIXEL, 0);
  data.copy(paddedData);

  const filename = `shard_${label}_${Date.now()}.png`;
  const filepath = path.join(SHARD_DIR, filename);

  // Tenter sharp si disponible
  try {
    const sharp = require('sharp');
    await sharp(paddedData, {
      raw: { width: side, height: side, channels: 4 },
    })
      .png()
      .toFile(filepath);
    return filepath;
  } catch (_e) {
    // Fallback : Ã©crire un PNG raw minimal (header + IDAT non compressÃ©)
    const pngBuf = buildMinimalPng(paddedData, side, side);
    fs.writeFileSync(filepath, pngBuf);
    return filepath;
  }
}

/**
 * DÃ©code un PNG RGBA en bytes bruts.
 * @param {string} filepath
 * @returns {Promise<Buffer>}
 */
async function decodeFromRgbaPng(filepath) {
  try {
    const sharp = require('sharp');
    const { data } = await sharp(filepath)
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true });
    return data;
  } catch (_e) {
    // Fallback : lire le PNG raw minimal
    const raw = fs.readFileSync(filepath);
    return extractRawFromMinimalPng(raw);
  }
}

// ---------------------------------------------------------------------------
// PNG minimal maison (fallback sans sharp)
// ---------------------------------------------------------------------------

/**
 * Construit un PNG RGBA minimal sans compression (filtre None).
 * Format : PNG signature + IHDR + IDAT (zlib level 0) + IEND
 */
function buildMinimalPng(rgba, width, height) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // color type RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = buildPngChunk('IHDR', ihdrData);

  // Raw image data : pour chaque ligne, prÃ©fixe filtre 0 (None)
  const rowSize = width * 4;
  const rawLines = Buffer.alloc(height * (rowSize + 1));
  for (let y = 0; y < height; y++) {
    rawLines[y * (rowSize + 1)] = 0; // filter type None
    rgba.copy(rawLines, y * (rowSize + 1) + 1, y * rowSize, (y + 1) * rowSize);
  }

  // Compresser avec zlib (Node natif)
  const zlib = require('node:zlib');
  const compressed = zlib.deflateSync(rawLines, { level: 1 });
  const idat = buildPngChunk('IDAT', compressed);

  // IEND chunk
  const iend = buildPngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

function buildPngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBytes, data, crc]);
}

function extractRawFromMinimalPng(pngBuf) {
  // Chercher le chunk IDAT et dÃ©compresser
  let offset = 8; // skip signature
  const idatChunks = [];
  let width = 0;
  let height = 0;

  while (offset < pngBuf.length - 12) {
    const length = pngBuf.readUInt32BE(offset);
    const type = pngBuf.slice(offset + 4, offset + 8).toString('ascii');
    const data = pngBuf.slice(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const zlib = require('node:zlib');
  const compressed = Buffer.concat(idatChunks);
  const rawLines = zlib.inflateSync(compressed);
  const rowSize = width * 4;
  const result = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    rawLines.copy(result, y * rowSize, y * (rowSize + 1) + 1, (y + 1) * (rowSize + 1));
  }

  return result;
}

// CRC32 pour PNG
function crc32(buf) {
  const table = makeCrcTable();
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

let _crcTable = null;
function makeCrcTable() {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    _crcTable[n] = c;
  }
  return _crcTable;
}

// ---------------------------------------------------------------------------
// Helpers filesystem
// ---------------------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// API principale
// ---------------------------------------------------------------------------

/**
 * DÃ©coupe un secret en N fragments XOR.
 *
 * Processus :
 *   1. VÃ©rifie la passphrase
 *   2. Masque le secret avec la clÃ© dÃ©rivÃ©e de la passphrase (XOR)
 *   3. GÃ©nÃ¨re N-1 parts alÃ©atoires
 *   4. La NÃ¨me part = XOR de toutes les prÃ©cÃ©dentes avec le secret masquÃ©
 *   5. Encode chaque part en PNG RGBA â†’ stocke dans le Corpus
 *
 * @param {string|Buffer} secret - Le secret Ã  protÃ©ger
 * @param {string} passphrase - Doit Ãªtre exactement PASSPHRASE_REQUIRED
 * @param {number} [n=3] - Nombre de fragments (2 Ã  8)
 * @returns {Promise<Array<{ index: number, llm: string, filepath: string, size: number }>>}
 */
async function shard(secret, passphrase, n = 3) {
  assertPassphrase(passphrase);

  if (n < 2 || n > 8) throw new Error('n doit etre entre 2 et 8');

  const secretBuf = Buffer.isBuffer(secret)
    ? secret
    : Buffer.from(String(secret), 'utf8');

  // 1. Masquer avec la clÃ© dÃ©rivÃ©e de la passphrase
  const key = deriveKey(passphrase);
  const masked = xorBuffers(secretBuf, key);

  // Pad Ã  multiple de 4 (RGBA)
  const padded = padToAlign(masked, BYTES_PER_PIXEL);
  const len = padded.length;

  // 2. GÃ©nÃ©rer N-1 parts alÃ©atoires
  const parts = [];
  for (let i = 0; i < n - 1; i++) {
    parts.push(crypto.randomBytes(len));
  }

  // 3. La NÃ¨me part = XOR de toutes les prÃ©cÃ©dentes avec le secret masquÃ©
  let lastPart = Buffer.from(padded);
  for (const p of parts) {
    lastPart = xorBuffers(lastPart, p);
  }
  parts.push(lastPart);

  // LLMs assignÃ©s aux parts
  const llmNames = ['ollama', 'groq', 'openai', 'gemini', 'xai', 'deepseek', 'together', 'hf'];

  // 4. Encoder chaque part en PNG RGBA
  const shardId = crypto.randomBytes(4).toString('hex');
  const result = [];

  for (let i = 0; i < n; i++) {
    const label = `${shardId}_${i}`;
    const filepath = await encodeToRgbaPng(parts[i], label);
    result.push({
      index: i,
      llm: llmNames[i % llmNames.length],
      filepath,
      size: parts[i].length,
      shardId,
      originalLength: secretBuf.length, // nÃ©cessaire pour le trim au dÃ©codage
    });
  }

  console.log(`[A11][secret-sharding] Secret dÃ©coupÃ© en ${n} fragments (shardId: ${shardId})`);
  return result;
}

/**
 * Reconstitue un secret depuis ses fragments.
 *
 * @param {Array<{ filepath: string, index: number, originalLength: number }>} shards
 * @param {string} passphrase - Doit Ãªtre exactement PASSPHRASE_REQUIRED
 * @returns {Promise<Buffer>} Le secret original
 */
async function reconstruct(shards, passphrase) {
  assertPassphrase(passphrase);

  if (!Array.isArray(shards) || shards.length < 2) {
    throw new Error('Il faut au minimum 2 fragments pour reconstituer le secret.');
  }

  // Trier par index
  const sorted = [...shards].sort((a, b) => a.index - b.index);

  // DÃ©coder chaque part depuis son PNG
  const parts = [];
  for (const s of sorted) {
    const raw = await decodeFromRgbaPng(s.filepath);
    parts.push(raw);
  }

  // XOR de toutes les parts â†’ secret masquÃ©
  let masked = Buffer.from(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    masked = xorBuffers(masked, parts[i]);
  }

  // DÃ©masquer avec la clÃ© dÃ©rivÃ©e de la passphrase
  const key = deriveKey(passphrase);
  const recovered = xorBuffers(masked, key);

  // Trim au longueur originale
  const originalLength = sorted[0].originalLength || recovered.length;
  const trimmed = recovered.slice(0, originalLength);

  console.log(`[A11][secret-sharding] Secret reconstituÃ© depuis ${shards.length} fragments.`);
  return trimmed;
}

/**
 * Reconstitue et retourne le secret sous forme de string UTF-8.
 *
 * @param {Array<{ filepath: string, index: number, originalLength: number }>} shards
 * @param {string} passphrase
 * @returns {Promise<string>}
 */
async function reconstructString(shards, passphrase) {
  const buf = await reconstruct(shards, passphrase);
  return buf.toString('utf8');
}

/**
 * Supprime les fichiers PNG des fragments du disque.
 * @param {Array<{ filepath: string }>} shards
 */
function cleanupShards(shards) {
  for (const s of shards) {
    try {
      if (s.filepath && fs.existsSync(s.filepath)) {
        fs.unlinkSync(s.filepath);
      }
    } catch (_e) {
      // Silencieux
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  shard,
  reconstruct,
  reconstructString,
  cleanupShards,
  // ExposÃ© pour les tests
  deriveKey,
  xorBuffers,
  assertPassphrase,
  PASSPHRASE_REQUIRED,
};
