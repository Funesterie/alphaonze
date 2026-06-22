'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const test = require('node:test');
const {
  ByteLimitTransform,
  HashTap
} = require('../src/stream-utils.cjs');

test('ByteLimitTransform rejects output beyond its limit', async () => {
  await assert.rejects(
    pipeline(
      Readable.from([Buffer.alloc(8), Buffer.alloc(8)]),
      new ByteLimitTransform(12, 'maxRawBytes'),
      async function* consume(source) { for await (const chunk of source) yield chunk; }
    ),
    (error) => error.code === 'ZEN_ERR_LIMIT'
  );
});

test('HashTap counts and hashes bytes without changing them', async () => {
  const tap = new HashTap('sha256');
  const chunks = [];
  tap.on('data', (chunk) => chunks.push(chunk));
  await pipeline(Readable.from([Buffer.from('abc')]), tap);
  assert.equal(Buffer.concat(chunks).toString('utf8'), 'abc');
  assert.equal(tap.bytes, 3);
  assert.equal(tap.digest('hex'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
