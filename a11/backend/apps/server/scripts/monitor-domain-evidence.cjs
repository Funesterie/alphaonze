'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const DEFAULT_URLS = [
  'https://funesterie.me/',
  'https://a11.funesterie.me/health',
  'https://vivy.funesterie.me/',
];
const MAX_CAPTURE_BYTES = 64 * 1024;
const previousHashCache = new Map();

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sanitizeUrl(value = '') {
  try {
    const parsed = new URL(String(value || ''));
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return '';
  }
}

function parseUrls(raw = '') {
  const values = String(raw || '').split(/[\s,]+/).filter(Boolean);
  const urls = values.length ? values : DEFAULT_URLS;
  return [...new Set(urls.map((value) => {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      throw new Error(`monitor_url_forbidden:${parsed.hostname || value}`);
    }
    return parsed.toString();
  }))];
}

async function resolveDns(hostname) {
  const [ipv4, ipv6] = await Promise.all([
    dns.resolve4(hostname, { ttl: true }).catch(() => []),
    dns.resolve6(hostname, { ttl: true }).catch(() => []),
  ]);
  return {
    ipv4: ipv4.map((entry) => ({ address: entry.address, ttl: entry.ttl })),
    ipv6: ipv6.map((entry) => ({ address: entry.address, ttl: entry.ttl })),
  };
}

function requestEvidence(url, options = {}) {
  const timeoutMs = Math.max(1000, Math.min(60_000, Number(options.timeoutMs || 15_000)));
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = https.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Funesterie-Evidence-Monitor/1.0',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.1',
      },
    }, (response) => {
      const peerCertificate = response.socket?.getPeerCertificate?.() || {};
      const chunks = [];
      let capturedBytes = 0;
      let truncated = false;
      response.on('data', (chunk) => {
        if (capturedBytes >= MAX_CAPTURE_BYTES) {
          truncated = true;
          return;
        }
        const slice = chunk.subarray(0, MAX_CAPTURE_BYTES - capturedBytes);
        chunks.push(slice);
        capturedBytes += slice.length;
        if (slice.length < chunk.length) truncated = true;
      });
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        finish({
          ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 400,
          status: Number(response.statusCode || 0),
          durationMs: Date.now() - startedAt,
          server: String(response.headers.server || '').slice(0, 160),
          location: sanitizeUrl(response.headers.location),
          contentType: String(response.headers['content-type'] || '').slice(0, 160),
          contentLength: Number(response.headers['content-length'] || 0) || null,
          capturedBytes: body.length,
          captureTruncated: truncated,
          bodyPrefixSha256: sha256(body),
          tls: {
            subject: String(peerCertificate.subject?.CN || '').slice(0, 255),
            issuer: String(peerCertificate.issuer?.CN || '').slice(0, 255),
            validFrom: String(peerCertificate.valid_from || ''),
            validTo: String(peerCertificate.valid_to || ''),
            fingerprint256: String(peerCertificate.fingerprint256 || ''),
          },
        });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('monitor_timeout')));
    request.on('error', (error) => finish({
      ok: false,
      status: 0,
      durationMs: Date.now() - startedAt,
      error: String(error?.message || error).slice(0, 300),
    }));
    request.end();
  });
}

function readPreviousEntryHash(logPath) {
  if (previousHashCache.has(logPath)) return previousHashCache.get(logPath);
  try {
    const stat = fs.statSync(logPath);
    const tailBytes = Math.min(8192, stat.size);
    const descriptor = fs.openSync(logPath, 'r');
    const buffer = Buffer.alloc(tailBytes);
    try {
      fs.readSync(descriptor, buffer, 0, tailBytes, stat.size - tailBytes);
    } finally {
      fs.closeSync(descriptor);
    }
    const text = buffer.toString('utf8').trim();
    if (!text) return null;
    const hash = JSON.parse(text.split(/\r?\n/).at(-1)).entryHash || null;
    previousHashCache.set(logPath, hash);
    return hash;
  } catch {
    return null;
  }
}

function appendEvidenceRecord(logPath, record) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const chained = { ...record, previousEntryHash: readPreviousEntryHash(logPath) };
  const entryHash = sha256(canonicalJson(chained));
  const finalRecord = { ...chained, entryHash };
  fs.appendFileSync(logPath, `${JSON.stringify(finalRecord)}\n`, { encoding: 'utf8', mode: 0o600 });
  previousHashCache.set(logPath, entryHash);
  return finalRecord;
}

async function monitorOnce(urls, options = {}) {
  const now = new Date().toISOString();
  const outputDir = String(options.outputDir || process.env.FUNESTERIE_EVIDENCE_MONITOR_DIR || path.join(process.env.A11_RUNTIME_ROOT || process.cwd(), 'security-evidence'));
  const logPath = path.join(outputDir, `domain-monitor-${now.slice(0, 10)}.jsonl`);
  const results = [];
  for (const target of urls) {
    const parsed = new URL(target);
    const [dnsResult, httpResult] = await Promise.all([
      resolveDns(parsed.hostname),
      requestEvidence(target, options),
    ]);
    results.push(appendEvidenceRecord(logPath, {
      schema: 'funesterie.domain-evidence.v1',
      checkedAt: now,
      target: sanitizeUrl(target),
      hostname: parsed.hostname,
      dns: dnsResult,
      http: httpResult,
    }));
  }
  return { logPath, results };
}

async function main() {
  const urlsArgIndex = process.argv.indexOf('--urls');
  const rawUrls = urlsArgIndex >= 0 ? process.argv[urlsArgIndex + 1] : process.env.FUNESTERIE_EVIDENCE_MONITOR_URLS;
  const urls = parseUrls(rawUrls);
  const intervalMs = Math.max(60_000, Number(process.env.FUNESTERIE_EVIDENCE_MONITOR_INTERVAL_MS || 60_000));
  do {
    const result = await monitorOnce(urls);
    for (const entry of result.results) {
      console.log(JSON.stringify({ target: entry.target, ok: entry.http.ok, status: entry.http.status, checkedAt: entry.checkedAt, entryHash: entry.entryHash }));
    }
    if (!process.argv.includes('--loop')) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (true);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[domain-evidence] ${String(error?.message || error).slice(0, 300)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_URLS,
  parseUrls,
  requestEvidence,
  appendEvidenceRecord,
  monitorOnce,
};
