'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const STREAM_SCHEMA = 'funesterie.audio.stream-integrity.v1';

// Hash demuxed encoded packets from the FIRST AUDIO stream, not the file,
// artwork, metadata, video, timestamps, or a guessed MP3 filename signature.
// This is exact integrity, NOT perceptual similarity after lossy re-encoding.
async function readAudioStreamIntegrity(filePath, options = {}) {
  const filename = path.resolve(String(filePath || ''));
  const before = fs.statSync(filename);
  if (!before.isFile() || before.size <= 0) throw Error('audio_stream_input_empty');
  const run = options.execFile || execFile;
  const env = options.env || process.env;
  const settings = { timeout: Math.min(600000, Math.max(1000, Number(options.timeoutMs) || 120000)), maxBuffer: 256 * 1024, windowsHide: true };
  let probe, output;
  try {
    const result = await run(options.ffprobeBin || env.VIVY_FFPROBE_BIN || env.FFPROBE_BIN || 'ffprobe', [
      '-v', 'error', '-protocol_whitelist', 'file,pipe', '-select_streams', 'a:0',
      '-show_entries', 'stream=index,codec_name,sample_rate,channels', '-of', 'json', filename,
    ], settings);
    probe = JSON.parse(result.stdout).streams?.[0];
  } catch { throw Error('audio_stream_probe_failed'); }
  if (!probe || !probe.codec_name || !(Number(probe.channels) > 0) || !(Number(probe.sample_rate) > 0)) throw Error('audio_stream_missing');
  try {
    const result = await run(options.ffmpegBin || env.VIVY_FFMPEG_BIN || env.A11_AUDIO_FFMPEG_BIN || env.FFMPEG_BIN || 'ffmpeg', [
      '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', filename,
      '-map', '0:a:0', '-c:a', 'copy', '-map_metadata', '-1', '-f', 'streamhash', '-hash', 'sha256', 'pipe:1',
    ], settings);
    output = String(result.stdout || '').trim();
  } catch { throw Error('audio_stream_hash_failed'); }
  const match = /^0,a,SHA256=([a-f0-9]{64})$/i.exec(output);
  if (!match || match[1].toLowerCase() === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') throw Error('audio_stream_hash_empty_or_invalid');
  const after = fs.statSync(filename);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) throw Error('audio_stream_input_changed');
  return {
    schema: STREAM_SCHEMA, algorithm: 'sha256', representation: 'demuxed-encoded-audio-packets',
    selection: '0:a:0', streamIndex: Number(probe.index), codec: String(probe.codec_name),
    sampleRate: Number(probe.sample_rate), channels: Number(probe.channels), sha256: match[1].toLowerCase(),
  };
}

function validateAudioStreamIntegrity(record) {
  if (record?.schema !== STREAM_SCHEMA || record.algorithm !== 'sha256' || record.representation !== 'demuxed-encoded-audio-packets'
    || record.selection !== '0:a:0' || !/^[a-f0-9]{64}$/.test(record.sha256 || '')
    || !Number.isInteger(record.streamIndex) || record.streamIndex < 0 || !/^[a-z0-9_]+$/i.test(record.codec || '')
    || !Number.isInteger(record.sampleRate) || record.sampleRate <= 0 || !Number.isInteger(record.channels) || record.channels <= 0) throw Error('audio_stream_integrity_invalid');
  return Object.fromEntries(['schema', 'algorithm', 'representation', 'selection', 'streamIndex', 'codec', 'sampleRate', 'channels', 'sha256'].map(key => [key, record[key]]));
}

module.exports = { STREAM_SCHEMA, readAudioStreamIntegrity, validateAudioStreamIntegrity };
