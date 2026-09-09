'use strict';
// Explicit, resumable historical batch. Originals are read-only; the application
// exposes an output only after the independent duration/peak/mono checks finish.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { getCanonicalRuntimeRoot } = require('../lib/runtime-root.cjs');
const { readHistoryTracks, historyDirectory, localAudioUrl } = require('../src/music/jukebox-history.cjs');
const { processV10BoomD40 } = require('../src/audio/v10-boom.cjs');
const { processTurboD40V9 } = require('../src/audio/double-harmonic-closed-phase-v8.cjs');
const { runFfmpeg } = require('../src/audio/double-harmonic-d40.cjs');
const RECIPE = 'v11pan-v9electrolysis-blend-1.5-4-v1';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const root = getCanonicalRuntimeRoot(), directory = historyDirectory();
const assetDir = path.join(root, 'files/generated/vivy');
const outputDir = directory + '-masters';

function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  fs.renameSync(temporary, file);
}

async function measure(file) {
  const { stdout } = await execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,channels,sample_rate', '-of', 'json', file], { timeout: 30000 });
  const probe = JSON.parse(stdout), duration = Number(probe.format?.duration);
  if (!(duration > 0) || !probe.streams?.some(s => s.codec_type === 'audio')) throw Error('invalid_audio');
  const { stderr } = await execFile('ffmpeg', ['-nostdin', '-hide_banner', '-threads', '1', '-i', file, '-filter_complex_threads', '1', '-filter_complex', 'aformat=channel_layouts=stereo,asplit=2[st][mo];[st]volumedetect[sto];[mo]pan=mono|c0=0.5*c0+0.5*c1,volumedetect[moo]', '-map', '[sto]', '-map', '[moo]', '-f', 'null', '-'], { timeout: 240000, maxBuffer: 2000000 });
  const values = {};
  for (const match of stderr.matchAll(/\[Parsed_volumedetect_(\d+)[^\]]*\]\s+(mean|max)_volume: ([-\w.]+) dB/g)) {
    const index = match[1]; (values[index] ||= {})[match[2]] = match[3] === '-inf' ? -120 : Number(match[3]);
  }
  for (const match of stderr.matchAll(/\[Parsed_volumedetect_(\d+)[^\]]*\]\s+n_samples: (\d+)/g)) (values[match[1]] ||= {}).samples = Number(match[2]);
  const [stereo, mono] = Object.keys(values).sort((a,b) => Number(a)-Number(b)).map(k => values[k]);
  if (!stereo || !mono || !Number.isFinite(stereo.max) || !Number.isFinite(mono.mean)) throw Error('missing_audio_metrics');
  const decodedDuration = decodedDurationSeconds(stereo.samples, probe.streams.find(s => s.codec_type === 'audio').sample_rate);
  return { durationSeconds: decodedDuration, containerDurationSeconds: duration, stereoPeakDb: stereo.max, stereoRmsDb: stereo.mean, monoPeakDb: mono.max, monoRmsDb: mono.mean, monoFoldLossDb: mono.mean - stereo.mean };
}

function decodedDurationSeconds(stereoSamples, sampleRate) {
  const duration = Number(stereoSamples) / (2 * Number(sampleRate));
  if (!(Number(stereoSamples) > 0) || !(Number(sampleRate) > 0) || !Number.isFinite(duration)) throw Error('missing_decoded_duration');
  return duration;
}

async function main() {
  if (!process.argv.includes('--apply')) throw Error('Explicit --apply required');
  fs.mkdirSync(outputDir, { recursive: true });
  const lock = path.join(root, 'vivy-stream/jukebox-v11pan.lock');
  const lockFd = fs.openSync(lock, 'wx', 0o600); fs.closeSync(lockFd);
  const reportFile = path.join(root, 'vivy-stream/jukebox-v11pan-status.json');
  const tracks = readHistoryTracks(directory).filter(t => t.available && localAudioUrl(t.trackUrl));
  const stats = { recipe: RECIPE, startedAt: new Date().toISOString(), state: 'running', total: tracks.length, completed: 0, reused: 0, failed: 0, warnings: 0, current: [], errors: [] };
  const active = new Set();
  const save = () => { stats.current = [...active]; stats.updatedAt = new Date().toISOString(); atomic(reportFile, stats); };
  const concurrency = Math.min(3, Math.max(1, Number(process.env.JUKEBOX_MASTER_CONCURRENCY) || 2));
  let stopping = false;
  process.once('SIGTERM', () => { stopping = true; });
  process.once('SIGINT', () => { stopping = true; });
  let position = 0;
  try {
    save();
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (position < tracks.length && !stopping) {
        const track = tracks[position++], key = hash(track.trackUrl);
        active.add(track.id); save();
        let temporary = '';
        try {
          if (!track.trackUrl.startsWith('/api/vivy/studio/assets/')) throw Error('unsupported_source_route');
          const inputPath = path.join(assetDir, decodeURIComponent(track.trackUrl.split('/').pop()));
          const sourceSha256 = hash(fs.readFileSync(inputPath));
          const filename = 'vivy-music-jukebox-v11pan-' + sourceSha256.slice(0, 20) + '.mp3';
          const outputPath = path.join(assetDir, filename), recordFile = path.join(outputDir, key + '.json');
          const previous = fs.existsSync(recordFile) ? JSON.parse(fs.readFileSync(recordFile, 'utf8')) : null;
          if (previous?.verified && previous.sourceSha256 === sourceSha256 && previous.recipe === RECIPE && fs.existsSync(outputPath) && hash(fs.readFileSync(outputPath)) === previous.outputSha256) { stats.reused++; continue; }
          const sourceMetrics = await measure(inputPath);
          if (!fs.existsSync(outputPath)) {
            temporary = path.join(assetDir, '.' + filename + '.' + crypto.randomUUID() + '.mp3');
            await processV10BoomD40({ inputPath, outputPath: temporary, profile: 'blend', timeoutMs: 600000, analysisOptions: {}, boomOptions: { panWidth: 1.5, panSpreadMs: 4 }, processV9Turbo: processTurboD40V9, runFfmpeg });
          }
          const outputMetrics = await measure(temporary || outputPath);
          if (Math.abs(outputMetrics.durationSeconds - sourceMetrics.durationSeconds) > 0.2) throw Error('duration_mismatch');
          if (outputMetrics.stereoPeakDb > -0.1 || outputMetrics.monoPeakDb > -0.1) throw Error('output_peak_guard');
          const monoFoldDeltaDb = outputMetrics.monoFoldLossDb - sourceMetrics.monoFoldLossDb;
          if (monoFoldDeltaDb < -3) throw Error('mono_fold_regression');
          if (hash(fs.readFileSync(inputPath)) !== sourceSha256) throw Error('source_changed_during_render');
          if (temporary) { fs.linkSync(temporary, outputPath); fs.unlinkSync(temporary); temporary = ''; }
          atomic(recordFile, { sourceTrackUrl: track.trackUrl, sourceSha256, outputSha256: hash(fs.readFileSync(outputPath)), trackUrl: '/api/vivy/studio/assets/' + filename, recipe: RECIPE, verified: true, durationSeconds: outputMetrics.durationSeconds, sourceMetrics, outputMetrics, monoFoldDeltaDb, completedAt: new Date().toISOString() });
          stats.completed++;
          console.log(JSON.stringify({ completed: stats.completed, reused: stats.reused, failed: stats.failed, total: stats.total, id: track.id }));
        } catch (error) {
          stats.failed++; stats.errors.push({ id: track.id, error: String(error.code || error.message).slice(0, 160) });
        } finally {
          if (temporary && path.dirname(temporary) === assetDir && path.basename(temporary).startsWith('.vivy-music-jukebox-v11pan-') && fs.existsSync(temporary)) fs.unlinkSync(temporary);
          active.delete(track.id); save();
        }
      }
    }));
    stats.state = stopping ? 'paused' : (stats.failed ? 'completed_with_errors' : 'complete'); save();
    console.log(JSON.stringify(stats));
  } finally { fs.unlinkSync(lock); }
}

if (require.main === module) main().catch(error => { console.error(String(error.code || error.message)); process.exitCode = 1; });
module.exports = { measure, atomic, RECIPE, decodedDurationSeconds };
