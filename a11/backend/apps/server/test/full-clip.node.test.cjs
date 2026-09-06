'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  buildStoryboard,
  buildSceneRenderDurations,
  materializeFullClipAudio,
} = require('../src/video/full-clip.cjs');

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('full clip resolves an approved local audio file without network', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'full-clip-local-'));
  try {
    const audioPath = path.join(dir, 'song.mp3');
    await fs.writeFile(audioPath, Buffer.alloc(2048, 7));
    let fetched = false;
    const resolved = await materializeFullClipAudio('/api/vivy/studio/assets/song.mp3', {
      workDir: dir,
      localAudioPath: audioPath,
      fetchFn: async () => { fetched = true; throw new Error('unexpected'); },
    });
    assert.equal(resolved, await fs.realpath(audioPath));
    assert.equal(fetched, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('full clip downloads a relative authenticated asset with a bounded manual fetch', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'full-clip-relative-'));
  const calls = [];
  try {
    const output = await materializeFullClipAudio('/api/vivy/studio/assets/vivy-music-demo.mp3', {
      workDir: dir,
      lookupImpl: publicLookup,
      publicOrigin: 'https://a11.funesterie.me',
      fetchFn: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(Buffer.alloc(4096, 3), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg', 'content-length': '4096' },
        });
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://a11.funesterie.me/api/vivy/studio/assets/vivy-music-demo.mp3');
    assert.equal(calls[0].init.redirect, 'manual');
    assert.ok(calls[0].init.signal);
    assert.equal((await fs.stat(output)).size, 4096);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('full clip revalidates redirects and blocks a metadata address', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'full-clip-redirect-'));
  let calls = 0;
  try {
    await assert.rejects(
      materializeFullClipAudio('/api/vivy/studio/assets/vivy-music-demo.mp3', {
        workDir: dir,
        lookupImpl: publicLookup,
        publicOrigin: 'https://a11.funesterie.me',
        fetchFn: async () => {
          calls += 1;
          return new Response(null, {
            status: 302,
            headers: { location: 'https://169.254.169.254/latest/meta-data' },
          });
        },
      }),
      /media_url_host_forbidden|media_url_private_address_forbidden/
    );
    assert.equal(calls, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('full clip rejects unapproved remote hosts and oversized audio', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'full-clip-limits-'));
  try {
    await assert.rejects(
      materializeFullClipAudio('https://evil.example/song.mp3', { workDir: dir, lookupImpl: publicLookup }),
      /media_url_host_forbidden/
    );
    await assert.rejects(
      materializeFullClipAudio('/api/vivy/studio/assets/vivy-music-demo.mp3', {
        workDir: dir,
        lookupImpl: publicLookup,
        publicOrigin: 'https://a11.funesterie.me',
        maxBytes: 1024 * 1024,
        fetchFn: async () => new Response(Buffer.alloc(1), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg', 'content-length': String(2 * 1024 * 1024) },
        }),
      }),
      /media_payload_too_large/
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('full clip source keeps cleanup in finally and no undefined options reference', async () => {
  const source = await fs.readFile(path.join(__dirname, '..', 'src', 'video', 'full-clip.cjs'), 'utf8');
  assert.doesNotMatch(source, /options\.fetchFn\s*\|\|\s*globalThis\.fetch/);
  assert.match(source, /finally\s*\{\s*try \{ fs\.rmSync\(workDir, \{ recursive: true, force: true \}\); \} catch \{\}/s);
  assert.match(source, /full_clip_storage_not_configured/);
  assert.match(source, /let offset = Math\.max\(0, Number\(options\.sceneDurations\?\.\[0\]/);
  assert.match(source, /buildAudioProvenanceMetadataArgs\(\{ provenanceId \}\)/);
  assert.match(source, /website=https:\/\/funesterie\.me/);
});

test('storyboard caps long lyrics while still covering the full song duration', () => {
  const lyrics = Array.from({ length: 16 }, (_, index) => `[Verse ${index + 1}]\nligne ${index + 1}`).join('\n');
  const storyboard = buildStoryboard(lyrics, { durationSeconds: 120, title: 'Longue chanson' });
  assert.equal(storyboard.length, 12);
  assert.equal(storyboard[0].startMs, 0);
  assert.equal(storyboard.at(-1).endMs, 120_000);
  assert.ok(storyboard.every((scene) => scene.durationSeconds > 0));
  const total = storyboard.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  assert.ok(Math.abs(total - 120) < 0.2);
});

test('render durations compensate crossfade overlap without shortening the song', () => {
  const storyboard = [
    { durationSeconds: 2.5 },
    { durationSeconds: 2.5 },
    { durationSeconds: 2.5 },
    { durationSeconds: 2.5 },
  ];
  const rendered = buildSceneRenderDurations(storyboard, 0.5);
  assert.deepEqual(rendered, [3, 3, 3, 2.5]);
  const montageDuration = rendered.reduce((sum, value) => sum + value, 0)
    - (rendered.length - 1) * 0.5;
  assert.equal(montageDuration, 10);
});
