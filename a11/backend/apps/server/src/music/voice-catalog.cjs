'use strict';

/**
 * Catalogue de voix Suno — registre en donnees, pas en code.
 *
 * Avant ce module, ajouter une voix imposait six modifications de code plus un
 * deploiement: une branche dans resolveConfiguredVivySunoPersonaVoiceId, deux listes
 * d'artistes, les cles managees du script de deploiement, et les trois fichiers
 * d'environnement du serveur.
 *
 * Ici une voix est une simple entree JSON: un nom, un voiceId Suno, et surtout la
 * trace du consentement. `vivy-song-lab-plan.md` impose un bloc rights avec
 * no_artist_voice_clone et voice_consent avant toute publication: le champ
 * consentBy est donc obligatoire, ce n'est pas de la paperasse.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { getCanonicalRuntimeRoot } = require('../../lib/runtime-root.cjs');

const CATALOG_SCHEMA = 'funesterie.voice-catalog.v1';
const MAX_ENTRIES = 200;
const MAX_ALIASES = 6;

function cleanLine(value, max = 120) {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

/** Nom canonique: minuscules, sans accent, tirets. Sert de cle de recherche. */
function slugifyVoiceName(value = '') {
  return cleanLine(value, 80)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Un persona Suno est un identifiant hexadecimal de 32 caracteres. */
function normalizeVoiceId(value = '') {
  const raw = cleanLine(value, 180).replace(/\s+/g, '');
  return /^[a-f0-9]{32}$/i.test(raw) ? raw.toLowerCase() : '';
}

function maskVoiceId(voiceId = '') {
  const v = String(voiceId || '');
  return v.length >= 10 ? `${v.slice(0, 4)}…${v.slice(-4)}` : '';
}

function hashVoiceId(voiceId = '') {
  return crypto.createHash('sha256').update(String(voiceId || '')).digest('hex').slice(0, 16);
}

function resolveVoiceCatalogPath(env = process.env) {
  const configured = cleanLine(env.A11_VOICE_CATALOG_FILE || '', 400);
  if (configured) return path.resolve(configured);
  return path.join(getCanonicalRuntimeRoot(env), 'voice-catalog.json');
}

function normalizeEntry(value = null) {
  const name = slugifyVoiceName(value?.name || value?.slug || value?.label);
  const voiceId = normalizeVoiceId(value?.voiceId || value?.id);
  if (!name || !voiceId) return null;

  const aliases = (Array.isArray(value?.aliases) ? value.aliases : [])
    .map((a) => slugifyVoiceName(a))
    .filter((a) => a && a !== name)
    .slice(0, MAX_ALIASES);

  return {
    name,
    label: cleanLine(value?.label || value?.name, 80) || name,
    voiceId,
    idMask: maskVoiceId(voiceId),
    idHash: hashVoiceId(voiceId),
    owner: cleanLine(value?.owner || value?.ownerName, 80),
    // Sans indication de genre, Suno derive: un echantillon Djeff est sorti avec une
    // voix feminine faute de tags negatifs. Le projet en pose pour ses artistes
    // officiels, le catalogue doit faire pareil.
    gender: ['homme', 'femme'].includes(String(value?.gender || '').trim().toLowerCase())
      ? String(value.gender).trim().toLowerCase()
      : '',
    // Qui atteste que la personne autorise l'usage de sa voix. Obligatoire.
    consentBy: cleanLine(value?.consentBy || value?.consentedBy, 160),
    consentAt: cleanLine(value?.consentAt, 40) || new Date().toISOString(),
    addedBy: cleanLine(value?.addedBy, 160),
    addedAt: cleanLine(value?.addedAt, 40) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    aliases: [...new Set(aliases)],
    note: cleanLine(value?.note, 200),
    // Echantillon Suno persiste: Vivy s'en sert comme matiere de reference, il doit
    // donc survivre a la generation qui l'a produit (les URL Suno expirent).
    sampleFile: cleanLine(value?.sampleFile, 200),
    sampleDurationSeconds: Math.max(0, Math.round(Number(value?.sampleDurationSeconds || 0))) || 0,
    sampleAt: cleanLine(value?.sampleAt, 40),
    // Compteurs d'echec: sans eux, une voix dont la persona est morte relancerait une
    // generation a chaque passage, indefiniment, en brulant des credits pour rien.
    sampleAttempts: Math.max(0, Math.round(Number(value?.sampleAttempts || 0))) || 0,
    sampleLastAttemptAt: cleanLine(value?.sampleLastAttemptAt, 40),
    sampleLastError: cleanLine(value?.sampleLastError, 200),
    active: value?.active !== false,
  };
}

function resolveVoiceSampleDir(env = process.env) {
  return path.join(path.dirname(resolveVoiceCatalogPath(env)), 'voice-samples');
}

/** Attache un echantillon deja telecharge a une voix du catalogue. */
function attachVoiceSample(nameOrAlias, { buffer, durationSeconds = 0 }, env = process.env) {
  const entry = findVoiceInCatalog(nameOrAlias, env);
  if (!entry) throw new Error('voice_not_found');
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('empty_sample');

  const dir = resolveVoiceSampleDir(env);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${entry.name}.mp3`;
  fs.writeFileSync(path.join(dir, file), buffer);

  return upsertVoiceInCatalog({
    ...entry,
    sampleFile: file,
    sampleDurationSeconds: Math.round(Number(durationSeconds || 0)) || 0,
    sampleAt: new Date().toISOString(),
  }, env);
}

function readVoiceSample(nameOrAlias, env = process.env) {
  const entry = findVoiceInCatalog(nameOrAlias, env);
  if (!entry?.sampleFile) return null;
  const full = path.join(resolveVoiceSampleDir(env), entry.sampleFile);
  if (!fs.existsSync(full)) return null;
  return { path: full, name: entry.name, durationSeconds: entry.sampleDurationSeconds };
}

function readVoiceCatalog(env = process.env) {
  const file = resolveVoiceCatalogPath(env);
  try {
    if (!fs.existsSync(file)) return { schema: CATALOG_SCHEMA, voices: [] };
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const voices = (Array.isArray(parsed?.voices) ? parsed.voices : [])
      .map((v) => normalizeEntry(v))
      .filter(Boolean)
      .slice(0, MAX_ENTRIES);
    return { schema: CATALOG_SCHEMA, voices };
  } catch {
    // Un catalogue illisible ne doit jamais casser une generation: on repart vide.
    return { schema: CATALOG_SCHEMA, voices: [] };
  }
}

function writeVoiceCatalog(catalog, env = process.env) {
  const file = resolveVoiceCatalogPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    schema: CATALOG_SCHEMA,
    updatedAt: new Date().toISOString(),
    voices: (catalog?.voices || []).map((v) => normalizeEntry(v)).filter(Boolean).slice(0, MAX_ENTRIES),
  };
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return payload;
}

/** Recherche par nom ou alias. C'est ce qui remplace la chaine de `if` codee en dur. */
function findVoiceInCatalog(nameOrAlias = '', env = process.env) {
  const key = slugifyVoiceName(nameOrAlias);
  if (!key) return null;
  const { voices } = readVoiceCatalog(env);
  return voices.find((v) => v.active && (v.name === key || v.aliases.includes(key))) || null;
}

function resolveCatalogVoiceId(nameOrAlias = '', env = process.env) {
  return findVoiceInCatalog(nameOrAlias, env)?.voiceId || '';
}

function upsertVoiceInCatalog(entry, env = process.env) {
  const normalized = normalizeEntry(entry);
  if (!normalized) throw new Error('invalid_voice_entry');
  if (!normalized.consentBy) throw new Error('missing_consent');

  const catalog = readVoiceCatalog(env);
  const existing = catalog.voices.find((v) => v.name === normalized.name);
  if (existing) {
    normalized.addedBy = existing.addedBy || normalized.addedBy;
    normalized.addedAt = existing.addedAt || normalized.addedAt;

    // Remplacement d'une persona expiree: l'ancien echantillon ne correspond plus a
    // la nouvelle voix. On le supprime du disque au lieu de le laisser orphelin, et
    // le rattrapage automatique en regenerera un.
    if (existing.sampleFile && existing.voiceId !== normalized.voiceId && !normalized.sampleFile) {
      try {
        fs.unlinkSync(path.join(resolveVoiceSampleDir(env), existing.sampleFile));
      } catch { /* deja absent: rien a faire */ }
    }

    catalog.voices = catalog.voices.map((v) => (v.name === normalized.name ? normalized : v));
  } else {
    if (catalog.voices.length >= MAX_ENTRIES) throw new Error('catalog_full');
    catalog.voices.push(normalized);
  }
  writeVoiceCatalog(catalog, env);
  return normalized;
}

function removeVoiceFromCatalog(nameOrAlias = '', env = process.env) {
  const key = slugifyVoiceName(nameOrAlias);
  const catalog = readVoiceCatalog(env);
  const before = catalog.voices.length;
  catalog.voices = catalog.voices.filter((v) => v.name !== key);
  if (catalog.voices.length === before) return false;
  writeVoiceCatalog(catalog, env);
  return true;
}

/** Vue publique: jamais le voiceId en clair, seulement masque + empreinte. */
function describeVoiceCatalog(env = process.env) {
  const { voices } = readVoiceCatalog(env);
  return {
    schema: CATALOG_SCHEMA,
    count: voices.length,
    voices: voices.map((v) => ({
      name: v.name,
      label: v.label,
      owner: v.owner,
      aliases: v.aliases,
      idMask: v.idMask,
      idHash: v.idHash,
      consentBy: v.consentBy,
      consentAt: v.consentAt,
      addedBy: v.addedBy,
      addedAt: v.addedAt,
      updatedAt: v.updatedAt,
      note: v.note,
      hasSample: Boolean(v.sampleFile),
      sampleDurationSeconds: v.sampleDurationSeconds || 0,
      sampleAt: v.sampleAt || '',
      active: v.active,
    })),
  };
}

module.exports = {
  CATALOG_SCHEMA,
  slugifyVoiceName,
  normalizeVoiceId,
  maskVoiceId,
  resolveVoiceCatalogPath,
  readVoiceCatalog,
  writeVoiceCatalog,
  findVoiceInCatalog,
  resolveCatalogVoiceId,
  upsertVoiceInCatalog,
  removeVoiceFromCatalog,
  describeVoiceCatalog,
  resolveVoiceSampleDir,
  attachVoiceSample,
  readVoiceSample,
};
