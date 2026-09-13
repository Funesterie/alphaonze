'use strict';

function resolveProviderConfig(env = process.env) {
  return {
    groq: {
      apiKey: String(env.VIVY_GROQ_API_KEY || env.GROQ_API_KEY || '').trim(),
      model: String(env.VIVY_SONG_GROQ_MODEL || env.VIVY_GROQ_MODEL || '').trim(),
    },
    elevenlabs: {
      apiKey: String(
        env.A11_ELEVENLABS_API_KEY
        || env.VIVY_ELEVENLABS_API_KEY
        || env.ELEVENLABS_API_KEY
        || env.XI_API_KEY
        || ''
      ).trim(),
    },
  };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function probeGroq(config, fetchImpl) {
  const base = {
    id: 'groq',
    label: 'Groq',
    configured: Boolean(config.apiKey),
    available: null,
    model: config.model,
    modelAvailable: null,
    credits: { remaining: null, unit: 'not_reported' },
  };
  if (!config.apiKey) return base;
  try {
    const response = await fetchImpl('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    const payload = await readJson(response);
    const models = Array.isArray(payload?.data) ? payload.data.map((entry) => String(entry?.id || '')) : [];
    return {
      ...base,
      available: response.ok,
      modelAvailable: response.ok ? models.includes(config.model) : false,
      httpStatus: response.status,
    };
  } catch {
    return { ...base, available: false, modelAvailable: false, reason: 'request_failed' };
  }
}

async function probeElevenLabs(config, fetchImpl) {
  const base = {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    configured: Boolean(config.apiKey),
    available: null,
    model: 'Text to Speech',
    modelAvailable: null,
    credits: { remaining: null, unit: 'characters' },
  };
  if (!config.apiKey) return base;
  try {
    const response = await fetchImpl('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': config.apiKey },
      signal: AbortSignal.timeout(8000),
    });
    const payload = await readJson(response);
    const used = Number(payload?.character_count);
    const limit = Number(payload?.character_limit);
    const hasCredits = Number.isFinite(used) && Number.isFinite(limit) && limit >= 0;
    return {
      ...base,
      available: response.ok,
      modelAvailable: response.ok,
      httpStatus: response.status,
      tier: response.ok ? String(payload?.tier || '') : '',
      credits: {
        used: hasCredits ? used : null,
        limit: hasCredits ? limit : null,
        remaining: hasCredits ? Math.max(0, limit - used) : null,
        unit: 'characters',
      },
    };
  } catch {
    return { ...base, available: false, modelAvailable: false, reason: 'request_failed' };
  }
}

async function getProviderHealth({ env = process.env, fetchImpl = globalThis.fetch, probe = false } = {}) {
  const config = resolveProviderConfig(env);
  const providers = probe
    ? await Promise.all([
      probeGroq(config.groq, fetchImpl),
      probeElevenLabs(config.elevenlabs, fetchImpl),
    ])
    : [
      await probeGroq({ ...config.groq, apiKey: '' }, fetchImpl).then((status) => ({ ...status, configured: Boolean(config.groq.apiKey) })),
      await probeElevenLabs({ ...config.elevenlabs, apiKey: '' }, fetchImpl).then((status) => ({ ...status, configured: Boolean(config.elevenlabs.apiKey) })),
    ];
  return {
    ok: true,
    probed: probe === true,
    checkedAt: new Date().toISOString(),
    providers,
  };
}

module.exports = {
  getProviderHealth,
  resolveProviderConfig,
};
