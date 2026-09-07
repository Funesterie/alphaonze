'use strict';

const {
  filterProvidersByDoorbell,
  ringProviders,
} = require('@nossen/provider-doorbell');

function clean(value, max = 240) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function timeoutResult(promise, timeoutMs) {
  const bounded = Math.max(100, Math.min(5000, Number(timeoutMs || 1200) || 1200));
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ doorbellTimeout: true }), bounded);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchProbe(url, options = {}) {
  const timeoutMs = Math.max(100, Math.min(5000, Number(options.timeoutMs || 1200) || 1200));
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      method: 'GET',
      ...(controller ? { signal: controller.signal } : {}),
    });
    return response;
  } catch (error) {
    if (controller?.signal?.aborted) return null;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function classifyAuthenticatedError(error) {
  const status = Number(error?.status || error?.response?.status || 0) || 0;
  if ([401, 402, 403, 404, 409, 423, 429].includes(status)) {
    return { state: 'unavailable', reason: `http_${status}`, status };
  }
  return { state: 'unknown', reason: status ? `http_${status}` : clean(error?.code || error?.message || 'probe_error', 120), status: status || undefined };
}

function vivyProbeForBundle(bundle = {}) {
  const provider = clean(bundle.provider, 40).toLowerCase();
  const baseURL = clean(bundle.baseURL, 300).replace(/\/$/, '');

  if (provider === 'ollama') {
    return async (_provider, options = {}) => {
      if (!baseURL) return { state: 'unknown', reason: 'missing_base_url' };
      const response = await fetchProbe(`${baseURL}/api/tags`, options);
      if (!response) return { state: 'unknown', reason: 'probe_timeout' };
      if (response.ok) return { state: 'available', reason: `http_${response.status}`, status: response.status };
      if ([404, 423, 429].includes(response.status)) {
        return { state: 'unavailable', reason: `http_${response.status}`, status: response.status };
      }
      return { state: 'unknown', reason: `http_${response.status}`, status: response.status };
    };
  }

  if (provider === 'ollama_cloud') {
    // The custom Vivy Ollama Cloud wrapper deliberately keeps the bearer inside
    // its closure and exposes no cheap authenticated metadata method. Ringing it
    // anonymously would manufacture a false 401, so keep it fail-open.
    return async () => ({ state: 'unknown', reason: 'authenticated_probe_not_exposed' });
  }

  const countTokens = bundle?.client?.models?.countTokens;
  if (typeof countTokens === 'function') {
    return async (_provider, options = {}) => {
      const model = clean(bundle.model, 160);
      if (!model) return { state: 'unknown', reason: 'missing_model' };
      try {
        const result = await timeoutResult(
          Promise.resolve(bundle.client.models.countTokens({
            model,
            contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
          })),
          options.timeoutMs
        );
        if (result?.doorbellTimeout) return { state: 'unknown', reason: 'probe_timeout' };
        return { state: 'available', reason: 'authenticated_count_tokens_ok' };
      } catch (error) {
        return classifyAuthenticatedError(error);
      }
    };
  }

  const modelsList = bundle?.client?.models?.list;
  if (typeof modelsList === 'function') {
    return async (_provider, options = {}) => {
      try {
        const result = await timeoutResult(
          Promise.resolve(bundle.client.models.list({ limit: 1 }, { maxRetries: 0 })),
          options.timeoutMs
        );
        if (result?.doorbellTimeout) return { state: 'unknown', reason: 'probe_timeout' };
        return { state: 'available', reason: 'authenticated_models_ok' };
      } catch (error) {
        return classifyAuthenticatedError(error);
      }
    };
  }

  return async () => ({ state: 'unknown', reason: 'authenticated_probe_not_exposed' });
}

function toDoorbellProvider(bundle = {}) {
  return {
    provider: clean(bundle.provider || 'unknown', 40),
    baseURL: clean(bundle.baseURL, 300),
    model: clean(bundle.model, 160),
    probe: vivyProbeForBundle(bundle),
  };
}

async function emitHorn(horn, event, payload) {
  if (!horn) return;
  if (typeof horn === 'function') {
    await horn(event, payload);
    return;
  }
  if (typeof horn.scream === 'function') await horn.scream(event, payload);
}

async function preflightVivyBundles(bundles = [], options = {}) {
  const source = Array.isArray(bundles) ? bundles : [];
  if (!source.length) return { bundles: source, report: null };
  const providers = source.map(toDoorbellProvider);
  const report = await ringProviders(providers, {
    timeoutMs: Math.max(100, Math.min(5000, Number(options.timeoutMs || 1200) || 1200)),
  });
  const keptProviders = filterProvidersByDoorbell(providers, report);
  const keptKeys = new Set(keptProviders.map((provider) => `${provider.provider}|${provider.baseURL}|${provider.model}`));
  const keptBundles = source.filter((bundle) => keptKeys.has(
    `${clean(bundle.provider || 'unknown', 40)}|${clean(bundle.baseURL, 300)}|${clean(bundle.model, 160)}`
  ));

  const safeReport = {
    policy: report.policy,
    checkedAt: report.checkedAt,
    timeoutMs: report.timeoutMs,
    results: report.results.map((entry) => ({
      provider: entry.provider,
      model: entry.model,
      state: entry.state,
      reason: entry.reason,
      status: entry.status,
      latencyMs: entry.latencyMs,
    })),
  };

  await emitHorn(options.horn, 'vivy.provider-doorbell.checked', safeReport).catch(() => {});
  return {
    bundles: keptBundles.length ? keptBundles : source,
    report: safeReport,
  };
}

module.exports = {
  preflightVivyBundles,
  toDoorbellProvider,
  vivyProbeForBundle,
};
