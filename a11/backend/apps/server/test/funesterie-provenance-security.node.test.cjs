'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');

const {
  parseAdditionalSources,
  buildBrowserEgressDirectives,
  appendCspReport,
} = require('../src/security/browser-egress-policy.cjs');
const {
  parseUrls,
  appendEvidenceRecord,
} = require('../scripts/monitor-domain-evidence.cjs');

test('browser egress policy blocks arbitrary origins and keeps explicit HTTPS allowlists', () => {
  assert.deepEqual(parseAdditionalSources('http://bad.test ftp://bad.test https://api.example.test wss://ws.example.test/path'), [
    'https://api.example.test',
  ]);
  const directives = buildBrowserEgressDirectives({
    A11_BROWSER_CONNECT_SRC: 'https://api.example.test wss://ws.example.test',
  });
  assert.ok(directives.connectSrc.includes("'self'"));
  assert.ok(directives.connectSrc.includes('https://api.example.test'));
  assert.ok(directives.connectSrc.includes('wss://ws.example.test'));
  assert.deepEqual(directives.objectSrc, ["'none'"]);
  assert.deepEqual(directives.frameAncestors, ["'none'"]);
  assert.ok(directives.formAction.includes("'self'"));
  assert.ok(!directives.connectSrc.includes('https:'));
  assert.ok(!directives.imgSrc.includes('https:'));
  assert.ok(!directives.mediaSrc.includes('https:'));
});

test('Helmet emits the enforced browser egress policy as a CSP response header', async () => {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: { directives: buildBrowserEgressDirectives({}) } }));
  app.get('/', (_req, res) => res.send('ok'));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    const csp = response.headers.get('content-security-policy') || '';
    assert.match(csp, /connect-src 'self' https:\/\/funesterie\.me/);
    assert.match(csp, /form-action 'self'/);
    assert.match(csp, /report-uri \/api\/security\/csp-report/);
    assert.doesNotMatch(csp, /connect-src[^;]* https:(?:;|$)/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('CSP reports remove query strings and are written to a private JSONL evidence log', () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'funesterie-csp-'));
  try {
    const result = appendCspReport({
      'csp-report': {
        'document-uri': 'https://funesterie.me/studio?token=secret',
        'blocked-uri': 'https://evil.test/collect?payload=secret',
        'effective-directive': 'connect-src',
      },
    }, { runtimeRoot });
    const logged = JSON.parse(fs.readFileSync(result.logPath, 'utf8'));
    assert.equal(logged.documentUri, 'https://funesterie.me/studio');
    assert.equal(logged.blockedUri, 'https://evil.test/collect');
    assert.equal(logged.effectiveDirective, 'connect-src');
    assert.doesNotMatch(fs.readFileSync(result.logPath, 'utf8'), /secret/);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test('domain monitor accepts HTTPS only and chains evidence records', () => {
  assert.throws(() => parseUrls('http://example.test/'), /monitor_url_forbidden/);
  assert.throws(() => parseUrls('https://user:pass@example.test/'), /monitor_url_forbidden/);
  assert.deepEqual(parseUrls('https://example.test/a?secret=1'), ['https://example.test/a?secret=1']);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'funesterie-domain-monitor-'));
  const logPath = path.join(dir, 'evidence.jsonl');
  try {
    const first = appendEvidenceRecord(logPath, { checkedAt: '2026-08-11T17:00:00.000Z', target: 'https://example.test/' });
    const second = appendEvidenceRecord(logPath, { checkedAt: '2026-08-11T17:01:00.000Z', target: 'https://example.test/' });
    assert.equal(first.previousEntryHash, null);
    assert.equal(second.previousEntryHash, first.entryHash);
    assert.notEqual(second.entryHash, first.entryHash);
    assert.equal(fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
