'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  probeAudioDurationSeconds,
  parseFirstPositiveDuration,
  parseFfmpegTimeSeconds,
} = require('../src/audio/probe-audio-duration.cjs');

function makeLocalAudioPlaceholder() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'funesterie-duration-'));
  const filePath = path.join(dir, 'track.mp3');
  fs.writeFileSync(filePath, Buffer.from([0x49, 0x44, 0x33, 0x04]));
  return { dir, filePath };
}

test('parse les durees positives sans inventer de valeur', () => {
  assert.equal(parseFirstPositiveDuration('N/A\n213.456\n'), 213.456);
  assert.equal(parseFirstPositiveDuration('N/A\n0\n'), 0);
  assert.equal(parseFfmpegTimeSeconds('frame=1 time=00:00:02.50\nframe=2 time=00:03:31.20'), 211.2);
});

test('la duree format ffprobe reste le chemin rapide', async () => {
  const { dir, filePath } = makeLocalAudioPlaceholder();
  const calls = [];
  try {
    const duration = await probeAudioDurationSeconds(filePath, {
      execLocal: async (binary, args) => {
        calls.push({ binary, args });
        return { stdout: '187.25\n', stderr: '' };
      },
    });
    assert.equal(duration, 187.25);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].args.includes('format=duration'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('si le conteneur ne donne pas la duree, sonde le flux audio local', async () => {
  const { dir, filePath } = makeLocalAudioPlaceholder();
  let call = 0;
  try {
    const duration = await probeAudioDurationSeconds(filePath, {
      execLocal: async () => {
        call += 1;
        if (call === 1) return { stdout: 'N/A\n', stderr: '' };
        return { stdout: '204.75\n', stderr: '' };
      },
    });
    assert.equal(duration, 204.75);
    assert.equal(call, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dernier recours: ffmpeg lit le fichier local jusqu au dernier time=', async () => {
  const { dir, filePath } = makeLocalAudioPlaceholder();
  let call = 0;
  try {
    const duration = await probeAudioDurationSeconds(filePath, {
      execLocal: async (_binary, args) => {
        call += 1;
        if (call <= 2) return { stdout: 'N/A\n', stderr: '' };
        assert.ok(args.includes('-f'));
        assert.ok(args.includes('null'));
        return {
          error: new Error('decode ended with a recoverable container warning'),
          stdout: '',
          stderr: 'size=N/A time=00:01:02.00 bitrate=N/A\nsize=N/A time=00:03:42.37 bitrate=N/A',
        };
      },
    });
    assert.equal(duration, 222.37);
    assert.equal(call, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('un chemin absent reste une duree inconnue', async () => {
  assert.equal(await probeAudioDurationSeconds('/chemin/inexistant/nossen.mp3'), 0);
});
