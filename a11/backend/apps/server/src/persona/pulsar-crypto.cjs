'use strict';

/**
 * Funesterie Crypto — PKCS#1 SHA-256 RSA + Defragmentation Relationnelle
 * 
 * Methode: PKCS#1 SHA-256 avec chiffrement RSA
 * Sel: defragmentation relationnelle (graphe de connaissances)
 * 
 * - Signature et verification avec RSA 2048 PKCS#1
 * - Hachage SHA-256
 * - Chiffrement/dechiffrement RSA-OAEP
 * - Sel genere par defragmentation des relations du graphe Neo4j/knowledge-graph
 * 
 * Chaque utilisateur a un sel unique derive de son reseau relationnel.
 * Le sel n'est pas stocke — il se recalcule depuis le graphe.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const KEY_DIR = path.resolve(process.env.FUNESTERIE_ROOT || 'C:/Users/cella/OneDrive/Documents/funesterie/alphaonze', 'secrets', 'funesterie-crypto');
const PRIVATE_KEY_PATH = path.join(KEY_DIR, 'private_key.pem');
const PUBLIC_KEY_PATH = path.join(KEY_DIR, 'public_key.pem');

let cachedPrivateKey = null;
let cachedPublicKey = null;

function loadPrivateKey() {
  if (cachedPrivateKey) return cachedPrivateKey;
  const pem = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
  cachedPrivateKey = crypto.createPrivateKey({ key: pem, format: 'pem', type: 'pkcs1' });
  return cachedPrivateKey;
}

function loadPublicKey() {
  if (cachedPublicKey) return cachedPublicKey;
  const pem = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
  cachedPublicKey = crypto.createPublicKey({ key: pem, format: 'pem', type: 'pkcs1' });
  return cachedPublicKey;
}

// ─── Defragmentation Relationnelle ─────────────────────────────────────
// 
// Le sel est derive des relations du graphe de connaissances de l'utilisateur.
// On prend les triplets (sujet, relation, objet), on les normalise, on les
// condense en un hash SHA-256. C'est le sel.
//
// Avantages:
// - Le sel n'est pas stocke en clair, il se recalcule
// - Deux utilisateurs avec des relations differentes ont des sels differents
// - Si quelqu'un ajoute une relation, le sel change (rotation auto)
// - Pour brute-forcer, il faut connaitre tout le reseau relationnel

function defragmentRelations(triplets = []) {
  // Normaliser les triplets: trier, dedupliquer, nettoyer
  const normalized = triplets
    .map(t => {
      const s = String(t.subject || t.s || '').trim().toLowerCase();
      const r = String(t.relation || t.predicate || t.r || '').trim().toLowerCase();
      const o = String(t.object || t.o || '').trim().toLowerCase();
      return { s, r, o };
    })
    .filter(t => t.s && t.r && t.o)
    .sort((a, b) => {
      const ka = `${a.s}|${a.r}|${a.o}`;
      const kb = `${b.s}|${b.r}|${b.o}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    // Dedupliquer
    .filter((t, i, arr) => {
      if (i === 0) return true;
      const prev = arr[i - 1];
      return `${t.s}|${t.r}|${t.o}` !== `${prev.s}|${prev.r}|${prev.o}`;
    });

  // Condenser en une chaine unique
  const defragged = normalized
    .map(t => `${t.s}--${t.r}->${t.o}`)
    .join('|');

  return defragged;
}

function generateRelationalSalt(triplets = []) {
  const defragged = defragmentRelations(triplets);
  if (!defragged) return null;
  
  // Hash SHA-256 de la defragmentation relationnelle = sel
  const hash = crypto.createHash('sha256').update(defragged).digest('hex');
  return hash;
}

// ─── Signature et Verification PKCS#1 SHA-256 ──────────────────────────

function sign(data, options = {}) {
  const key = loadPrivateKey();
  const salt = options.salt || '';
  const payload = salt ? `${data}:${salt}` : data;
  
  const signObj = crypto.createSign('SHA256');
  signObj.update(payload);
  signObj.end();
  
  return signObj.sign(key).toString('base64');
}

function verify(data, signature, options = {}) {
  const key = loadPublicKey();
  const salt = options.salt || '';
  const payload = salt ? `${data}:${salt}` : data;
  
  const verifyObj = crypto.createVerify('SHA256');
  verifyObj.update(payload);
  verifyObj.end();
  
  try {
    return verifyObj.verify(key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

// ─── Chiffrement et Dechiffrement RSA-OAEP ─────────────────────────────

function encrypt(data, options = {}) {
  const key = loadPublicKey();
  const salt = options.salt || '';
  const payload = salt ? `${data}:${salt}` : data;
  
  const encrypted = crypto.publicEncrypt(
    {
      key: key,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(payload, 'utf8')
  );
  
  return encrypted.toString('base64');
}

function decrypt(encryptedBase64, options = {}) {
  const key = loadPrivateKey();
  const salt = options.salt || '';
  
  const decrypted = crypto.privateDecrypt(
    {
      key: key,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(encryptedBase64, 'base64')
  );
  
  const text = decrypted.toString('utf8');
  if (salt) {
    const parts = text.split(`:${salt}`);
    return parts[0];
  }
  return text;
}

// ─── Hachage SHA-256 avec sel relationnel ──────────────────────────────

function hash(data, options = {}) {
  const salt = options.salt || '';
  const payload = salt ? `${data}:${salt}` : data;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// ─── Token JWT-like signe avec RSA + sel relationnel ───────────────────

function createToken(payload, triplets = []) {
  const salt = generateRelationalSalt(triplets);
  const header = { alg: 'RS256', typ: 'FUNESTERIE' };
  const body = { ...payload, iat: Date.now(), saltHash: hash(salt || '') };
  
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const bodyB64 = Buffer.from(JSON.stringify(body)).toString('base64url');
  const data = `${headerB64}.${bodyB64}`;
  
  const signature = sign(data, { salt });
  
  return `${data}.${signature}`;
}

function verifyToken(token, triplets = []) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, error: 'Invalid token format' };
    
    const [headerB64, bodyB64, signature] = parts;
    const data = `${headerB64}.${bodyB64}`;
    
    const salt = generateRelationalSalt(triplets);
    const isValid = verify(data, signature, { salt });
    
    if (!isValid) return { valid: false, error: 'Invalid signature' };
    
    const body = JSON.parse(Buffer.from(bodyB64, 'base64url').toString());
    return { valid: true, payload: body };
  } catch (err) {
    return { valid: false, error: String(err.message || err) };
  }
}

module.exports = {
  // Cles
  loadPrivateKey,
  loadPublicKey,
  
  // Defragmentation relationnelle
  defragmentRelations,
  generateRelationalSalt,
  
  // PKCS#1 SHA-256
  sign,
  verify,
  
  // Chiffrement
  encrypt,
  decrypt,
  
  // Hachage
  hash,
  
  // Token RSA
  createToken,
  verifyToken,
};


