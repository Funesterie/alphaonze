'use strict';

// Regression 28/07/2026 : le garde de redirection ré-appliquait l'allowlist
// d'origine sur la CIBLE. Suno redirige vers un CDN hors-liste -> materialisation
// refusée -> chansons figées + clips en échec. Le correctif : garder la détection
// d'origine sur la source, ne bloquer que les cibles dangereuses (SSRF).

const test = require('node:test');
const assert = require('node:assert');

const {
  isSafeVivyRedirectTarget,
  isPrivateOrReservedHost,
} = require('../src/routes/vivy-studio.cjs');

test('un CDN public https (cible de redirection Suno) est autorisé', () => {
  // Le coeur du bug : ces hosts ne sont PAS dans l'allowlist d'origine, mais
  // sont des CDN publics légitimes vers lesquels Suno redirige.
  assert.strictEqual(isSafeVivyRedirectTarget('https://cdn1.suno-cdn.example/r/abc.mp3'), true);
  assert.strictEqual(isSafeVivyRedirectTarget('https://d2ab3c.cloudfront.net/x/y.mp3'), true);
  assert.strictEqual(isSafeVivyRedirectTarget('https://storage.googleapis.com/suno/track.mp3'), true);
});

test('les hosts Suno connus restent évidemment autorisés', () => {
  assert.strictEqual(isSafeVivyRedirectTarget('https://tempfile.aiquickdraw.com/r/a.mp3'), true);
  assert.strictEqual(isSafeVivyRedirectTarget('https://musicfile.removeai.ai/abc'), true);
  assert.strictEqual(isSafeVivyRedirectTarget('https://audiopipe.suno.ai/item.mp3'), true);
});

test('une redirection non-https est refusée', () => {
  assert.strictEqual(isSafeVivyRedirectTarget('http://cdn.example/track.mp3'), false);
  assert.strictEqual(isSafeVivyRedirectTarget('file:///etc/passwd'), false);
});

test('une redirection avec identifiants dans l URL est refusée', () => {
  assert.strictEqual(isSafeVivyRedirectTarget('https://user:pass@cdn.example/track.mp3'), false);
});

test('SSRF : aucune redirection vers une adresse interne/privée', () => {
  for (const url of [
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://169.254.169.254/latest/meta-data',
    'https://172.16.0.1/x',
    'https://192.168.1.1/x',
    'https://100.64.0.1/x',
    'https://metadata.internal/x',
    'https://[::1]/x',
    'https://[fe80::1]/x',
  ]) {
    assert.strictEqual(isSafeVivyRedirectTarget(url), false, `devrait refuser ${url}`);
  }
});

test('isPrivateOrReservedHost : IP publiques acceptées, privées bloquées', () => {
  assert.strictEqual(isPrivateOrReservedHost('8.8.8.8'), false);
  assert.strictEqual(isPrivateOrReservedHost('1.1.1.1'), false);
  assert.strictEqual(isPrivateOrReservedHost('192.168.0.10'), true);
  assert.strictEqual(isPrivateOrReservedHost('10.1.2.3'), true);
  assert.strictEqual(isPrivateOrReservedHost('172.20.0.1'), true);
  assert.strictEqual(isPrivateOrReservedHost('172.15.0.1'), false); // hors plage privée
  assert.strictEqual(isPrivateOrReservedHost('999.1.1.1'), true); // malformé -> refusé
});

test('une valeur vide ou cassée est refusée', () => {
  assert.strictEqual(isSafeVivyRedirectTarget(''), false);
  assert.strictEqual(isSafeVivyRedirectTarget('pas une url'), false);
});
