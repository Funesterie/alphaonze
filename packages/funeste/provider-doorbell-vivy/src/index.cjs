'use strict';

const {
  filterProvidersByDoorbell,
  ringProviders,
} = require('@nossen/provider-doorbell');

function clean(value, max = 240) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

async function fetchProbe(url, options = {}) {
  const timeoutMs = Math.max(100, Math.min(5000, Number(options.timeoutMs || 1200) || 1200));
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: options.headers || {},
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

function vivyProbeForBundle(bundle = {}) {
  const provider = clean(bundle.provider, 40).toLowerCase();
  const baseURL = clean(bundle.baseURL, 300).replace(/\/$/, '');
  const apiKey = bundle.apiKey;

  if (provider === 'ollama' || provider === 'ollama_cloud') {
    return async (_provider, options = {}) => {
      if (!baseURL) return { state: 'unknown', reason: 'missing_base_url' };
      const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const response = await fetchProbe(`${baseURL}/api/tags`, { ...options, headers });
      if (!response) return { state: 'unknown', reason: 'probe_timeout' };
      if (response.ok) return { state: 'available', reason: `http_${response.status}`, status: response.status };
      if ([401, 402, 403, 404, 423, 429].includes(response.status)) {
        return { state: 'unavailable', reason: `http_${response.status}`, status: response.status };
      }
      return { state: 'unknown', reason: `http_${response.status}`, status: response.status };
    };
  }

  return undefined;
}

function toDoorbellProvider(bundle = {}) {
  return {
    provider: clean(bundle.provider || 'unknown', 40),
    baseURL: clean(bundle.baseURL, 300),
    model: clean(bundle.model, 160),
    apiKey: bundle.apiKey,
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
