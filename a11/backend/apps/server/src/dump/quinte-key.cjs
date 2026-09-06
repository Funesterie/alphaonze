'use strict';
/**
 * QUINTE-KEY — Dérivation de clé AES depuis les numéros Quinté/Loterie
 *
 * La clé de décryptage change en fonction des résultats publics :
 *   - Quinté+ : 5 chevaux dans l'ordre (ex: "7-3-12-5-9")
 *   - Loto : 5 numéros + 1 numéro chance (ex: "3-12-27-38-44 + 7")
 *   - EuroMillions : 5 numéros + 2 étoiles (ex: "5-17-23-41-49 + 3-8")
 *
 * Le keyHint identifie quelle course/tirage utiliser, sans révéler les numéros :
 *   - "quinte-2026-08-04-R1"  (course du 4 août 2026, course 1)
 *   - "loto-2026-08-04"       (tirage du 4 août 2026)
 *   - "euromillions-2026-08-05" (tirage du 5 août 2026)
 *
 * Dérivation :
 *   1. Concaténer keyHint + numéros dans un ordre canonique
 *   2. HMAC-SHA256 avec un sel système (env STEGO_SALT)
 *   3. Les 32 premiers bytes = clé AES-256
 *   4. Les 16 bytes suivants = IV AES-256-CBC
 *
 * Le sel système empêche quiconque de dériver la même clé même en connaissant
 * les numéros publics — sauf s'il connaît aussi le sel.
 *
 * Le sel n'est jamais transmis. Il vit dans le .env du serveur.
 */

const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32;  // 256 bits
const IV_LENGTH = 16;   // 128 bits

// ─── Salt resolution ─────────────────────────────────────────────────────────

/**
 * Le sel prive est la seule piece que le public n'a pas : les numeros du Quinte
 * sont publies, le keyHint est previsible. Retomber sur une valeur ecrite dans
 * le depot rendait donc la cle entierement calculable par quiconque lit ce
 * fichier -- c'est-a-dire n'importe qui, le paquet etant publie sur npm.
 *
 * On refuse desormais de deriver sans sel plutot que d'en inventer un connu.
 * Un test peut passer un sel explicite; la production doit poser STEGO_SALT.
 */
function resolveSalt(env) {
  const e = env || process.env;
  const salt = e.STEGO_SALT || e.A11_NEZ_TOKEN || '';
  if (!salt) {
    throw new Error(
      'STEGO_SALT absent. Les numeros du Quinte sont publics : sans sel prive, '
      + 'la cle derivee est calculable par tout le monde. On refuse de chiffrer.'
    );
  }
  return salt;
}

// ─── Canonical number formatting ────────────────────────────────────────────

/**
 * Format quinté numbers canonically: sorted ascending, joined by dashes.
 * @param {number[]} numbers — 5 horse numbers
 * @returns {string} canonical format
 */
function formatQuinte(numbers) {
  if (!Array.isArray(numbers) || numbers.length !== 5) {
    throw new Error('Quinté requires exactly 5 numbers');
  }
  return numbers.map((n) => {
    const num = parseInt(String(n), 10);
    if (!Number.isFinite(num) || num < 1 || num > 99) {
      throw new Error(`Invalid quinté number: ${n}`);
    }
    return String(num).padStart(2, '0');
  }).join('-');
}

/**
 * Format lottery numbers canonically.
 * @param {number[]} numbers — main numbers
 * @param {number[]} bonus — bonus/chance/star numbers
 * @returns {string} canonical format
 */
function formatLoto(numbers, bonus) {
  const main = numbers.map((n) => String(parseInt(n, 10)).padStart(2, '0')).join('-');
  if (bonus && bonus.length > 0) {
    const bonusStr = bonus.map((n) => String(parseInt(n, 10)).padStart(2, '0')).join('-');
    return `${main}+${bonusStr}`;
  }
  return main;
}

/**
 * Format EuroMillions numbers.
 * @param {number[]} numbers — 5 main numbers
 * @param {number[]} stars — 2 star numbers
 * @returns {string} canonical format
 */
function formatEuroMillions(numbers, stars) {
  const main = numbers.map((n) => String(parseInt(n, 10)).padStart(2, '0')).join('-');
  const starStr = stars.map((n) => String(parseInt(n, 10)).padStart(2, '0')).join('-');
  return `${main}*${starStr}`;
}

// ─── Key derivation ──────────────────────────────────────────────────────────

/**
 * Derive AES key + IV from a keyHint and the corresponding numbers.
 *
 * @param {string} keyHint — identifier (e.g., "quinte-2026-08-04-R1")
 * @param {string} canonicalNumbers — formatted numbers (e.g., "07-03-12-05-09")
 * @param {string} [salt] — system salt (defaults to env STEGO_SALT)
 * @returns {{ key: Buffer, iv: Buffer }}
 */
function deriveKey(keyHint, canonicalNumbers, salt) {
  const effectiveSalt = salt || resolveSalt();
  const material = `${keyHint}:${canonicalNumbers}:${effectiveSalt}`;

  // HMAC-SHA256 to derive key material
  const hmac = crypto.createHmac('sha256', effectiveSalt);
  hmac.update(`${keyHint}:${canonicalNumbers}`);
  const keyMaterial = hmac.digest();

  // First 32 bytes = AES key, next 16 = IV
  // We need 48 bytes total (32 + 16), so derive more material
  const hmac2 = crypto.createHmac('sha256', effectiveSalt);
  hmac2.update(`${keyHint}:${canonicalNumbers}:iv`);
  const ivMaterial = hmac2.digest();

  return {
    key: keyMaterial.slice(0, KEY_LENGTH),
    iv: ivMaterial.slice(0, IV_LENGTH),
  };
}

/**
 * Derive key from quinté results.
 * @param {string} keyHint — e.g., "quinte-2026-08-04-R1"
 * @param {number[]} numbers — 5 horse numbers in finishing order
 * @param {string} [salt]
 * @returns {{ key: Buffer, iv: Buffer }}
 */
function deriveFromQuinte(keyHint, numbers, salt) {
  return deriveKey(keyHint, formatQuinte(numbers), salt);
}

/**
 * Derive key from Loto results.
 * @param {string} keyHint — e.g., "loto-2026-08-04"
 * @param {number[]} numbers — 5 main numbers
 * @param {number[]} bonus — 1 chance number
 * @param {string} [salt]
 * @returns {{ key: Buffer, iv: Buffer }}
 */
function deriveFromLoto(keyHint, numbers, bonus, salt) {
  return deriveKey(keyHint, formatLoto(numbers, bonus), salt);
}

/**
 * Derive key from EuroMillions results.
 * @param {string} keyHint — e.g., "euromillions-2026-08-05"
 * @param {number[]} numbers — 5 main numbers
 * @param {number[]} stars — 2 star numbers
 * @param {string} [salt]
 * @returns {{ key: Buffer, iv: Buffer }}
 */
function deriveFromEuroMillions(keyHint, numbers, stars, salt) {
  return deriveKey(keyHint, formatEuroMillions(numbers, stars), salt);
}

// ─── Encryption/decryption ──────────────────────────────────────────────────

/**
 * Encrypt data with AES-256-CBC using a quinté/lottery-derived key.
 *
 * @param {Buffer|string} data — plaintext to encrypt
 * @param {string} keyHint — identifier for the key
 * @param {string} canonicalNumbers — formatted numbers
 * @param {string} [salt]
 * @returns {Buffer} encrypted data
 */
function encrypt(data, keyHint, canonicalNumbers, salt) {
  const { key, iv } = deriveKey(keyHint, canonicalNumbers, salt);
  const plaintext = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return encrypted;
}

/**
 * Decrypt data with AES-256-CBC using a quinté/lottery-derived key.
 *
 * @param {Buffer} encryptedData — encrypted data
 * @param {string} keyHint — identifier for the key
 * @param {string} canonicalNumbers — formatted numbers
 * @param {string} [salt]
 * @returns {Buffer} decrypted plaintext
 */
function decrypt(encryptedData, keyHint, canonicalNumbers, salt) {
  const { key, iv } = deriveKey(keyHint, canonicalNumbers, salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
  return decrypted;
}

/**
 * Generate a key hint for the current date.
 * @param {string} type — "quinte" | "loto" | "euromillions"
 * @param {number} [raceNumber] — for quinté, the race number
 * @param {Date} [date] — defaults to now
 * @returns {string}
 */
function generateKeyHint(type, raceNumber, date) {
  const d = date || new Date();
  const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD
  switch (type) {
    case 'quinte':
      return `quinte-${dateStr}-R${raceNumber || 1}`;
    case 'loto':
      return `loto-${dateStr}`;
    case 'euromillions':
      return `euromillions-${dateStr}`;
    default:
      return `${type}-${dateStr}`;
  }
}

module.exports = {
  ALGORITHM,
  KEY_LENGTH,
  IV_LENGTH,
  formatQuinte,
  formatLoto,
  formatEuroMillions,
  deriveKey,
  deriveFromQuinte,
  deriveFromLoto,
  deriveFromEuroMillions,
  encrypt,
  decrypt,
  generateKeyHint,
  resolveSalt,
};
