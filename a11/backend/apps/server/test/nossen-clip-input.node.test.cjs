'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  assertClipMediaSignature,
  inspectClipMediaSource,
  materializeClipMedia,
} = require('../src/clips/clip-input.cjs');

const publicLookup = async () => [{ address: '8.8.8.8', family: 4 }];

function mp4Header() {
  return Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
}

test('la sortie Comfy GCS exacte est autorisée et garde sa signature', async () => {
  const signed = 'https://storage.googleapis.com/comfy-cloud-assets/hash.mp4?X-Goog-Signature=a%2Fb&X-Goog-Expires=600';
  const source = await inspectClipMediaSource(signed, { kind: 'video', lookupImpl: publicLookup });
  assert.equal(source.type, 'remote');
  assert.equal(source.url, signed);
});

test('un autre bucket Google Storage reste interdit', async () => {
  await assert.rejects(
    inspectClipMediaSource('https://storage.googleapis.com/other-bucket/hash.mp4?secret=1', {
      kind: 'video',
      lookupImpl: publicLookup,
    }),
    /clip_video_storage_path_forbidden/,
  );
});

test('la règle de bucket est réévaluée avant chaque redirection', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nossen-gcs-hop-'));
  const destination = path.join(dir, 'video.mp4');
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    return {
      status: 302,
      ok: false,
      headers: { get: (name) => name === 'location' ? 'https://storage.googleapis.com/other-bucket/stolen.mp4' : null },
    };
  };
  await assert.rejects(
    materializeClipMedia('https://cloud.comfy.org/api/s/result', destination, {
      kind: 'video',
      fetchImpl,
      lookupImpl: publicLookup,
      probeImpl: async () => 'video',
    }),
    /clip_video_storage_path_forbidden/,
  );
  assert.equal(fetched.length, 1, 'le mauvais bucket ne doit jamais être contacté');
});

test('une URL absolue Funesterie connue est matérialisée localement sans DNS', async () => {
  const runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'nossen-runtime-'));
  const assets = path.join(runtime, 'files', 'generated', 'vivy');
  await fs.mkdir(assets, { recursive: true });
  await fs.writeFile(path.join(assets, 'track.mp3'), Buffer.from('ID3\u0004\u0000\u0000'));
  let lookups = 0;
  const source = await inspectClipMediaSource('https://a11.funesterie.me/api/vivy/studio/assets/track.mp3', {
    kind: 'audio',
    env: { A11_RUNTIME_ROOT: runtime },
    lookupImpl: async () => { lookups += 1; return publicLookup(); },
  });
  assert.equal(source.type, 'local');
  assert.equal(source.path, path.join(runtime, 'files', 'generated', 'vivy', 'track.mp3'));
  assert.equal(lookups, 0);

  const destination = path.join(runtime, 'copy', 'audio.mp3');
  await materializeClipMedia('https://a11.funesterie.me/api/vivy/studio/assets/track.mp3', destination, {
    kind: 'audio',
    env: { A11_RUNTIME_ROOT: runtime },
    probeImpl: async () => 'audio',
  });
  assert.equal((await fs.readFile(destination)).subarray(0, 3).toString('ascii'), 'ID3');
});

test('une page HTML déguisée en MP3 est refusée avant ffprobe', async () => {
  const runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'nossen-html-audio-'));
  const assets = path.join(runtime, 'files', 'generated', 'vivy');
  await fs.mkdir(assets, { recursive: true });
  await fs.writeFile(path.join(assets, 'fake.mp3'), '<!doctype html><html>connexion</html>');
  let probed = false;
  await assert.rejects(
    materializeClipMedia('/api/vivy/studio/assets/fake.mp3', path.join(runtime, 'out.mp3'), {
      kind: 'audio',
      env: { A11_RUNTIME_ROOT: runtime },
      probeImpl: async () => { probed = true; return 'audio'; },
    }),
    /clip_audio_payload_html/,
  );
  assert.equal(probed, false);
});

test('les signatures vidéo et audio minimales sont distinctes', () => {
  assert.equal(assertClipMediaSignature(mp4Header(), 'video'), true);
  assert.throws(() => assertClipMediaSignature(Buffer.from('not-media'), 'audio'), /clip_audio_signature_invalid/);
});

test('un lien symbolique local qui sort du runtime est refusé', async (t) => {
  const runtime = await fs.mkdtemp(path.join(os.tmpdir(), 'nossen-symlink-root-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'nossen-symlink-out-'));
  const assets = path.join(runtime, 'files', 'generated', 'vivy');
  await fs.mkdir(assets, { recursive: true });
  const target = path.join(outside, 'outside.mp3');
  const link = path.join(assets, 'escape.mp3');
  await fs.writeFile(target, 'ID3payload');
  try { await fs.symlink(target, link, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error?.code)) return t.skip('symlinks non autorisés sur cet hôte');
    throw error;
  }
  await assert.rejects(
    materializeClipMedia('/api/vivy/studio/assets/escape.mp3', path.join(runtime, 'out.mp3'), {
      kind: 'audio',
      env: { A11_RUNTIME_ROOT: runtime },
      probeImpl: async () => 'audio',
    }),
    /clip_media_local_path_forbidden|clip_media_local_symlink_forbidden/,
  );
});
