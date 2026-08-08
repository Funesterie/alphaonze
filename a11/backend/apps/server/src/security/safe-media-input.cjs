'use strict';

const dns = require('node:dns/promises');
const fs = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_MAX_REDIRECTS = 4;

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parsePositiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeContentType(value = '') {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function splitList(value = '') {
  return String(value || '')
    .split(/[;,\n]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function hostnameMatchesAllowlist(hostname, allowlist = []) {
  if (!allowlist.length) return true;
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  return allowlist.some((entry) => {
    const rule = String(entry || '').trim().toLowerCase().replace(/\.$/, '');
    if (!rule) return false;
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1);
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === rule;
  });
}

function ipv4ToNumber(value) {
  const parts = String(value || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function ipv4InCidr(value, base, bits) {
  const address = ipv4ToNumber(value);
  const network = ipv4ToNumber(base);
  if (address === null || network === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) === (network & mask);
}

function expandIpv6Words(value = '') {
  let address = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%', 1)[0];
  if (!net.isIP(address) || net.isIP(address) !== 6) return null;
  const dotted = address.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const ipv4 = ipv4ToNumber(dotted[1]);
    if (ipv4 === null) return null;
    address = `${address.slice(0, dotted.index + 1)}${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const words = [...left, ...Array(missing).fill('0'), ...right].map((word) => Number.parseInt(word || '0', 16));
  return words.length === 8 && words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? words
    : null;
}

function embeddedIpv4(words, startWord = 6) {
  if (!Array.isArray(words) || words.length !== 8) return '';
  const value = ((words[startWord] << 16) | words[startWord + 1]) >>> 0;
  return `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}

function isBlockedIpAddress(value = '') {
  const address = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const family = net.isIP(address);
  if (family === 4) {
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([base, bits]) => ipv4InCidr(address, base, bits));
  }
  if (family === 6) {
    const words = expandIpv6Words(address);
    if (!words) return true;
    const allBeforeLast = words.slice(0, 7).every((word) => word === 0);
    if (allBeforeLast && (words[7] === 0 || words[7] === 1)) return true;
    if ((words[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((words[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((words[0] & 0xffc0) === 0xfec0) return true; // deprecated fec0::/10 site-local
    if ((words[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (words[0] === 0x2001 && [0x0000, 0x0002, 0x0db8].includes(words[1])) return true;

    const firstFiveZero = words.slice(0, 5).every((word) => word === 0);
    if (firstFiveZero && words[5] === 0xffff) return isBlockedIpAddress(embeddedIpv4(words));
    const firstSixZero = words.slice(0, 6).every((word) => word === 0);
    if (firstSixZero) return true; // deprecated IPv4-compatible space; never needed for public media
    if (words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0)) {
      return isBlockedIpAddress(embeddedIpv4(words)); // NAT64 well-known prefix
    }
    if (words[0] === 0x2002) return isBlockedIpAddress(embeddedIpv4(words, 1)); // 6to4 embedded IPv4
    return false;
  }
  return true;
}

async function resolveSafeRemoteUrl(value, {
  allowHttp = false,
  allowedHosts = [],
  lookupImpl = dns.lookup,
} = {}) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('media_url_invalid');
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('media_url_protocol_forbidden');
  if (url.protocol === 'http:' && !allowHttp) throw new Error('media_url_http_forbidden');
  if (url.username || url.password) throw new Error('media_url_credentials_forbidden');
  if (!url.hostname || ['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase())) {
    throw new Error('media_url_private_host_forbidden');
  }
  if (!hostnameMatchesAllowlist(url.hostname, allowedHosts)) throw new Error('media_url_host_forbidden');

  const normalizedHostname = url.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = net.isIP(normalizedHostname);
  const addresses = literalFamily
    ? [{ address: normalizedHostname, family: literalFamily }]
    : await lookupImpl(url.hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error('media_url_dns_empty');
  if (addresses.some((entry) => isBlockedIpAddress(entry?.address))) {
    throw new Error('media_url_private_address_forbidden');
  }
  return { url, addresses: addresses.map((entry) => ({ address: entry.address, family: Number(entry.family) || net.isIP(entry.address) })) };
}

async function assertSafeRemoteUrl(value, options = {}) {
  return (await resolveSafeRemoteUrl(value, options)).url;
}

function assertAllowedContentType(contentType, allowedContentTypes = []) {
  const normalized = normalizeContentType(contentType);
  if (!normalized) throw new Error('media_content_type_missing');
  const allowed = allowedContentTypes.some((rule) => {
    const value = String(rule || '').toLowerCase();
    return value.endsWith('/*') ? normalized.startsWith(value.slice(0, -1)) : normalized === value;
  });
  if (!allowed) throw new Error('media_content_type_forbidden');
  return normalized;
}

async function readResponseBodyLimited(response, maxBytes) {
  const contentLength = Number(response?.headers?.get?.('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('media_payload_too_large');

  const chunks = [];
  let total = 0;
  const append = (chunk) => {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error('media_payload_too_large');
    chunks.push(buffer);
  };

  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        append(value);
      }
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      throw error;
    }
  } else if (response?.body && Symbol.asyncIterator in Object(response.body)) {
    for await (const chunk of response.body) append(chunk);
  } else if (typeof response?.arrayBuffer === 'function') {
    append(await response.arrayBuffer());
  } else {
    throw new Error('media_response_body_unavailable');
  }
  return Buffer.concat(chunks, total);
}

function requestRemoteMediaPinned(url, addresses, {
  allowedContentTypes,
  maxBytes,
  timeoutMs,
  userAgent,
} = {}) {
  const candidates = Array.isArray(addresses) ? addresses : [];
  let index = 0;
  const attempt = () => new Promise((resolve, reject) => {
    const selected = candidates[index];
    if (!selected) return reject(new Error('media_url_dns_empty'));
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: 'GET',
      // Never share the global pool: a socket cached under the hostname could
      // otherwise bypass the validated/pinned lookup after DNS rebinding.
      agent: false,
      headers: { 'User-Agent': userAgent, Accept: allowedContentTypes.join(', ') || '*/*' },
      lookup(_hostname, lookupOptions, callback) {
        if (lookupOptions?.all) callback(null, [{ address: selected.address, family: selected.family }]);
        else callback(null, selected.address, selected.family);
      },
      servername: url.hostname.replace(/^\[|\]$/g, ''),
    }, (response) => {
      const status = Number(response.statusCode || 0);
      const headers = {
        get(name) {
          const raw = response.headers[String(name || '').toLowerCase()];
          return Array.isArray(raw) ? raw[0] : (raw == null ? null : String(raw));
        },
      };
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        resolve({ status, ok: false, headers, buffer: null });
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        resolve({ status, ok: false, headers, buffer: null });
        return;
      }
      let contentType;
      try {
        contentType = assertAllowedContentType(headers.get('content-type'), allowedContentTypes);
        const contentLength = Number(headers.get('content-length') || 0);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('media_payload_too_large');
      } catch (error) {
        response.destroy();
        reject(error);
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          request.destroy(new Error('media_payload_too_large'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.once('end', () => resolve({ status, ok: true, headers, contentType, buffer: Buffer.concat(chunks, total) }));
      response.once('error', reject);
    });
    request.setTimeout(parsePositiveInteger(timeoutMs, 20_000, 1_000, 120_000), () => {
      request.destroy(new Error('media_download_timeout'));
    });
    const deadline = setTimeout(() => {
      request.destroy(new Error('media_download_timeout'));
    }, parsePositiveInteger(timeoutMs, 20_000, 1_000, 120_000));
    deadline.unref?.();
    request.once('close', () => clearTimeout(deadline));
    request.once('error', (error) => {
      const message = String(error?.message || '');
      const retryable = (message === 'media_download_timeout' || !message.startsWith('media_'))
        && index + 1 < candidates.length;
      if (retryable) {
        index += 1;
        attempt().then(resolve, reject);
      } else reject(error);
    });
    request.end();
  });
  return attempt();
}

async function downloadRemoteMedia(value, {
  fetchImpl,
  lookupImpl = dns.lookup,
  allowHttp = false,
  allowedHosts = [],
  allowedContentTypes = [],
  maxBytes,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  timeoutMs = 20_000,
  userAgent = 'A11-SafeMedia/1.0',
} = {}) {
  let current = String(value || '').trim();
  const redirects = parsePositiveInteger(maxRedirects, DEFAULT_MAX_REDIRECTS, 0, 8);
  for (let hop = 0; hop <= redirects; hop += 1) {
    const resolved = await resolveSafeRemoteUrl(current, { allowHttp, allowedHosts, lookupImpl });
    const { url } = resolved;
    if (typeof fetchImpl !== 'function') {
      const response = await requestRemoteMediaPinned(url, resolved.addresses, {
        allowedContentTypes,
        maxBytes,
        timeoutMs,
        userAgent,
      });
      if ([301, 302, 303, 307, 308].includes(Number(response.status))) {
        const location = response.headers.get('location');
        if (!location) throw new Error('media_redirect_location_missing');
        if (hop >= redirects) throw new Error('media_redirect_limit_exceeded');
        current = new URL(location, url).toString();
        continue;
      }
      if (!response.ok) throw new Error(`media_download_${Number(response.status) || 'failed'}`);
      return { buffer: response.buffer, contentType: response.contentType, finalUrl: url.toString() };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), parsePositiveInteger(timeoutMs, 20_000, 1_000, 120_000));
    timer.unref?.();
    try {
      const response = await fetchImpl(url.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': userAgent, Accept: allowedContentTypes.join(', ') || '*/*' },
      });
      if ([301, 302, 303, 307, 308].includes(Number(response?.status))) {
        const location = response?.headers?.get?.('location');
        if (!location) throw new Error('media_redirect_location_missing');
        if (hop >= redirects) throw new Error('media_redirect_limit_exceeded');
        current = new URL(location, url).toString();
        continue;
      }
      if (!response?.ok) throw new Error(`media_download_${Number(response?.status) || 'failed'}`);
      const contentType = assertAllowedContentType(response.headers?.get?.('content-type'), allowedContentTypes);
      return {
        buffer: await readResponseBodyLimited(response, maxBytes),
        contentType,
        finalUrl: url.toString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('media_redirect_limit_exceeded');
}

function decodeDataUrl(value, { allowedContentTypes = [], maxBytes }) {
  const match = String(value || '').match(/^data:([^;,]+)?((?:;[^,]*)*),(.*)$/is);
  if (!match) throw new Error('media_data_url_invalid');
  const contentType = assertAllowedContentType(match[1] || '', allowedContentTypes);
  const isBase64 = /;base64(?:;|$)/i.test(match[2] || '');
  const encoded = match[3] || '';
  if (encoded.length > Math.ceil(maxBytes * 1.5) + 16) throw new Error('media_payload_too_large');
  let buffer;
  try {
    buffer = isBase64 ? Buffer.from(encoded, 'base64') : Buffer.from(decodeURIComponent(encoded), 'utf8');
  } catch {
    throw new Error('media_data_url_invalid');
  }
  if (buffer.length > maxBytes) throw new Error('media_payload_too_large');
  return { buffer, contentType };
}

function resolveAllowedLocalRoots(env = process.env) {
  const configured = String(env.A11_VIDEO_REFERENCE_ROOTS || '').split(path.delimiter).map((item) => item.trim()).filter(Boolean);
  if (configured.length) return configured.map((item) => path.resolve(item));
  return [
    path.resolve(env.A11_RUNTIME_ROOT || path.join(process.cwd(), 'runtime')),
    path.resolve(os.tmpdir(), 'a11-media-input'),
  ];
}

async function readLocalMedia(value, {
  allowedRoots = resolveAllowedLocalRoots(),
  allowedExtensions = [],
  maxBytes,
} = {}) {
  const target = await fs.realpath(path.resolve(String(value || ''))).catch(() => null);
  if (!target) throw new Error('media_local_file_missing');
  const roots = await Promise.all(allowedRoots.map(async (root) => fs.realpath(path.resolve(root)).catch(() => path.resolve(root))));
  const inside = roots.some((root) => target === root || target.startsWith(`${root}${path.sep}`));
  if (!inside) throw new Error('media_local_path_forbidden');
  const extension = path.extname(target).toLowerCase();
  if (!allowedExtensions.map((item) => String(item).toLowerCase()).includes(extension)) {
    throw new Error('media_local_extension_forbidden');
  }
  const stats = await fs.stat(target);
  if (!stats.isFile()) throw new Error('media_local_file_required');
  if (stats.size > maxBytes) throw new Error('media_payload_too_large');
  return { buffer: await fs.readFile(target), path: target, extension };
}

module.exports = {
  assertSafeRemoteUrl,
  decodeDataUrl,
  downloadRemoteMedia,
  hostnameMatchesAllowlist,
  isBlockedIpAddress,
  normalizeContentType,
  parseBoolean,
  parsePositiveInteger,
  readLocalMedia,
  readResponseBodyLimited,
  resolveSafeRemoteUrl,
  resolveAllowedLocalRoots,
  splitList,
};
