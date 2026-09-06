'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const {
  assertSafeRemoteUrl,
  decodeDataUrl,
  downloadRemoteMedia,
  isBlockedIpAddress,
  readLocalMedia,
  resolveAllowedLocalRoots,
} = require('../src/security/safe-media-input.cjs');

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('safe media input blocks local, private, metadata and documentation addresses', async () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '192.168.1.4',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
  ]) {
    assert.equal(isBlockedIpAddress(address), true, address);
  }
  await assert.rejects(() => assertSafeRemoteUrl('https://127.0.0.1/secret'), /private_address_forbidden/);
  await assert.rejects(() => assertSafeRemoteUrl('https://[::1]/secret'), /private_address_forbidden/);
  await assert.rejects(() => assertSafeRemoteUrl('https://[::ffff:7f00:1]/secret'), /private_address_forbidden/);
  await assert.rejects(() => assertSafeRemoteUrl('http://example.com/image.png', { lookupImpl: publicLookup }), /http_forbidden/);
});

test('safe media input revalidates redirect targets before the second request', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
  };
  await assert.rejects(() => downloadRemoteMedia('https://media.example.com/image.png', {
    fetchImpl,
    lookupImpl: publicLookup,
    allowHttp: true,
    allowedContentTypes: ['image/*'],
    maxBytes: 1024,
  }), /private_address_forbidden/);
  assert.equal(calls, 1);
});

test('pinned downloads never reuse a hostname socket from the global pool', async () => {
  let localHits = 0;
  const server = http.createServer((_req, res) => {
    localHits += 1;
    res.writeHead(200, { 'content-type': 'image/png', connection: 'keep-alive' });
    res.end('LOCAL');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await new Promise((resolve, reject) => {
      const request = http.get({
        hostname: 'rebind.invalid',
        port,
        path: '/warm',
        agent: http.globalAgent,
        lookup: (_hostname, options, callback) => {
          if (options?.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
          else callback(null, '127.0.0.1', 4);
        },
      }, (response) => {
        response.resume();
        response.once('end', resolve);
      });
      request.once('error', reject);
    });
    assert.equal(localHits, 1);

    await assert.rejects(() => downloadRemoteMedia(`http://rebind.invalid:${port}/media`, {
      lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
      allowHttp: true,
      allowedContentTypes: ['image/png'],
      maxBytes: 1024,
      timeoutMs: 1_000,
    }));
    assert.equal(localHits, 1, 'the validated request must not reuse the pre-warmed local socket');
  } finally {
    http.globalAgent.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('safe media input enforces content type and byte limits', async () => {
  await assert.rejects(() => downloadRemoteMedia('https://media.example.com/image.png', {
    fetchImpl: async () => new Response(Buffer.alloc(32), {
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': '32' },
    }),
    lookupImpl: publicLookup,
    allowedContentTypes: ['image/*'],
    maxBytes: 16,
  }), /payload_too_large/);

  await assert.rejects(() => downloadRemoteMedia('https://media.example.com/image.png', {
    fetchImpl: async () => new Response(Buffer.from('html'), {
      status: 200,
      headers: { 'content-type': 'text/html' },
    }),
    lookupImpl: publicLookup,
    allowedContentTypes: ['image/*'],
    maxBytes: 1024,
  }), /content_type_forbidden/);

  assert.throws(() => decodeDataUrl(`data:image/png;base64,${Buffer.alloc(64).toString('base64')}`, {
    allowedContentTypes: ['image/*'],
    maxBytes: 16,
  }), /payload_too_large/);
});

test('safe local media reads only regular files inside an explicit root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a11-safe-media-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'a11-safe-media-outside-'));
  try {
    const insidePath = path.join(root, 'cover.png');
    const outsidePath = path.join(outside, 'secret.png');
    await fs.writeFile(insidePath, Buffer.from('png'));
    await fs.writeFile(outsidePath, Buffer.from('secret'));
    const result = await readLocalMedia(insidePath, {
      allowedRoots: [root],
      allowedExtensions: ['.png'],
      maxBytes: 128,
    });
    assert.equal(result.buffer.toString(), 'png');
    await assert.rejects(() => readLocalMedia(outsidePath, {
      allowedRoots: [root],
      allowedExtensions: ['.png'],
      maxBytes: 128,
    }), /local_path_forbidden/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('default local roots use an A11-owned temp subdirectory, never the whole system temp', async () => {
  const runtimeRoot = path.join(os.tmpdir(), 'a11-runtime-for-safe-media-test');
  const roots = resolveAllowedLocalRoots({
    A11_RUNTIME_ROOT: runtimeRoot,
    A11_VIDEO_REFERENCE_ROOTS: '',
  });
  assert.deepEqual(roots, [
    path.resolve(runtimeRoot),
    path.resolve(os.tmpdir(), 'a11-media-input'),
  ]);
  assert.equal(roots.includes(path.resolve(os.tmpdir())), false);

  const unownedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'unowned-media-'));
  try {
    const guessedFile = path.join(unownedRoot, 'guessed.png');
    await fs.writeFile(guessedFile, Buffer.from('not-owned-by-a11'));
    await assert.rejects(() => readLocalMedia(guessedFile, {
      allowedRoots: roots,
      allowedExtensions: ['.png'],
      maxBytes: 128,
    }), /local_path_forbidden/);
  } finally {
    await fs.rm(unownedRoot, { recursive: true, force: true });
  }
});
