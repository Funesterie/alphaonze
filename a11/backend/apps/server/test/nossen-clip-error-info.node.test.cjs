'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Dépendance-free : on ne requiert QUE le module pur (pas d'express).
const { buildClipErrorInfo, DEFAULT_NODE_TYPE } = require('../src/clips/clip-error-info.cjs');

test('buildClipErrorInfo extrait le node_type du préfixe de code', () => {
  const info = buildClipErrorInfo('clip_video_generation_failed: API key is invalid or expired');
  assert.equal(info.node_type, 'clip_video_generation_failed');
  assert.match(info.message, /API key is invalid or expired/);
});

test('buildClipErrorInfo retombe sur clip_generation_failed sans préfixe', () => {
  const info = buildClipErrorInfo('some plain message with no prefix');
  assert.equal(info.node_type, DEFAULT_NODE_TYPE);
  assert.equal(info.node_type, 'clip_generation_failed');
  assert.equal(info.message, 'some plain message with no prefix');
});

test('buildClipErrorInfo gère les messages français sans code (ex. "Aucune vidéo générée")', () => {
  const info = buildClipErrorInfo('Aucune vidéo générée — dernier échec : timeout');
  assert.equal(info.node_type, 'clip_generation_failed');
  assert.match(info.message, /Aucune vidéo générée/);
});

test('buildClipErrorInfo applique le sanitiseur fourni au message', () => {
  const info = buildClipErrorInfo('clip_video_output_failed: https://storage.example/a.mp4?token=SECRET', {
    sanitize: (value) => String(value).replace(/token=SECRET/, 'token=[masqué]'),
  });
  assert.equal(info.node_type, 'clip_video_output_failed');
  assert.doesNotMatch(info.message, /SECRET/);
});

// Source-scrape : le front lit d.errorInfo et rend le node_type.
test('nossen-index.html rend d.errorInfo.node_type dans le bandeau terminal', () => {
  const htmlSource = fs.readFileSync(
    path.join(__dirname, '..', 'nossen-index.html'),
    'utf8'
  );
  // Le front doit inspecter errorInfo.node_type.
  assert.match(htmlSource, /d\.errorInfo && d\.errorInfo\.node_type/);
  // Il doit rendre le node_type comme tag et le message borné à ~300 chars.
  assert.match(htmlSource, /escapeHtml\(truncate\(String\(d\.errorInfo\.node_type\)/);
  assert.match(htmlSource, /truncate\(escapeHtml\(String\(d\.errorInfo\.message[\s\S]*?\), 300\)/);
  // Il doit conserver le repli sur la chaîne d.error legacy.
  assert.match(htmlSource, /terminalMessage\("❌ " \+ fallbackError, "error", true\)/);
});
