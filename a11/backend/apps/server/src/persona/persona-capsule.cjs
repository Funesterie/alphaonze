'use strict';

/**
 * persona-capsule.cjs — l'Holocron d'identité d'une persona.
 *
 * Protocole F.O.R.C.E. (docs/persona-force-protocol.md §3) : chaque persona possède un
 * Holocron, capsule locale IMMUAABLE et VERSIONNÉE. Aucun secret dedans — seulement des
 * références vers des secrets protégés. L'holocron dit comment recoller les morceaux pour
 * recréer la persona : R2-D2 remet le code, C-3PO remet la mémoire, l'holocron remet
 * l'identité.
 *
 * Intégrité + authenticité :
 *   checksums.json  — SHA-256 de chaque fichier de contenu (détecte la corruption)
 *   signature.json  — Ed25519 sur le checksums canonique (détecte la falsification par un
 *                     agent compromis : il faut la clé privée, détenue par la Force / Djeff,
 *                     pas par l'agent qui tourne).
 *
 * Couche générique AU-DESSUS de persona-recovery.cjs : on greffe, on ne remplace pas.
 * persona-recovery rebranche une voix Suno morte depuis l'échantillon local ; la capsule,
 * elle, porte l'identité entière (rôle, modèles, outils, voix, refs, pointeurs mémoire,
 * fournisseurs, batterie de tests de son époque) pour qu'une persona puisse se relever.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HOLOCRON_SCHEMA_VERSION = 'funesterie.persona.holocron.v1';
const SIGN_ALGO = 'ed25519';
// Fichiers de contenu de la capsule (l'identité, hors checksums/signature). L'ordre est
// fixe pour que la signature soit reproductible quel que soit l'OS ou le filesystem.
const CAPSULE_FILES = [
  'capsule.json',
  'identity.json',
  'models.json',
  'tools.json',
  'voice.json',
  'visuals.json',
  'memory-pointers.json',
  'providers.json',
  'behavior-tests.json',
];

const DEFAULT_KEY_DIR_NAME = '.keys';
const DEFAULT_KEY_FILE = 'holocron-ed25519.pem';

function nowIso() {
  return new Date().toISOString();
}

/** Sérialisation canonique : clés triées, pas d'espaces. Reproductible bit pour bit. */
function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        acc[k] = sortKeys(value[k]);
        return acc;
      }, {});
  }
  return value;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Résout la clé de signature Ed25519. Ordre :
 *   1. FUNESTERIE_HOLOCRON_SIGNING_KEY -> PEM en clair ou chemin vers un fichier PEM
 *   2. clé de dev persistée sous <keyDir>/holocron-ed25519.pem (auto-générée si absente)
 *
 * La clé de dev N'EST PAS la clé de prod : elle existe pour que la capsule soit signée et
 * vérifiable sur un poste de développement. En production, la clé privée doit être tenue
 * par la Force / Djeff, hors de l'agent — décision ouverte §11 du protocole.
 */
function resolveSigningKey(env = process.env) {
  const raw = String(env.FUNESTERIE_HOLOCRON_SIGNING_KEY || '').trim();
  if (raw) {
    const pem = raw.includes('-----BEGIN') || raw.includes('\n') || /\.\p{L}{2,4}$/u.test(raw)
      ? (fs.existsSync(raw) ? fs.readFileSync(raw, 'utf8') : raw)
      : raw;
    if (fs.existsSync(pem)) return loadKeyPair(fs.readFileSync(pem, 'utf8'));
    return loadKeyPair(pem);
  }
  const keyDir = String(env.FUNESTERIE_HOLOCRON_KEY_DIR || path.join(guessVaultRoot(env), DEFAULT_KEY_DIR_NAME));
  ensureDir(keyDir);
  const keyPath = path.join(keyDir, DEFAULT_KEY_FILE);
  if (fs.existsSync(keyPath)) return loadKeyPair(fs.readFileSync(keyPath, 'utf8'));
  const pair = crypto.generateKeyPairSync(SIGN_ALGO);
  const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  fs.writeFileSync(keyPath, pem, { mode: 0o600 });
  return loadKeyPair(pem);
}

function guessVaultRoot(env) {
  return String(env.FUNESTERIE_PERSONA_VAULT || 'runtime/persona-vault');
}

function loadKeyPair(pem) {
  const privateKey = crypto.createPrivateKey(pem);
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const keyId = sha256Hex(Buffer.from(publicKey, 'utf8')).slice(0, 16);
  return { privateKey, publicKey, keyId, algorithm: SIGN_ALGO };
}

/**
 * Assemble une capsule depuis les données d'une persona. Aucun secret : les champs
 * fournisseurs ne portent que des références (voiceId, sampleRef, provider) et des recettes
 * de recréation, jamais de clé API. Les pointeurs mémoire désignent les carnets par leur
 * adresse + checksum, pas leur contenu.
 */
function buildCapsule(persona, options = {}) {
  const {
    color,
    models = [],
    tools = [],
    voice = {},
    visuals = [],
    memoryPointers = [],
    providers = [],
    behaviorTests = [],
    snapshotAt = nowIso(),
    canonical = true,
  } = options;

  const id = String(persona.id || persona.name || '').toLowerCase();
  if (!id) throw new Error('holocron_missing_persona_id');

  const capsule = {
    schemaVersion: HOLOCRON_SCHEMA_VERSION,
    personaId: id,
    label: persona.label || persona.name || id,
    role: persona.role || '',
    official: Boolean(persona.official),
    snapshotAt,
    canonical: Boolean(canonical),
    color: color || null,
  };

  return {
    files: {
      'capsule.json': capsule,
      'identity.json': {
        personaId: id,
        label: capsule.label,
        role: capsule.role,
        official: capsule.official,
        note: persona.note || '',
        fundamentalInstructionsRef: persona.fundamentalInstructionsRef || null,
      },
      'models.json': { personaId: id, chain: models },
      'tools.json': { personaId: id, permissions: tools },
      'voice.json': {
        personaId: id,
        voiceStyle: voice.voiceStyle || persona.voiceStyle || '',
        sampleRef: voice.sampleRef || null,
        consentBy: voice.consentBy || null,
      },
      'visuals.json': { personaId: id, references: visuals },
      'memory-pointers.json': { personaId: id, pointers: memoryPointers },
      'providers.json': { personaId: id, bindings: providers },
      'behavior-tests.json': { personaId: id, battery: behaviorTests },
    },
  };
}

/** Calcule les checksums SHA-256 de chaque fichier de contenu (forme canonique). */
function computeChecksums(files) {
  const checksums = {};
  for (const name of CAPSULE_FILES) {
    if (!Object.prototype.hasOwnProperty.call(files, name)) continue;
    checksums[name] = sha256Hex(Buffer.from(canonicalJson(files[name]), 'utf8'));
  }
  return checksums;
}

/** Signe la capsule : signature Ed25519 sur le checksums canonique. */
function signCapsule(files, keyPair) {
  const checksums = computeChecksums(files);
  const signedBytes = Buffer.from(canonicalJson(checksums), 'utf8');
  const signature = crypto.sign(null, signedBytes, keyPair.privateKey).toString('hex');
  return {
    algorithm: SIGN_ALGO,
    keyId: keyPair.keyId,
    publicKey: keyPair.publicKey,
    signedOver: 'checksums.json',
    signature,
    signedAt: nowIso(),
  };
}

function writeCapsule(vaultRoot, personaId, capsule, keyPair, env = process.env) {
  const dir = path.join(vaultRoot, personaId);
  ensureDir(dir);
  const { files } = capsule;
  for (const name of CAPSULE_FILES) {
    if (!Object.prototype.hasOwnProperty.call(files, name)) continue;
    fs.writeFileSync(path.join(dir, name), canonicalJson(files[name]) + '\n', 'utf8');
  }
  const checksums = computeChecksums(files);
  fs.writeFileSync(path.join(dir, 'checksums.json'), canonicalJson(checksums) + '\n', 'utf8');
  const signature = signCapsule(files, keyPair);
  fs.writeFileSync(path.join(dir, 'signature.json'), canonicalJson(signature) + '\n', 'utf8');
  return { dir, checksums, signature };
}

function readCapsule(vaultRoot, personaId) {
  const dir = path.join(vaultRoot, personaId);
  if (!fs.existsSync(dir)) throw new Error(`holocron_not_found:${personaId}`);
  const files = {};
  for (const name of CAPSULE_FILES) {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) continue;
    files[name] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  const checksums = JSON.parse(fs.readFileSync(path.join(dir, 'checksums.json'), 'utf8'));
  const signature = JSON.parse(fs.readFileSync(path.join(dir, 'signature.json'), 'utf8'));
  return { dir, personaId, files, checksums, signature };
}

function verifyChecksums(files, checksums) {
  const tampered = [];
  let ok = true;
  for (const name of Object.keys(checksums)) {
    if (!Object.prototype.hasOwnProperty.call(files, name)) {
      tampered.push(name);
      ok = false;
      continue;
    }
    const expected = sha256Hex(Buffer.from(canonicalJson(files[name]), 'utf8'));
    if (expected !== checksums[name]) {
      tampered.push(name);
      ok = false;
    }
  }
  return { ok, tampered };
}

function verifySignature(checksums, signature, publicKey) {
  try {
    const pub = publicKey || signature.publicKey;
    const key = crypto.createPublicKey(pub);
    const signedBytes = Buffer.from(canonicalJson(checksums), 'utf8');
    return crypto.verify(null, signedBytes, key, Buffer.from(signature.signature, 'hex'));
  } catch {
    return false;
  }
}

function verifyCapsule(vaultRoot, personaId, publicKey) {
  const { files, checksums, signature } = readCapsule(vaultRoot, personaId);
  const checksumsResult = verifyChecksums(files, checksums);
  const signatureOk = verifySignature(checksums, signature, publicKey);
  return {
    personaId,
    ok: checksumsResult.ok && signatureOk,
    checksumsOk: checksumsResult.ok,
    tamperedFiles: checksumsResult.tampered,
    signatureOk,
    keyId: signature.keyId,
    schemaVersion: files['capsule.json'] ? files['capsule.json'].schemaVersion : null,
  };
}

module.exports = {
  HOLOCRON_SCHEMA_VERSION,
  CAPSULE_FILES,
  resolveSigningKey,
  buildCapsule,
  computeChecksums,
  signCapsule,
  writeCapsule,
  readCapsule,
  verifyChecksums,
  verifySignature,
  verifyCapsule,
  canonicalJson,
};
