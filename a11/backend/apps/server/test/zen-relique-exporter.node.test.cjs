'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  exportZenReliqueForPublic,
  fixReliqueWaveBuffer,
  parseWaveChunks,
} = require('../src/audio/zen-relique-exporter.cjs');

function createReliqueWave({
  sampleRate = 8000,
  seconds = 1,
  channels = 1,
  bitsPerSample = 16,
} = {}) {
  const sampleCount = Math.max(1, Math.floor(sampleRate * seconds));
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataBytes = sampleCount * blockAlign;
  const fmtBytes = 16;
  const listPayload = Buffer.from('ZEN0', 'ascii');
  const buffer = Buffer.alloc(12 + 8 + fmtBytes + 8 + listPayload.length + 8 + dataBytes);
  let offset = 0;
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(0xffffffff, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(fmtBytes, offset); offset += 4;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt16LE(channels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(blockAlign, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;
  buffer.write('LIST', offset); offset += 4;
  buffer.writeUInt32LE(listPayload.length, offset); offset += 4;
  listPayload.copy(buffer, offset); offset += listPayload.length;
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(0xffffffff, offset); offset += 4;
  for (let index = 0; index < sampleCount; index += 1) {
    const value = Math.round(Math.sin((Math.PI * 2 * 220 * index) / sampleRate) * 12000);
    buffer.writeInt16LE(value, offset);
    offset += 2;
  }
  return buffer;
}

test('ZEN relique parser preserves structure and repairs RIFF/data sizes', () => {
  const relique = createReliqueWave();
  const parsed = parseWaveChunks(relique);

  assert.equal(parsed.riffInfinite, true);
  assert.equal(parsed.data.storedSize, 0xffffffff);
  assert.equal(parsed.data.actualSize, 16000);
  assert.equal(parsed.audio.sampleRate, 8000);
  assert.equal(parsed.audio.channels, 1);
  assert.equal(parsed.audio.bitsPerSample, 16);

  const repaired = fixReliqueWaveBuffer(relique);
  assert.equal(repaired.buffer.readUInt32LE(4), repaired.buffer.length - 8);
  assert.equal(repaired.buffer.readUInt32LE(parsed.data.sizeOffset), parsed.data.actualSize);
  assert.equal(repaired.repairs.riffSize.repaired, true);
  assert.equal(repaired.repairs.dataSize.repaired, true);

  // The original buffer is the relique; it stays untouched.
  assert.equal(relique.readUInt32LE(4), 0xffffffff);
  assert.equal(relique.readUInt32LE(parsed.data.sizeOffset), 0xffffffff);
});

test('ZEN relique exporter writes standalone public WAV/FLAC manifest when ffmpeg is available', async (t) => {
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', windowsHide: true });
  if (ffmpeg.status !== 0) {
    t.skip('ffmpeg unavailable');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a11-zen-relique-'));
  const input = path.join(tmp, 'sample.zen.wav');
  fs.writeFileSync(input, createReliqueWave({ seconds: 0.25 }));

  const result = await exportZenReliqueForPublic({
    inputPath: input,
    outputDir: tmp,
    baseName: 'sample',
  });

  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(result.outputs.wav.path), true);
  assert.equal(fs.existsSync(result.outputs.flac.path), true);
  assert.equal(fs.existsSync(result.manifestPath), true);
  const publicWav = fs.readFileSync(result.outputs.wav.path);
  assert.equal(publicWav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(publicWav.readUInt32LE(4), publicWav.length - 8);
  assert.notEqual(publicWav.readUInt32LE(4), 0xffffffff);
  assert.match(fs.readFileSync(result.manifestPath, 'utf8'), /flat-standard-wav-flac-no-hidden-runtime/);
});
