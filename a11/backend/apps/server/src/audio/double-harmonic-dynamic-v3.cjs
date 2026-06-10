'use strict';

const {
  AUDIO_PIVOT_GAIN_FACTOR,
  BALANCE_AUTO,
  HARMONIC_WEIGHT_RATIO,
  MAX_HARMONIC_INTENSITY,
  MIN_HARMONIC_INTENSITY,
  RAW_LOW_PRESET,
  buildD40EnvelopeExpression,
  buildOutputCodecArgs,
  runFfmpeg,
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
const DB_EPSILON = 1e-7;

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function numberText(value, digits = 12) {
  return Number(value).toFixed(digits).replace(/0+$/g, '').replace(/\.$/g, '');
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

function buildDynamicWeightD40Filter({ analysis, profile = 'blend', cycleSeconds } = {}) {
  const envelope = buildD40EnvelopeExpression({ profile, periodSeconds: cycleSeconds });
  const dynamicExpression = buildDynamicWeightExpression(analysis);
  const mg = AUDIO_PIVOT_GAIN_FACTOR;
  const highBaseWeight = RAW_LOW_PRESET.highWeight * mg;
  const lowBaseWeight = RAW_LOW_PRESET.lowWeight * mg;
  const highVolume = `${numberText(highBaseWeight)}*(${envelope.expression})*(${dynamicExpression})`;
  const lowVolume = `${numberText(lowBaseWeight)}*(${envelope.expression})*(${dynamicExpression})`;
  const rubberbandOptions = 'transients=crisp:detector=compound:phase=laminar:window=short:smoothing=on:formant=preserved:pitchq=consistency:channels=together';

  return {
    envelope,
    analysis,
    mg,
    balance: BALANCE_AUTO,
    dynamicExpression,
    highBaseWeight,
    lowBaseWeight,
    highWeightMin: highBaseWeight * MIN_HARMONIC_INTENSITY,
    highWeightMax: highBaseWeight * MAX_HARMONIC_INTENSITY,
    lowWeightMin: lowBaseWeight * MIN_HARMONIC_INTENSITY,
    lowWeightMax: lowBaseWeight * MAX_HARMONIC_INTENSITY,
    filter: [
      '[0:a]asplit=2[full][work]',
      '[full]aresample=44100,aformat=channel_layouts=stereo[dryfull]',
      '[work]aformat=channel_layouts=mono,highpass=f=120,lowpass=f=6500,afftdn=nf=-28,asplit=2[h1][h2]',
      `[h1]rubberband=pitch=${RAW_LOW_PRESET.highPitch}:${rubberbandOptions},highpass=f=1200,lowpass=f=10000,volume='${highVolume}':eval=frame,pan=stereo|c0=c0|c1=c0[h1o]`,
      `[h2]rubberband=pitch=${RAW_LOW_PRESET.lowPitch}:${rubberbandOptions},highpass=f=90,lowpass=f=2600,volume='${lowVolume}':eval=frame,pan=stereo|c0=c0|c1=c0[h2o]`,
      '[dryfull][h1o][h2o]amix=inputs=3:weights=\'1 1 1\':normalize=0,alimiter=limit=0.97[out]',
    ].join(';'),
  };
}

function buildDynamicWeightD40Args({ inputPath, outputPath, analysis, profile = 'blend', cycleSeconds } = {}) {
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
  const { built, args } = buildDynamicWeightD40Args({
    inputPath,
    outputPath,
    analysis,
    profile,
    cycleSeconds: analysisOptions.cycleSeconds,
  });
  await runFfmpeg(args, { timeoutMs });
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
  buildDynamicWeightD40Args,
  buildDynamicWeightD40Filter,
  buildDynamicWeightExpression,
  buildDynamicWeightPlanV3,
  processDynamicWeightD40V3,
};
