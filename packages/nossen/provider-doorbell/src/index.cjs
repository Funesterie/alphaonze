'use strict';

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeProvider(provider = {}) {
  return {
    id: String(provider.id || provider.name || '').trim(),
    provider: String(provider.provider || provider.id || provider.name || '').trim(),
    baseURL: String(provider.baseURL || provider.baseUrl || '').replace(/\/$/, ''),
    model: String(provider.model || '').trim(),
    apiKey: provider.apiKey,
    headers: provider.headers && typeof provider.headers === 'object' ? provider.headers : {},
    probe: provider.probe,
  };
}

function providerInstanceKey(provider = {}) {
  const normalized = normalizeProvider(provider);
  if (normalized.id) return `id:${normalized.id}`;
  return `route:${normalized.provider}|${normalized.baseURL}|${normalized.model}`;
}

function classifyStatus(status) {
  if ([401, 402, 403, 404, 409, 423, 429].includes(status)) return 'unavailable';
  if (status >= 200 && status < 500) return 'available';
  if (status >= 500) return 'unknown';
  return 'unknown';
}

async function defaultProbe(provider, options = {}) {
  if (!provider.baseURL) return { state: 'unknown', reason: 'missing_base_url' };
  const timeoutMs = clampInt(options.timeoutMs, 100, 5000, 1200);
  const headers = {
    Accept: 'application/json',
    ...provider.headers,
  };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;

  const urls = [
    `${provider.baseURL}/models`,
    `${provider.baseURL}/v1/models`,
  ];

  for (const url of urls) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      let response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers,
          ...(controller ? { signal: controller.signal } : {}),
        });
      } catch (error) {
        if (controller?.signal?.aborted) return { state: 'unknown', reason: 'probe_timeout' };
        continue;
      }
      const state = classifyStatus(response.status);
      if (state === 'available') return { state, reason: `http_${response.status}`, status: response.status, url };
      if (state === 'unavailable') return { state, reason: `http_${response.status}`, status: response.status, url };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return { state: 'unknown', reason: 'probe_inconclusive' };
}

async function ringProvider(providerInput, options = {}) {
  const provider = normalizeProvider(providerInput);
  const startedAt = Date.now();
  const instanceKey = providerInstanceKey(providerInput);
  if (!provider.id && !provider.baseURL) {
    return {
      provider: provider.provider || 'unknown',
      instanceKey,
      state: 'unknown',
      reason: 'provider_identity_missing',
      latencyMs: 0,
    };
  }
  try {
    const probe = typeof provider.probe === 'function'
      ? await provider.probe(provider, options)
      : await defaultProbe(provider, options);
    return {
      provider: provider.provider || provider.id || 'unknown',
      id: provider.id || '',
      instanceKey,
      model: provider.model || '',
      baseURL: provider.baseURL || '',
      state: ['available', 'unavailable', 'unknown'].includes(probe?.state) ? probe.state : 'unknown',
      reason: String(probe?.reason || 'probe_no_reason'),
      status: Number(probe?.status || 0) || undefined,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      provider: provider.provider || provider.id || 'unknown',
      id: provider.id || '',
      instanceKey,
      model: provider.model || '',
      baseURL: provider.baseURL || '',
      state: 'unknown',
      reason: String(error?.code || error?.message || 'probe_error').slice(0, 160),
      latencyMs: Date.now() - startedAt,
    };
  }
}

async function ringProviders(providers = [], options = {}) {
  const list = Array.isArray(providers) ? providers : [];
  const results = await Promise.all(list.map((provider) => ringProvider(provider, options)));
  return {
    checkedAt: new Date().toISOString(),
    policy: 'parallel-fail-open',
    timeoutMs: clampInt(options.timeoutMs, 100, 5000, 1200),
    results,
    available: results.filter((item) => item.state === 'available'),
    unavailable: results.filter((item) => item.state === 'unavailable'),
    unknown: results.filter((item) => item.state === 'unknown'),
  };
}

function filterProvidersByDoorbell(providers = [], report = {}) {
  const unavailableKeys = new Set((report.unavailable || []).map((item) => item.instanceKey).filter(Boolean));
  return (Array.isArray(providers) ? providers : []).filter((provider) => !unavailableKeys.has(providerInstanceKey(provider)));
}

module.exports = {
  filterProvidersByDoorbell,
  providerInstanceKey,
  ringProvider,
  ringProviders,
};
