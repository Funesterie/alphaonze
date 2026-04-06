// Ajoute ce fichier dans ton backend Node.js (Express)
// Appel TTS universel compatible Railway

const TTS_URL = process.env.TTS_URL || process.env.TTS_HOST || process.env.TTS_BASE_URL || "http://ttssiwis.railway.internal:8080";
const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
const buildTtsReadableText = require('./src/tts/build-tts-readable-text.cjs');

function normalizeTtsResult(baseUrl, data, preparedText) {
  const audioValue = data?.audio_url || data?.audioUrl || data?.url || null;
  const gifValue = data?.gif_url || data?.gifUrl || null;
  const absoluteAudioUrl = toAbsoluteUrl(baseUrl, audioValue);
  const absoluteGifUrl = toAbsoluteUrl(baseUrl, gifValue);
  return {
    ...data,
    text: preparedText,
    audio_url: absoluteAudioUrl,
    audioUrl: absoluteAudioUrl,
    gif_url: absoluteGifUrl,
    gifUrl: absoluteGifUrl,
  };
}

async function callLocalPiperFallback(body, preparedText) {
  const localPort = String(process.env.PORT || '').trim();
  if (!localPort) {
    throw new Error('local_tts_fallback_unavailable');
  }

  const baseUrl = `http://127.0.0.1:${localPort}`;
  const res = await fetch(`${baseUrl}/api/tts/piper`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`local_tts_fallback_failed (${res.status}): ${bodyText}`);
  }

  const data = await res.json();
  const normalized = normalizeTtsResult(baseUrl, data, preparedText);
  if (!normalized.audio_url) {
    throw new Error('No audio_url in local TTS fallback response');
  }
  return normalized;
}

function toAbsoluteUrl(baseUrl, value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const publicBase = String(process.env.TTS_PUBLIC_BASE_URL || process.env.TTS_BASE_URL || "").trim();
  if (/^https?:\/\//i.test(raw)) {
    if (!publicBase) return raw;
    try {
      const url = new URL(raw);
      if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname.endsWith(".railway.internal")) {
        return new URL(`${url.pathname}${url.search}`, `${publicBase.replace(/\/$/, '')}/`).toString();
      }
    } catch {
      return raw;
    }
    return raw;
  }
  const effectiveBase = publicBase || baseUrl;
  return new URL(raw.replace(/^\.\//, ''), `${String(effectiveBase).replace(/\/$/, '')}/`).toString();
}

/**
 * Appelle le service TTS (Python) et retourne une réponse JSON normalisée
 * @param {string | { text: string, voice?: string, model?: string }} payload Texte ou payload à synthétiser
 * @returns {Promise<object>} Réponse TTS
 */
async function callTTS(payload) {
  const baseUrl = String(TTS_URL).replace(/\/$/, "");
  const rawBody = typeof payload === "string" ? { text: payload } : { ...(payload || {}) };
  const preparedText = buildTtsReadableText(rawBody.text || '');
  const body = {
    ...rawBody,
    text: preparedText,
  };
  try {
    const res = await fetch(`${baseUrl}/api/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const responseBody = await res.text().catch(() => "");
      throw new Error(`TTS failed (${res.status}): ${responseBody}`);
    }

    const data = await res.json();
    const normalized = normalizeTtsResult(baseUrl, data, preparedText);
    if (!normalized.audio_url) {
      throw new Error("No audio_url in TTS response");
    }
    return normalized;
  } catch (error_) {
    return callLocalPiperFallback(body, preparedText).catch((fallbackError) => {
      throw new Error(`TTS failed: ${String(error_?.message || error_)} | fallback: ${String(fallbackError?.message || fallbackError)}`);
    });
  }
}

module.exports = { callTTS };
