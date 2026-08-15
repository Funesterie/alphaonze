'use strict';
/**
 * jukebox-zen.cjs — Morceau NOSSEN livrable en un seul fichier .zen.
 *
 * Un .zen de jukebox porte tout ce qui fait le morceau : l'audio, les paroles,
 * la pochette et les metadonnees. Un seul fichier a telecharger, illisible sans
 * la cle, et reconstructible a l'identique.
 *
 * On n'invente pas de format : @nossen/zen implemente deja le conteneur ZEN
 * ("zip inverse" qui cache l'ordre des elements, pas seulement leur contenu).
 * Ce module se contente de definir ce qu'on y range et de verifier ce qu'on en
 * ressort.
 *
 * Garde-fou du canon, applique ici : la cle ne vit jamais dans le fichier ni
 * dans le depot. Elle vient de JUKEBOX_ZEN_KEY (ou est passee a l'appel).
 * Sans cle, on refuse d'encoder plutot que de produire un conteneur ouvert.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TRACK_SCHEMA = 'funesterie.jukebox.zen-track.v1';

function loadZen() {
  // Chemins possibles : monorepo local, puis conteneur.
  const candidates = [
    path.resolve(__dirname, '../../../../../../packages/nossen/zen/src/index.cjs'),
    '/app/packages/nossen/zen/src/index.cjs',
    '@nossen/zen',
  ];
  let lastError;
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`@nossen/zen introuvable (${lastError && lastError.message})`);
}

function resolveKey(explicitKey) {
  const key = explicitKey || process.env.JUKEBOX_ZEN_KEY || '';
  if (!key) {
    throw new Error(
      'JUKEBOX_ZEN_KEY absente. Le canon ZEN interdit de stocker la cle dans le '
      + 'fichier ou le depot : sans cle, on n\'ecrit pas de conteneur.'
    );
  }
  return key;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function cleanText(value, max = 20000) {
  return String(value == null ? '' : value).normalize('NFC').slice(0, max);
}

/**
 * Assemble la charge utile d'un morceau. Tout binaire est porte en base64 pour
 * survivre au passage JSON; les empreintes permettent de prouver apres coup que
 * l'audio ressorti est bien celui qui est entre.
 */
function buildTrackPayload({
  audioBuffer,
  audioFilename = 'track.mp3',
  audioMimeType = 'audio/mpeg',
  title = '',
  artist = 'Vivy',
  lyrics = '',
  coverBuffer = null,
  coverMimeType = 'image/png',
  durationSeconds = 0,
  metadata = {},
  masters = [],
} = {}) {
  if (!Buffer.isBuffer(audioBuffer) || !audioBuffer.length) {
    throw new Error('audioBuffer requis et non vide');
  }
  const payload = {
    schema: TRACK_SCHEMA,
    title: cleanText(title, 300),
    artist: cleanText(artist, 200),
    durationSeconds: Number(durationSeconds) || 0,
    createdAt: new Date().toISOString(),
    audio: {
      filename: cleanText(audioFilename, 250),
      mimeType: cleanText(audioMimeType, 100),
      bytes: audioBuffer.length,
      sha256: sha256(audioBuffer),
      base64: audioBuffer.toString('base64'),
    },
    lyrics: cleanText(lyrics),
    cover: null,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    // Masters alternatifs (ex: V11 pan integrale). L'audio d'origine reste dans
    // `audio` : on ajoute des rendus, on n'en remplace jamais la source.
    masters: (Array.isArray(masters) ? masters : [])
      .filter((master) => master && Buffer.isBuffer(master.buffer) && master.buffer.length)
      .map((master) => ({
        id: cleanText(master.id || 'master', 60),
        label: cleanText(master.label || '', 200),
        chain: cleanText(master.chain || '', 200),
        mimeType: cleanText(master.mimeType || 'audio/mpeg', 100),
        bytes: master.buffer.length,
        sha256: sha256(master.buffer),
        params: master.params && typeof master.params === 'object' ? master.params : {},
        base64: master.buffer.toString('base64'),
      })),
  };
  if (Buffer.isBuffer(coverBuffer) && coverBuffer.length) {
    payload.cover = {
      mimeType: cleanText(coverMimeType, 100),
      bytes: coverBuffer.length,
      sha256: sha256(coverBuffer),
      base64: coverBuffer.toString('base64'),
    };
  }
  return payload;
}

/** Encode un morceau en Buffer .zen prêt a ecrire ou a servir en telechargement. */
function encodeTrack(track, options = {}) {
  const zen = loadZen();
  const key = resolveKey(options.key);
  const payload = buildTrackPayload(track);
  // encodeZenContainer construit lui-meme l'enveloppe : lui passer un conteneur
  // deja bati produirait un double emballage.
  return zen.encodeZenContainer(payload, {
    ...options,
    key,
    manifest: {
      intent: 'jukebox-track',
      source: 'funesterie-jukebox',
      corpus: payload.title || payload.audio.filename,
      notes: ['Conteneur de morceau NOSSEN : audio, paroles, pochette et metadonnees.'],
    },
  });
}

/**
 * Relit un .zen et rend le morceau. Verifie les empreintes : un conteneur qui
 * se decode mais dont l'audio ne correspond plus est signale, pas rendu en
 * silence.
 */
function decodeTrack(input, options = {}) {
  const zen = loadZen();
  const key = resolveKey(options.key);
  const decoded = zen.decodeZenContainer(input, { ...options, key });
  const payload = decoded.container && decoded.container.data
    ? decoded.container.data.value
    : null;
  if (!payload || payload.schema !== TRACK_SCHEMA) {
    throw new Error(`Ce .zen n'est pas un morceau de jukebox (${payload && payload.schema})`);
  }
  const audioBuffer = Buffer.from(payload.audio.base64, 'base64');
  const audioOk = sha256(audioBuffer) === payload.audio.sha256;
  let coverBuffer = null;
  let coverOk = true;
  if (payload.cover) {
    coverBuffer = Buffer.from(payload.cover.base64, 'base64');
    coverOk = sha256(coverBuffer) === payload.cover.sha256;
  }
  const masters = (Array.isArray(payload.masters) ? payload.masters : []).map((master) => {
    const buffer = Buffer.from(master.base64, 'base64');
    const ok = sha256(buffer) === master.sha256;
    if (!ok) coverOk = coverOk && false;
    return {
      id: master.id,
      label: master.label,
      chain: master.chain,
      mimeType: master.mimeType,
      params: master.params || {},
      buffer,
      bytes: buffer.length,
      integrityOk: ok,
    };
  });
  const mastersOk = masters.every((master) => master.integrityOk);

  return {
    schema: payload.schema,
    title: payload.title,
    artist: payload.artist,
    durationSeconds: payload.durationSeconds,
    createdAt: payload.createdAt,
    lyrics: payload.lyrics,
    metadata: payload.metadata,
    audio: {
      filename: payload.audio.filename,
      mimeType: payload.audio.mimeType,
      buffer: audioBuffer,
      bytes: audioBuffer.length,
      integrityOk: audioOk,
    },
    cover: payload.cover
      ? { mimeType: payload.cover.mimeType, buffer: coverBuffer, integrityOk: coverOk }
      : null,
    masters,
    integrityOk: audioOk && coverOk && mastersOk,
  };
}

/** Encode depuis des chemins disque vers un .zen sur disque. */
function encodeTrackFile({ audioPath, coverPath = '', lyricsPath = '', outputPath, ...rest } = {}, options = {}) {
  const audioBuffer = fs.readFileSync(audioPath);
  const coverBuffer = coverPath && fs.existsSync(coverPath) ? fs.readFileSync(coverPath) : null;
  const lyrics = lyricsPath && fs.existsSync(lyricsPath)
    ? fs.readFileSync(lyricsPath, 'utf8')
    : (rest.lyrics || '');
  const buffer = encodeTrack({
    ...rest,
    lyrics,
    audioBuffer,
    audioFilename: rest.audioFilename || path.basename(audioPath),
    coverBuffer,
  }, options);
  const out = outputPath || `${audioPath.replace(/\.[^.]+$/, '')}.zen`;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buffer);
  return { path: out, bytes: buffer.length };
}

module.exports = {
  TRACK_SCHEMA,
  buildTrackPayload,
  encodeTrack,
  decodeTrack,
  encodeTrackFile,
};
