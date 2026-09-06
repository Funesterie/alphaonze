'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONNECT_ORIGINS = [
  'https://funesterie.me',
  'https://*.funesterie.me',
  'wss://*.funesterie.me',
  'https://accounts.google.com',
  'https://oauth2.googleapis.com',
  'https://www.googleapis.com',
  'https://api.stripe.com',
];

function parseAdditionalSources(value = '') {
  return String(value || '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => /^https:\/\/[a-z0-9.*-]+(?::\d+)?$/i.test(entry) || /^wss:\/\/[a-z0-9.*-]+(?::\d+)?$/i.test(entry));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function buildBrowserEgressDirectives(env = process.env) {
  const connectSrc = unique([
    "'self'",
    ...DEFAULT_CONNECT_ORIGINS,
    ...parseAdditionalSources(env.A11_BROWSER_CONNECT_SRC),
  ]);
  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    formAction: [
      "'self'",
      'https://accounts.google.com',
      'https://checkout.stripe.com',
      'https://www.paypal.com',
      ...parseAdditionalSources(env.A11_BROWSER_FORM_ACTION_SRC),
    ],
    connectSrc,
    scriptSrc: [
      "'self'",
      "'unsafe-inline'",
      'https://accounts.google.com',
      'https://js.stripe.com',
      'https://www.gstatic.com',
      ...parseAdditionalSources(env.A11_BROWSER_SCRIPT_SRC),
    ],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
    imgSrc: [
      "'self'",
      'data:',
      'blob:',
      'https://funesterie.me',
      'https://*.funesterie.me',
      'https://*.googleusercontent.com',
      ...parseAdditionalSources(env.A11_BROWSER_IMG_SRC),
    ],
    mediaSrc: [
      "'self'",
      'blob:',
      'data:',
      'https://funesterie.me',
      'https://*.funesterie.me',
      ...parseAdditionalSources(env.A11_BROWSER_MEDIA_SRC),
    ],
    frameSrc: [
      "'self'",
      'https://accounts.google.com',
      'https://js.stripe.com',
      'https://hooks.stripe.com',
      'https://www.youtube.com',
      ...parseAdditionalSources(env.A11_BROWSER_FRAME_SRC),
    ],
    workerSrc: ["'self'", 'blob:'],
    manifestSrc: ["'self'"],
    reportUri: ['/api/security/csp-report'],
    upgradeInsecureRequests: [],
  };
}

function sanitizeReportedUrl(value = '') {
  try {
    const url = new URL(String(value || ''));
    return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 1000);
  } catch {
    return String(value || '').replace(/[?#].*$/, '').slice(0, 1000);
  }
}

function normalizeCspReport(payload = {}) {
  const source = payload?.['csp-report'] || payload?.body || payload || {};
  return {
    recordedAt: new Date().toISOString(),
    documentUri: sanitizeReportedUrl(source['document-uri'] || source.documentURL || source.documentUri),
    blockedUri: sanitizeReportedUrl(source['blocked-uri'] || source.blockedURL || source.blockedUri),
    effectiveDirective: String(source['effective-directive'] || source.effectiveDirective || '').slice(0, 160),
    violatedDirective: String(source['violated-directive'] || source.violatedDirective || '').slice(0, 240),
    disposition: String(source.disposition || 'enforce').slice(0, 32),
    statusCode: Number(source['status-code'] || source.statusCode || 0) || 0,
    sourceFile: sanitizeReportedUrl(source['source-file'] || source.sourceFile),
    lineNumber: Number(source['line-number'] || source.lineNumber || 0) || 0,
    columnNumber: Number(source['column-number'] || source.columnNumber || 0) || 0,
  };
}

function appendCspReport(payload, options = {}) {
  const report = normalizeCspReport(payload);
  const runtimeRoot = String(options.runtimeRoot || process.env.A11_RUNTIME_ROOT || path.join(process.cwd(), 'runtime'));
  const evidenceDir = path.join(runtimeRoot, 'security-evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const day = report.recordedAt.slice(0, 10);
  const logPath = path.join(evidenceDir, `csp-violations-${day}.jsonl`);
  fs.appendFileSync(logPath, `${JSON.stringify(report)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { report, logPath };
}

module.exports = {
  DEFAULT_CONNECT_ORIGINS,
  parseAdditionalSources,
  buildBrowserEgressDirectives,
  normalizeCspReport,
  appendCspReport,
};
