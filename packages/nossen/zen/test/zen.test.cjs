'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  decodeZen,
  decodeZenContainer,
  decodeZenFile,
  encodeZen,
  encodeZenContainer,
  encodeZenFile,
  ZEN_CANON,
  parseZen,
  stableStringify
} = require('../src/index.cjs');

test('stableStringify makes object key order deterministic', () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test('encodeZen refuses plaintext containers by default', () => {
  assert.throws(() => encodeZen('secret-ish corpus shard'), /refuses plaintext/);
});

test('encodeZen and decodeZen round-trip encrypted JSON', () => {
  const original = {
    kind: 'zen.fixture',
    payload: {
      message: 'corpus shard',
      order: [3, 1, 2]
    }
  };

  const container = encodeZen(original, { key: 'test-key' });
  const parsed = parseZen(container);
  assert.equal(parsed.header.format, 'zen');
  assert.equal(parsed.header.mode, 'encrypted_multiload');
  assert.equal(parsed.header.cipher, 'aes-256-gcm');
  assert.equal(parsed.header.fileCount, undefined);

  const decoded = decodeZen(container, { key: 'test-key' });
  assert.deepEqual(decoded.json, original);
});

test('decodeZen rejects the wrong key', () => {
  const container = encodeZen('locked', { key: 'right-key' });
  assert.throws(() => decodeZen(container, { key: 'wrong-key' }));
});

test('file helpers create and decode .zen files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nossen-zen-'));
  const source = path.join(dir, 'input.txt');
  const archive = path.join(dir, 'input.zen');
  const output = path.join(dir, 'output.txt');
  fs.writeFileSync(source, 'hello zen\n');

  const written = encodeZenFile(source, archive, { key: 'file-key' });
  assert.equal(written, archive);

  const decoded = decodeZenFile(archive, output, { key: 'file-key' });
  assert.equal(decoded.text, 'hello zen\n');
  assert.equal(fs.readFileSync(output, 'utf8'), 'hello zen\n');
});

test('plaintext mode exists only for explicit dev fixtures', () => {
  const container = encodeZen('fixture', { allowPlaintext: true });
  const decoded = decodeZen(container);
  assert.equal(decoded.text, 'fixture');
  assert.equal(decoded.header.mode, 'plaintext_dev');
});

test('canon exposes ZEN as spatial imaginary container, not renamed zip', () => {
  assert.match(ZEN_CANON.canonicalDefinition, /reverse zip/);
  assert.match(ZEN_CANON.spatialImaginaryMap.summary, /real projection/);
  assert.ok(ZEN_CANON.publicHeaderPolicy.hides.includes('reconstructionOrder'));
});

test('encodeZenContainer encrypts manifest, canon and data together', () => {
  const archive = encodeZenContainer({ shard: 1 }, {
    key: 'container-key',
    manifest: {
      intent: 'codex-session-corpus',
      axes: ['R', '+i', '-i'],
      zone: { model: 'Z_m(n)', m: 3 },
      fragments: [{ id: 'fragment:1', role: 'primary' }],
      graphHints: [['ZEN', 'USES', 'Spatial Imaginary Map']]
    }
  });

  const decoded = decodeZenContainer(archive, { key: 'container-key' });
  assert.equal(decoded.container.schema, 'nossen.zen.container-payload.v1');
  assert.equal(decoded.container.manifest.intent, 'codex-session-corpus');
  assert.equal(decoded.container.manifest.zone.model, 'Z_m(n)');
  assert.deepEqual(decoded.container.data.value, { shard: 1 });
  assert.equal(parseZen(archive).header.fileCount, undefined);
});
