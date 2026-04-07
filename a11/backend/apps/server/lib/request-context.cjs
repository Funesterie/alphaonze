const crypto = require('node:crypto');

function getHeaderValue(headers = {}, name = '') {
  if (!headers || !name) return '';
  const direct = headers[name];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const lowerName = String(name).toLowerCase();
  const matchedKey = Object.keys(headers).find((key) => String(key || '').toLowerCase() === lowerName);
  if (!matchedKey) return '';
  const value = headers[matchedKey];
  return typeof value === 'string' ? value.trim() : '';
}

function resolveRequestId(reqOrHeaders = null) {
  const headers = reqOrHeaders?.headers && typeof reqOrHeaders.headers === 'object'
    ? reqOrHeaders.headers
    : (reqOrHeaders && typeof reqOrHeaders === 'object' ? reqOrHeaders : {});

  return (
    getHeaderValue(headers, 'x-request-id')
    || getHeaderValue(headers, 'x-correlation-id')
    || crypto.randomUUID()
  );
}

function attachRequestId(res, requestId) {
  const resolved = String(requestId || '').trim() || crypto.randomUUID();
  if (res && typeof res.setHeader === 'function') {
    res.setHeader('X-Request-Id', resolved);
  }
  return resolved;
}

function ensureRequestId(req, res) {
  const existing = String(req?.requestId || '').trim();
  const requestId = existing || resolveRequestId(req);
  if (req && typeof req === 'object') {
    req.requestId = requestId;
  }
  attachRequestId(res, requestId);
  return requestId;
}

function truncateText(value, maxLength = 2000) {
  const text = String(value ?? '');
  if (!text) return '';
  const normalizedMaxLength = Math.max(32, Number(maxLength || 2000));
  if (text.length <= normalizedMaxLength) {
    return text;
  }
  return `${text.slice(0, normalizedMaxLength)}...`;
}

module.exports = {
  attachRequestId,
  ensureRequestId,
  resolveRequestId,
  truncateText,
};
