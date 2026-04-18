const crypto = require('node:crypto');
const { truncateText } = require('./request-context.cjs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyErr(err) {
  const message = String(err?.message || err || '');
  const code = String(err?.code || err?.cause?.code || '');
  const isTimeout = code === 'ABORT_ERR' || /timeout|aborted/i.test(message);
  const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN';
  const isConn = code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH';
  return {
    code,
    isTimeout,
    isDns,
    isConn,
    message,
  };
}

function createTimeoutContext(timeoutMs, externalSignal) {
  if (externalSignal) {
    return {
      signal: externalSignal,
      cleanup() {},
    };
  }

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return {
      signal: AbortSignal.timeout(timeoutMs),
      cleanup() {},
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
    },
  };
}

async function fetchJsonWithRetry(url, options = {}, {
  timeoutMs = 15000,
  retries = 2,
  backoffBaseMs = 250,
  requestId = crypto.randomUUID(),
  logger = console,
} = {}) {
  const normalizedUrl = String(url || '').trim();

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const startedAt = Date.now();
    const timeoutContext = createTimeoutContext(timeoutMs, options.signal);

    try {
      const response = await fetch(normalizedUrl, {
        ...options,
        signal: timeoutContext.signal,
        headers: {
          ...(options.headers || {}),
          'X-Request-Id': requestId,
        },
      });

      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      const payload = {
        ok: response.ok,
        status: response.status,
        data,
        text: truncateText(text, 2000),
        requestId,
        url: normalizedUrl,
        ms: Date.now() - startedAt,
        timeoutMs,
      };

      if (response.ok) {
        return payload;
      }

      const retryableStatus = [408, 502, 503, 504, 524].includes(response.status);
      if (!retryableStatus || attempt === retries) {
        return payload;
      }

      logger.warn?.(JSON.stringify({
        level: 'warn',
        msg: 'fetchJsonWithRetry retryable HTTP status',
        requestId,
        attempt,
        status: response.status,
        url: normalizedUrl,
      }));
    } catch (err) {
      const info = classifyErr(err);
      const payload = {
        ok: false,
        status: info.isTimeout ? 504 : 0,
        data: null,
        text: truncateText(info.message, 2000),
        err: info,
        requestId,
        url: normalizedUrl,
        ms: Date.now() - startedAt,
        timeoutMs,
      };
      const retryable = info.isTimeout || info.isDns || info.isConn;
      if (!retryable || attempt === retries) {
        return payload;
      }

      logger.warn?.(JSON.stringify({
        level: 'warn',
        msg: 'fetchJsonWithRetry retryable network error',
        requestId,
        attempt,
        err: info,
        url: normalizedUrl,
      }));
    } finally {
      timeoutContext.cleanup();
    }

    const delay = backoffBaseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 125);
    await sleep(delay);
  }

  return {
    ok: false,
    status: 502,
    data: null,
    text: 'Unknown upstream error',
    requestId,
    url: normalizedUrl,
    timeoutMs,
  };
}

function createUpstreamHttpError(result, {
  error = 'upstream_unreachable',
  message = 'Upstream request failed',
} = {}) {
  const upstream = result?.upstream && typeof result.upstream === 'object'
    ? result.upstream
    : {
        url: result?.url || null,
        status: Number.isFinite(Number(result?.status)) ? Number(result.status) : null,
        body: truncateText(result?.text || '', 2000) || null,
        timeoutMs: Number.isFinite(Number(result?.timeoutMs)) ? Number(result.timeoutMs) : null,
        networkError: result?.err || null,
      };

  const upstreamStatus = Number.isFinite(Number(upstream.status)) ? Number(upstream.status) : 0;
  const gatewayStatus = upstreamStatus >= 400 ? 502 : (result?.err?.isTimeout ? 504 : 502);
  const err = new Error(String(message || result?.text || 'Upstream request failed'));
  err.name = 'UpstreamHttpError';
  err.error = String(error || 'upstream_unreachable');
  err.status = gatewayStatus;
  err.requestId = String(result?.requestId || '').trim() || null;
  err.upstream = upstream;
  return err;
}

module.exports = {
  createUpstreamHttpError,
  fetchJsonWithRetry,
};
