const TARGET_ORIGIN = String(process.env.A11_PROXY_TARGET_ORIGIN || 'https://a11.funesterie.me').replace(/\/+$/, '');

function normalizeProxyPath(eventPath = '') {
  const rawPath = String(eventPath || '').replace(/\\/g, '/');
  const marker = '/.netlify/functions/a11-proxy';
  const markerIndex = rawPath.indexOf(marker);
  const stripped = markerIndex >= 0
    ? rawPath.slice(markerIndex + marker.length)
    : rawPath;
  const normalized = stripped.startsWith('/') ? stripped : `/${stripped}`;
  return normalized === '/' ? '/health' : normalized;
}

function buildTargetUrl(event) {
  const path = normalizeProxyPath(event.path);
  const query = event.rawQuery ? `?${event.rawQuery}` : '';
  return `${TARGET_ORIGIN}${path}${query}`;
}

function buildProxyHeaders(eventHeaders = {}) {
  const blocked = new Set([
    'host',
    'connection',
    'content-length',
    'accept-encoding',
    'x-forwarded-host',
    'x-forwarded-proto',
  ]);
  const headers = {};
  for (const [key, value] of Object.entries(eventHeaders || {})) {
    const normalizedKey = String(key || '').toLowerCase();
    if (!normalizedKey || blocked.has(normalizedKey) || value === undefined || value === null) continue;
    headers[key] = String(value);
  }
  return headers;
}

function shouldEncodeBase64(contentType = '') {
  const normalized = String(contentType || '').toLowerCase();
  if (!normalized) return false;
  return !(
    normalized.startsWith('text/')
    || normalized.includes('json')
    || normalized.includes('javascript')
    || normalized.includes('xml')
    || normalized.includes('svg')
  );
}

function splitSetCookieHeader(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw
    .split(/,(?=\s*[^;,=\s]+=[^;]+)/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

exports.handler = async function handler(event) {
  const targetUrl = buildTargetUrl(event);
  const headers = buildProxyHeaders(event.headers);
  const method = String(event.httpMethod || 'GET').toUpperCase();
  const hasBody = !['GET', 'HEAD'].includes(method) && event.body;
  const body = hasBody
    ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8')
    : undefined;

  const upstream = await fetch(targetUrl, {
    method,
    headers,
    body,
    redirect: 'manual',
  });

  const responseHeaders = {};
  const setCookieHeaders = typeof upstream.headers.getSetCookie === 'function'
    ? upstream.headers.getSetCookie()
    : [];
  upstream.headers.forEach((value, key) => {
    const normalizedKey = String(key || '').toLowerCase();
    if (['connection', 'content-length', 'transfer-encoding', 'content-encoding'].includes(normalizedKey)) return;
    if (normalizedKey === 'set-cookie') {
      if (!setCookieHeaders.length) {
        setCookieHeaders.push(...splitSetCookieHeader(value));
      }
      return;
    }
    responseHeaders[key] = value;
  });

  responseHeaders['access-control-allow-origin'] = '*';
  const contentType = upstream.headers.get('content-type') || '';
  const base64 = shouldEncodeBase64(contentType);
  const buffer = Buffer.from(await upstream.arrayBuffer());

  const result = {
    statusCode: upstream.status,
    headers: responseHeaders,
    body: base64 ? buffer.toString('base64') : buffer.toString('utf8'),
    isBase64Encoded: base64,
  };
  if (setCookieHeaders.length) {
    result.multiValueHeaders = {
      'set-cookie': setCookieHeaders,
    };
  }
  return result;
};
