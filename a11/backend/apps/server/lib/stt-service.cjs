'use strict';
/**
 * STT Service — Speech-to-Text pour A11
 *
 * Stratégie de routing (par ordre de priorité) :
 *   1. Whisper local via Ollama  (A11_STT_PROVIDER=ollama  ou OLLAMA_BASE défini)
 *   2. Whisper API OpenAI        (A11_STT_PROVIDER=openai  ou OPENAI_API_KEY défini)
 *   3. Erreur explicite          (aucun provider disponible)
 *
 * Variables d'environnement :
 *   A11_STT_PROVIDER      — "ollama" | "openai" | "auto" (défaut: "auto")
 *   A11_STT_MODEL         — modèle Whisper (défaut: "whisper-1" pour OpenAI, "whisper" pour Ollama)
 *   A11_STT_LANGUAGE      — langue ISO 639-1 (défaut: "fr")
 *   OLLAMA_BASE           — URL Ollama (ex: http://127.0.0.1:11434)
 *   OPENAI_API_KEY        — clé OpenAI pour Whisper API
 *   OPENAI_BASE_URL       — base URL OpenAI (défaut: https://api.openai.com/v1)
 */

const fs = require('node:fs');
const path = require('node:path');
const { getLogger } = require('./structured-logger.cjs');

const logger = getLogger({ component: 'stt-service' });

// ─── Configuration ────────────────────────────────────────────────────────────

function getSttConfig() {
  return {
    provider: String(process.env.A11_STT_PROVIDER || 'auto').trim().toLowerCase(),
    language: String(process.env.A11_STT_LANGUAGE || 'fr').trim(),
    ollamaBase: String(process.env.OLLAMA_BASE || '').trim().replace(/\/+$/, ''),
    ollamaModel: String(process.env.A11_STT_MODEL || process.env.A11_STT_OLLAMA_MODEL || 'whisper').trim(),
    openaiApiKey: String(process.env.OPENAI_API_KEY || '').trim(),
    openaiBaseUrl: String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, ''),
    openaiModel: String(process.env.A11_STT_MODEL || process.env.A11_STT_OPENAI_MODEL || 'whisper-1').trim(),
  };
}

// ─── Provider detection ───────────────────────────────────────────────────────

function detectProvider(config) {
  if (config.provider === 'ollama') return 'ollama';
  if (config.provider === 'openai') return 'openai';

  // auto: préférer Ollama local si disponible
  if (config.ollamaBase) return 'ollama';
  if (config.openaiApiKey && config.openaiApiKey !== 'dummy') return 'openai';

  return null;
}

// ─── Ollama Whisper ───────────────────────────────────────────────────────────

/**
 * Transcrit un buffer audio via Ollama (endpoint /api/audio/transcriptions).
 * Ollama >= 0.6 supporte Whisper via ce endpoint.
 */
async function transcribeWithOllama(audioBuffer, mimeType, config) {
  const { ollamaBase, ollamaModel, language } = config;

  if (!ollamaBase) {
    throw new Error('OLLAMA_BASE non configuré');
  }

  // Ollama utilise un endpoint multipart compatible OpenAI
  const url = `${ollamaBase}/v1/audio/transcriptions`;

  // Construire le FormData manuellement (Node.js natif)
  const boundary = `----A11STTBoundary${Date.now()}`;
  const filename = `audio.${mimeTypeToExt(mimeType)}`;

  const parts = [];

  // Champ "model"
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${ollamaModel}\r\n`
  );

  // Champ "language"
  if (language) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`
    );
  }

  // Champ "file" (audio binaire)
  const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const fileFooter = `\r\n--${boundary}--\r\n`;

  const bodyParts = [
    Buffer.from(parts.join(''), 'utf8'),
    Buffer.from(fileHeader, 'utf8'),
    audioBuffer,
    Buffer.from(fileFooter, 'utf8'),
  ];
  const body = Buffer.concat(bodyParts);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Ollama STT error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = String(data?.text || data?.transcription || '').trim();

  if (!text) {
    throw new Error('Ollama STT: réponse vide');
  }

  return {
    text,
    language: data?.language || language,
    duration: data?.duration || null,
    provider: 'ollama',
    model: ollamaModel,
  };
}

// ─── OpenAI Whisper API ───────────────────────────────────────────────────────

/**
 * Transcrit un buffer audio via l'API Whisper d'OpenAI.
 * Compatible avec tout endpoint OpenAI-compatible (LM Studio, etc.).
 */
async function transcribeWithOpenAI(audioBuffer, mimeType, config) {
  const { openaiApiKey, openaiBaseUrl, openaiModel, language } = config;

  if (!openaiApiKey || openaiApiKey === 'dummy') {
    throw new Error('OPENAI_API_KEY non configuré');
  }

  const url = `${openaiBaseUrl}/audio/transcriptions`;
  const boundary = `----A11STTBoundary${Date.now()}`;
  const filename = `audio.${mimeTypeToExt(mimeType)}`;

  const parts = [];
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${openaiModel}\r\n`);
  if (language) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${language}\r\n`);
  }
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n`);

  const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const fileFooter = `\r\n--${boundary}--\r\n`;

  const body = Buffer.concat([
    Buffer.from(parts.join(''), 'utf8'),
    Buffer.from(fileHeader, 'utf8'),
    audioBuffer,
    Buffer.from(fileFooter, 'utf8'),
  ]);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI Whisper error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = String(data?.text || '').trim();

  if (!text) {
    throw new Error('OpenAI Whisper: réponse vide');
  }

  return {
    text,
    language: data?.language || language,
    duration: data?.duration || null,
    provider: 'openai',
    model: openaiModel,
  };
}

// ─── Entrée principale ────────────────────────────────────────────────────────

/**
 * Transcrit un buffer audio en texte.
 *
 * @param {Buffer} audioBuffer  — données audio brutes
 * @param {string} mimeType     — type MIME (audio/webm, audio/mp4, audio/wav, etc.)
 * @param {object} [options]    — { language, provider }
 * @returns {Promise<{text, language, duration, provider, model}>}
 */
async function transcribe(audioBuffer, mimeType, options = {}) {
  const config = {
    ...getSttConfig(),
    ...(options.language ? { language: options.language } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
  };

  const resolvedMime = normalizeMimeType(mimeType);
  const provider = detectProvider(config);

  logger.info('STT transcription requested', {
    provider,
    mimeType: resolvedMime,
    language: config.language,
    bufferSize: audioBuffer.length,
  });

  if (!provider) {
    throw new Error(
      'Aucun provider STT disponible. Configure OLLAMA_BASE (Whisper local) ou OPENAI_API_KEY (Whisper API).'
    );
  }

  try {
    let result;
    if (provider === 'ollama') {
      result = await transcribeWithOllama(audioBuffer, resolvedMime, config);
    } else {
      result = await transcribeWithOpenAI(audioBuffer, resolvedMime, config);
    }

    logger.info('STT transcription completed', {
      provider: result.provider,
      textLength: result.text.length,
      language: result.language,
    });

    return result;
  } catch (err) {
    // Si Ollama échoue en mode auto, tenter OpenAI en fallback
    if (provider === 'ollama' && config.provider === 'auto' && config.openaiApiKey && config.openaiApiKey !== 'dummy') {
      logger.warn('Ollama STT failed, falling back to OpenAI', { error: err.message });
      const result = await transcribeWithOpenAI(audioBuffer, resolvedMime, config);
      logger.info('STT fallback to OpenAI succeeded', { textLength: result.text.length });
      return result;
    }
    throw err;
  }
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function normalizeMimeType(mimeType) {
  const raw = String(mimeType || 'audio/webm').trim().toLowerCase();
  // Normaliser les variantes courantes
  if (raw.includes('webm')) return 'audio/webm';
  if (raw.includes('mp4') || raw.includes('m4a') || raw.includes('quicktime')) return 'audio/mp4';
  if (raw.includes('wav')) return 'audio/wav';
  if (raw.includes('ogg')) return 'audio/ogg';
  if (raw.includes('mp3') || raw.includes('mpeg')) return 'audio/mpeg';
  if (raw.includes('flac')) return 'audio/flac';
  return raw || 'audio/webm';
}

function mimeTypeToExt(mimeType) {
  const map = {
    'audio/webm': 'webm',
    'audio/mp4': 'mp4',
    'video/quicktime': 'mov',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/flac': 'flac',
  };
  return map[mimeType] || 'webm';
}

/**
 * Retourne le statut du service STT (provider actif, modèle, langue).
 */
function getSttStatus() {
  const config = getSttConfig();
  const provider = detectProvider(config);
  return {
    available: !!provider,
    provider: provider || 'none',
    model: provider === 'ollama' ? config.ollamaModel : config.openaiModel,
    language: config.language,
    ollamaConfigured: !!config.ollamaBase,
    openaiConfigured: !!(config.openaiApiKey && config.openaiApiKey !== 'dummy'),
  };
}

module.exports = {
  transcribe,
  getSttStatus,
  getSttConfig,
  normalizeMimeType,
  mimeTypeToExt,
};
