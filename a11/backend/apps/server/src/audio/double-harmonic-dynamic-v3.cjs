'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  AUDIO_PIVOT_GAIN_FACTOR,
  BALANCE_AUTO,
  HARMONIC_WEIGHT_RATIO,
  MAX_HARMONIC_INTENSITY,
  MIN_HARMONIC_INTENSITY,
  RAW_LOW_PRESET,
  buildOutputCodecArgs,
  runFfmpeg,
  sampleD40EnvelopeAt,
} = require('./double-harmonic-d40.cjs');
const {
  DEFAULT_ANALYSIS_SAMPLE_RATE,
  decodePcmMono,
} = require('./double-harmonic-phase-lock-v2.cjs');

const DYNAMIC_WEIGHT_SCHEMA = 'funesterie.audio.double-harmonic-dynamic-weight.v3';
const DEFAULT_DYNAMIC_FRAME_MS = 250;
const DEFAULT_DYNAMIC_MAX_SECONDS = 90;
const DEFAULT_DYNAMIC_MAX_SEGMENTS = 360;
const DEFAULT_DYNAMIC_FLOOR_PERCENTILE = 0.1;
const DEFAULT_DYNAMIC_CEIL_PERCENTILE = 0.9;
const DEFAULT_DYNAMIC_MIN_DB_SPAN = 12;
const DEFAULT_DYNAMIC_AUTOMATION_SAMPLE_RATE = 400;
const DB_EPSILON = 1e-7;

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function numberText(value, digits = 12) {
  return Number(value).toFixed(digits).replace(/0+$/g, '').replace(/\.$/g, '');
}

function resolveAutomationSampleRate(value) {
  return Math.round(clampNumber(
    value || process.env.A11_DH_V3_ENVELOPE_SAMPLE_RATE,
    50,
    2000,
    DEFAULT_DYNAMIC_AUTOMATION_SAMPLE_RATE
  ));
}

function resolveFfprobeBin() {
  const explicit = String(process.env.A11_DH_FFPROBE_BIN || process.env.FFPROBE_BIN || '').trim();
  if (explicit) return explicit;
  const ffmpeg = String(process.env.A11_DH_FFMPEG_BIN || process.env.FFMPEG_BIN || '').trim();
  if (ffmpeg) {
    const basename = path.basename(ffmpeg);
    if (/^ffmpeg(?:\.exe)?$/i.test(basename)) {
      return path.join(path.dirname(ffmpeg), basename.replace(/^ffmpeg/i, 'ffprobe'));
    }
  }
  return 'ffprobe';
}

function probeAudioDurationSeconds(inputPath, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(resolveFfprobeBin(), [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ], {
      windowsHide: true,
      timeout: Number(options.timeoutMs || process.env.A11_DH_FFPROBE_TIMEOUT_MS || 20_000),
      maxBuffer: 64 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const err = new Error(`ffprobe_failed:${error.message}`);
        err.stderr = stderr;
        return reject(err);
      }
      const duration = Number(String(stdout || '').trim().split(/\s+/)[0]);
      if (!Number.isFinite(duration) || duration <= 0) return reject(new Error('ffprobe_invalid_duration'));
      return resolve(duration);
    });
  });
}

function mean(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function percentile(values, ratio) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const position = (clean.length - 1) * clampNumber(ratio, 0, 1, 0.5);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return clean[lower];
  const weight = position - lower;
  return clean[lower] * (1 - weight) + clean[upper] * weight;
}

function frameRms(samples, start, end) {
  const limit = Math.min(samples.length, Math.max(start, end));
  if (limit <= start) return 0;
  let sum = 0;
  for (let index = start; index < limit; index += 1) {
    const sample = samples[index];
    sum += sample * sample;
  }
  return Math.sqrt(sum / (limit - start));
}

function dbfsFromRms(rms) {
  return 20 * Math.log10(Math.max(DB_EPSILON, Number(rms) || 0));
}

function smoothWeightFrames(frames, options = {}) {
  const attack = clampNumber(options.attack, 0.05, 1, 0.62);
  const release = clampNumber(options.release, 0.02, 1, 0.28);
  let previous = Number(frames[0]?.weightRaw || 1);
  return frames.map((frame, index) => {
    const target = Number(frame.weightRaw || 1);
    if (index === 0) {
      previous = target;
    } else {
      const coeff = target >= previous ? attack : release;
      previous += (target - previous) * coeff;
    }
    return {
      ...frame,
      weightScale: clampNumber(previous, MIN_HARMONIC_INTENSITY, MAX_HARMONIC_INTENSITY, 1),
    };
  });
}

function reduceFrames(frames, maxSegments = DEFAULT_DYNAMIC_MAX_SEGMENTS) {
  const limit = Math.max(1, Math.round(maxSegments || DEFAULT_DYNAMIC_MAX_SEGMENTS));
  if (frames.length <= limit) return frames;
  const groupSize = Math.ceil(frames.length / limit);
  const reduced = [];
  for (let index = 0; index < frames.length; index += groupSize) {
    const group = frames.slice(index, index + groupSize);
    const first = group[0];
    const last = group[group.length - 1];
    reduced.push({
      index: reduced.length,
      startTime: first.startTime,
      endTime: last.endTime,
      rms: mean(group.map((item) => item.rms)),
      dbfs: mean(group.map((item) => item.dbfs)),
      normalizedEnergy: mean(group.map((item) => item.normalizedEnergy)),
      weightRaw: mean(group.map((item) => item.weightRaw)),
      weightScale: mean(group.map((item) => item.weightScale)),
    });
  }
  return reduced;
}

function analyzePcmDynamicWeightV3({ samples, sampleRate = DEFAULT_ANALYSIS_SAMPLE_RATE, ...options } = {}) {
  if (!samples?.length) throw new Error('missing_pcm_samples');
  const frameMs = clampNumber(options.frameMs, 50, 1000, DEFAULT_DYNAMIC_FRAME_MS);
  const frameSize = Math.max(1, Math.round(sampleRate * frameMs / 1000));
  const rawFrames = [];
  for (let start = 0, frameIndex = 0; start < samples.length; start += frameSize, frameIndex += 1) {
    const end = Math.min(samples.length, start + frameSize);
    const rms = frameRms(samples, start, end);
    rawFrames.push({
      index: frameIndex,
      startTime: start / sampleRate,
      endTime: end / sampleRate,
      rms,
      dbfs: dbfsFromRms(rms),
    });
  }

  const dbs = rawFrames.map((frame) => frame.dbfs);
  const medianDb = percentile(dbs, 0.5);
  let floorDb = percentile(dbs, options.floorPercentile ?? DEFAULT_DYNAMIC_FLOOR_PERCENTILE);
  let ceilDb = percentile(dbs, options.ceilPercentile ?? DEFAULT_DYNAMIC_CEIL_PERCENTILE);
  const minDbSpan = clampNumber(options.minDbSpan, 3, 48, DEFAULT_DYNAMIC_MIN_DB_SPAN);
  if (ceilDb - floorDb < minDbSpan) {
    floorDb = medianDb - minDbSpan / 2;
    ceilDb = medianDb + minDbSpan / 2;
  }

  const span = Math.max(0.001, ceilDb - floorDb);
  const weighted = rawFrames.map((frame) => {
    const normalizedEnergy = clampNumber((frame.dbfs - floorDb) / span, 0, 1, 0);
    const weightRaw = MIN_HARMONIC_INTENSITY
      + normalizedEnergy * (MAX_HARMONIC_INTENSITY - MIN_HARMONIC_INTENSITY);
    return {
      ...frame,
      normalizedEnergy,
      weightRaw,
      weightScale: weightRaw,
    };
  });
  const smoothed = smoothWeightFrames(weighted, options);
  const frames = reduceFrames(smoothed, options.maxSegments);
  const weights = frames.map((frame) => frame.weightScale);
  const rmsValues = rawFrames.map((frame) => frame.rms);

  return {
    schema: DYNAMIC_WEIGHT_SCHEMA,
    method: 'dry-first-d40-db-dynamic-overlay-v3',
    state: 'dynamic-weight-analysis',
    frameMs,
    sampleRate,
    controls: {
      minWeight: MIN_HARMONIC_INTENSITY,
      maxWeight: MAX_HARMONIC_INTENSITY,
      ratio: HARMONIC_WEIGHT_RATIO,
      balance: BALANCE_AUTO,
      mgFixed: AUDIO_PIVOT_GAIN_FACTOR,
      floorDb,
      ceilDb,
      medianDb,
    },
    summary: {
      frames: rawFrames.length,
      framesReturned: frames.length,
      durationSeconds: samples.length / sampleRate,
      rmsMin: Math.min(...rmsValues),
      rmsMax: Math.max(...rmsValues),
      dbMin: Math.min(...dbs),
      dbMax: Math.max(...dbs),
      dbMean: mean(dbs),
      weightMin: Math.min(...weights),
      weightMax: Math.max(...weights),
      weightMean: mean(weights),
    },
    frames,
  };
}

async function analyzeDynamicWeightV3({ inputPath, ...options } = {}) {
  if (!inputPath) throw new Error('missing_input_path');
  const decoded = await decodePcmMono(inputPath, {
    sampleRate: options.sampleRate || DEFAULT_ANALYSIS_SAMPLE_RATE,
    maxSeconds: options.maxSeconds || DEFAULT_DYNAMIC_MAX_SECONDS,
    timeoutMs: options.timeoutMs,
  });
  return analyzePcmDynamicWeightV3({
    samples: decoded.samples,
    sampleRate: decoded.sampleRate,
    ...options,
  });
}

function buildDynamicWeightExpression(analysis = {}) {
  const frames = Array.isArray(analysis.frames) && analysis.frames.length
    ? analysis.frames
    : [{ endTime: 0, weightScale: 1 }];
  let expression = numberText(frames[frames.length - 1].weightScale, 9);
  for (let index = frames.length - 2; index >= 0; index -= 1) {
    const frame = frames[index];
    expression = `if(lt(t\\,${numberText(frame.endTime, 6)})\\,${numberText(frame.weightScale, 9)}\\,${expression})`;
  }
  return expression;
}

function sampleDynamicWeightAt(analysis = {}, timeSeconds = 0) {
  const frames = Array.isArray(analysis.frames) && analysis.frames.length
    ? analysis.frames
    : [{ endTime: Number.POSITIVE_INFINITY, weightScale: 1 }];
  const time = Math.max(0, Number(timeSeconds) || 0);
  let selected = frames[frames.length - 1];
  for (const frame of frames) {
    if (time < Number(frame.endTime || 0)) {
      selected = frame;
      break;
    }
  }
  return clampNumber(selected.weightScale, MIN_HARMONIC_INTENSITY, MAX_HARMONIC_INTENSITY, 1);
}

function buildDynamicAutomationSamples({
  analysis,
  profile = 'blend',
  cycleSeconds,
  durationSeconds,
  sampleRate,
} = {}) {
  const resolvedSampleRate = resolveAutomationSampleRate(sampleRate);
  const fallbackDuration = Number(analysis?.summary?.durationSeconds || 1) || 1;
  const duration = clampNumber(durationSeconds, 0.05, 7200, fallbackDuration);
  const sampleCount = Math.max(1, Math.ceil(duration * resolvedSampleRate));
  const samples = new Float32Array(sampleCount);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / resolvedSampleRate;
    const dynamic = sampleDynamicWeightAt(analysis, time);
    const d40 = sampleD40EnvelopeAt(time, { profile, periodSeconds: cycleSeconds });
    const value = d40.gain * dynamic;
    samples[index] = value;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }

  const probe = sampleD40EnvelopeAt(0, { profile, periodSeconds: cycleSeconds });
  return {
    mode: 'wav-envelope',
    sampleRate: resolvedSampleRate,
    durationSeconds: sampleCount / resolvedSampleRate,
    sampleCount,
    samples,
    profile: probe.profile,
    period: probe.period,
    density: probe.density,
    summary: {
      min,
      max,
      mean: sum / sampleCount,
    },
  };
}

function writeFloat32MonoWav(filePath, samples, sampleRate = DEFAULT_DYNAMIC_AUTOMATION_SAMPLE_RATE) {
  const resolvedSampleRate = resolveAutomationSampleRate(sampleRate);
  const dataBytes = samples.length * 4;
  const buffer = Buffer.allocUnsafe(44 + dataBytes);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(3, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(resolvedSampleRate, 24);
  buffer.writeUInt32LE(resolvedSampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(32, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeFloatLE(Number(samples[index]) || 0, 44 + index * 4);
  }
  fs.writeFileSync(filePath, buffer);
  return {
    path: filePath,
    sampleRate: resolvedSampleRate,
    samples: samples.length,
    bytes: buffer.length,
  };
}

function buildAutomationEnvelopePath(outputPath) {
  const safeBase = path.basename(String(outputPath || 'd40-v3')).replace(/[^a-z0-9._-]+/gi, '_');
  return path.join(path.dirname(outputPath), `.${safeBase}.automation.wav`);
}

function buildDynamicWeightD40Filter({ analysis, profile = 'blend', cycleSeconds } = {}) {
  const envelopeProbe = sampleD40EnvelopeAt(0, { profile, periodSeconds: cycleSeconds });
  const envelope = {
    mode: 'wav-envelope',
    profile: envelopeProbe.profile,
    period: envelopeProbe.period,
    density: envelopeProbe.density,
  };
  const mg = AUDIO_PIVOT_GAIN_FACTOR;
  const highBaseWeight = RAW_LOW_PRESET.highWeight * mg;
  const lowBaseWeight = RAW_LOW_PRESET.lowWeight * mg;
  const rubberbandOptions = 'transients=crisp:detector=compound:phase=laminar:window=short:smoothing=on:formant=preserved:pitchq=consistency:channels=together';

  return {
    envelope,
    analysis,
    mg,
    balance: BALANCE_AUTO,
    automation: envelope,
    dynamicExpression: null,
    highBaseWeight,
    lowBaseWeight,
    highWeightMin: highBaseWeight * MIN_HARMONIC_INTENSITY,
    highWeightMax: highBaseWeight * MAX_HARMONIC_INTENSITY,
    lowWeightMin: lowBaseWeight * MIN_HARMONIC_INTENSITY,
    lowWeightMax: lowBaseWeight * MAX_HARMONIC_INTENSITY,
    filter: [
      '[0:a]asplit=2[full][work]',
      '[full]aresample=44100,aformat=channel_layouts=stereo[dryfull]',
      '[1:a]aresample=44100,aformat=sample_fmts=flt:channel_layouts=mono,pan=stereo|c0=c0|c1=c0[autoenv]',
      '[autoenv]asplit=2[envh][envl]',
      '[work]aformat=channel_layouts=mono,highpass=f=120,lowpass=f=6500,afftdn=nf=-28,asplit=2[h1][h2]',
      `[h1]rubberband=pitch=${RAW_LOW_PRESET.highPitch}:${rubberbandOptions},highpass=f=1200,lowpass=f=10000,volume=${numberText(highBaseWeight)}:eval=frame,pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=flt:channel_layouts=stereo[h1base]`,
      `[h2]rubberband=pitch=${RAW_LOW_PRESET.lowPitch}:${rubberbandOptions},highpass=f=90,lowpass=f=2600,volume=${numberText(lowBaseWeight)}:eval=frame,pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=flt:channel_layouts=stereo[h2base]`,
      '[h1base][envh]amultiply[h1o]',
      '[h2base][envl]amultiply[h2o]',
      '[dryfull][h1o][h2o]amix=inputs=3:weights=\'1 1 1\':normalize=0,alimiter=limit=0.97[out]',
    ].join(';'),
  };
}

function buildDynamicWeightD40Args({ inputPath, outputPath, analysis, profile = 'blend', cycleSeconds, envelopePath } = {}) {
  if (!envelopePath) throw new Error('missing_envelope_path');
  const built = buildDynamicWeightD40Filter({ analysis, profile, cycleSeconds });
  return {
    built,
    args: [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-i',
      envelopePath,
      '-filter_complex',
      built.filter,
      '-map',
      '[out]',
      '-ac',
      '2',
      '-ar',
      '44100',
      ...buildOutputCodecArgs(outputPath),
      outputPath,
    ],
  };
}

async function processDynamicWeightD40V3({ inputPath, outputPath, profile = 'blend', timeoutMs, analysisOptions = {} } = {}) {
  if (!inputPath) throw new Error('missing_input_path');
  if (!outputPath) throw new Error('missing_output_path');
  const analysis = await analyzeDynamicWeightV3({
    inputPath,
    frameMs: analysisOptions.frameMs,
    maxSeconds: analysisOptions.maxSeconds,
    maxSegments: analysisOptions.maxSegments,
    sampleRate: analysisOptions.sampleRate,
    cycleSeconds: analysisOptions.cycleSeconds,
    timeoutMs,
  });
  const probedDuration = await probeAudioDurationSeconds(inputPath, { timeoutMs }).catch(() => 0);
  const durationSeconds = Math.max(
    0.5,
    Number(probedDuration) || 0,
    Number(analysis.summary?.durationSeconds) || 0
  ) + 0.25;
  const automation = buildDynamicAutomationSamples({
    analysis,
    profile,
    cycleSeconds: analysisOptions.cycleSeconds,
    durationSeconds,
    sampleRate: analysisOptions.automationSampleRate,
  });
  const envelopePath = buildAutomationEnvelopePath(outputPath);
  writeFloat32MonoWav(envelopePath, automation.samples, automation.sampleRate);
  let built;
  try {
    const planned = buildDynamicWeightD40Args({
      inputPath,
      outputPath,
      analysis,
      profile,
      cycleSeconds: analysisOptions.cycleSeconds,
      envelopePath,
    });
    built = planned.built;
    await runFfmpeg(planned.args, { timeoutMs });
  } finally {
    if (process.env.A11_DH_V3_KEEP_ENVELOPE !== '1') {
      fs.rmSync(envelopePath, { force: true });
    }
  }
  return {
    method: 'dry-first-d40-db-dynamic-overlay-v3',
    state: 'dynamic-process',
    profile: built.envelope.profile,
    intensity: 'auto',
    d40: built.envelope.density,
    dynamic: {
      schema: analysis.schema,
      frameMs: analysis.frameMs,
      controls: analysis.controls,
      summary: analysis.summary,
      automation: {
        mode: automation.mode,
        sampleRate: automation.sampleRate,
        durationSeconds: automation.durationSeconds,
        sampleCount: automation.sampleCount,
        summary: automation.summary,
      },
    },
    weights: {
      dry: 1,
      highBase: built.highBaseWeight,
      lowBase: built.lowBaseWeight,
      highMin: built.highWeightMin,
      highMax: built.highWeightMax,
      lowMin: built.lowWeightMin,
      lowMax: built.lowWeightMax,
      ratio: built.lowBaseWeight / built.highBaseWeight,
      dynamicMin: analysis.summary.weightMin,
      dynamicMax: analysis.summary.weightMax,
      dynamicMean: analysis.summary.weightMean,
    },
  };
}

function buildDynamicWeightPlanV3(options = {}) {
  const frameMs = clampNumber(options.frameMs, 50, 1000, DEFAULT_DYNAMIC_FRAME_MS);
  const maxSeconds = clampNumber(options.maxSeconds, 1, 120, DEFAULT_DYNAMIC_MAX_SECONDS);
  return {
    schema: DYNAMIC_WEIGHT_SCHEMA,
    method: 'dry-first-d40-db-dynamic-overlay-v3',
    state: 'analysis-plan',
    preservesV1: true,
    preservesV2: true,
    frameMs,
    maxSeconds,
    controls: {
      minWeight: MIN_HARMONIC_INTENSITY,
      maxWeight: MAX_HARMONIC_INTENSITY,
      ratio: HARMONIC_WEIGHT_RATIO,
      balance: BALANCE_AUTO,
      mgFixed: AUDIO_PIVOT_GAIN_FACTOR,
      dbMapping: 'quiet-to-8/9 loud-to-9/8',
    },
    safety: {
      dryFirst: true,
      mgNeverChangedBySlider: true,
      sourceFormatOutput: true,
    },
  };
}

module.exports = {
  DEFAULT_DYNAMIC_FRAME_MS,
  DEFAULT_DYNAMIC_MAX_SECONDS,
  DYNAMIC_WEIGHT_SCHEMA,
  analyzeDynamicWeightV3,
  analyzePcmDynamicWeightV3,
  buildDynamicAutomationSamples,
  buildDynamicWeightD40Args,
  buildDynamicWeightD40Filter,
  buildDynamicWeightExpression,
  buildDynamicWeightPlanV3,
  probeAudioDurationSeconds,
  processDynamicWeightD40V3,
  sampleDynamicWeightAt,
  writeFloat32MonoWav,
};
