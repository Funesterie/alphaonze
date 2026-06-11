'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const {
  AUDIO_PIVOT_GAIN_FACTOR,
  BALANCE_AUTO,
  HARMONIC_WEIGHT_RATIO,
  MAX_HARMONIC_INTENSITY,
  MG_PHASE,
  MIN_HARMONIC_INTENSITY,
  RAW_LOW_PRESET,
  TARGET_0005_PI,
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
const DEFAULT_DYNAMIC_MAX_SECONDS = 480;
const DEFAULT_DYNAMIC_MAX_SEGMENTS = 2400;
const DEFAULT_DYNAMIC_FLOOR_PERCENTILE = 0.1;
const DEFAULT_DYNAMIC_CEIL_PERCENTILE = 0.9;
const DEFAULT_DYNAMIC_MIN_DB_SPAN = 12;
const DEFAULT_DYNAMIC_AUTOMATION_SAMPLE_RATE = 400;
const DEFAULT_DYNAMIC_CURVE = 'ln-exp';
const DEFAULT_DYNAMIC_CURVE_AMOUNT = 0.38;
const DEFAULT_DYNAMIC_RISE_LOG = 2.6;
const DEFAULT_DYNAMIC_FALL_EXP = 2.1;
const DEFAULT_SPECTRAL_PIVOT = 0.292;
const MG_PHASE_TARGET_RATIO = TARGET_0005_PI / MG_PHASE;
const GRAIN_SPECTRAL_REMAINDER = TARGET_0005_PI - MG_PHASE;
const GRAIN_Q_SPECTRAL = GRAIN_SPECTRAL_REMAINDER * 30;
const GRAIN_SPECTRAL_LOW = 0.3694777356929151;
const GRAIN_18_36_DELTA = 1 - ((0.3 + 3 * GRAIN_Q_SPECTRAL) / 18);
const GRAIN_SPECTRAL_HIGH = GRAIN_SPECTRAL_LOW + GRAIN_18_36_DELTA;
const GRAIN_6D_LOG_WEIGHT = 0.24;
const GRAIN_7D_LN_WEIGHT = 0.52;
const GRAIN_8D_BASS_WEIGHT = 0.24;
const D8_BASS_LOW_CUTOFF_HZ = 260;
const D8_BODY_LOW_CUTOFF_HZ = 280;
const D8_BASS_HIGHPASS_HZ = 35;
const D8_BODY_SHARE = 0.76;
const D8_BASS_SHARE = 0.24;
const DEFAULT_FINAL_SAFETY_FILTER = 'alimiter=limit=0.97:attack=5:release=80:level=false';
const SWAP_FINAL_SAFETY_FILTER = 'asoftclip=type=tanh:threshold=0.88:output=0.98:oversample=2,volume=4dB,alimiter=limit=0.94:attack=3:release=120:level=false';
const DB_EPSILON = 1e-7;

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function boolOption(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true;
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false;
  return fallback;
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

function normalizeDynamicCurve(value = DEFAULT_DYNAMIC_CURVE) {
  const key = String(value || DEFAULT_DYNAMIC_CURVE).trim().toLowerCase();
  if (key === 'linear' || key === 'flat' || key === 'v3-linear') return 'linear';
  if (key === 'ln-exp' || key === 'log-exp' || key === 'emotion' || key === 'musical') return 'ln-exp';
  if (key === 'mg-ratio' || key === 'mg-phase' || key === 'd40-mg' || key === 'd40-mg-ratio') return 'mg-ratio';
  if (key === 'grain-18-36' || key === 'grain1836' || key === '18-36' || key === 'mirror-3d') return 'grain-18-36';
  if (key === 'grain-6d7d8d' || key === 'grain-678' || key === '6d7d8d' || key === '6d-7d-8d') return 'grain-6d7d8d';
  return DEFAULT_DYNAMIC_CURVE;
}

function normalizedLogRise(value, factor = DEFAULT_DYNAMIC_RISE_LOG) {
  const clean = clampNumber(value, 0, 1, 0);
  const k = clampNumber(factor, 0.05, 24, DEFAULT_DYNAMIC_RISE_LOG);
  return Math.log1p(k * clean) / Math.log1p(k);
}

function normalizedExpFall(value, factor = DEFAULT_DYNAMIC_FALL_EXP) {
  const clean = clampNumber(value, 0, 1, 0);
  const k = clampNumber(factor, 0.05, 24, DEFAULT_DYNAMIC_FALL_EXP);
  return Math.expm1(k * clean) / Math.expm1(k);
}

function normalizedMgRatioRise(value, options = {}) {
  const clean = clampNumber(value, 0, 1, 0);
  const pivot = clampNumber(options.spectralPivot, 0.001, 0.999, DEFAULT_SPECTRAL_PIVOT);
  const ratio = clampNumber(options.mgRatio, 0.001, 100, MG_PHASE_TARGET_RATIO);
  const gap = Math.max(0, clean - pivot);
  const normalizedGap = clampNumber(gap / Math.max(0.001, 1 - pivot), 0, 1, 0);
  return Math.log1p(ratio * normalizedGap) / Math.log1p(ratio);
}

function resolveGrainPair(options = {}) {
  const swapped = boolOption(options.swapPitchGrain, false);
  const fallbackLow = swapped ? RAW_LOW_PRESET.lowPitch : GRAIN_SPECTRAL_LOW;
  const fallbackHigh = swapped ? RAW_LOW_PRESET.highPitch : GRAIN_SPECTRAL_HIGH;
  const low = clampNumber(options.grainLow, 0.001, 20, fallbackLow);
  const high = clampNumber(options.grainHigh, low + 0.001, 20, fallbackHigh);
  return { low, high, swapped };
}

function normalizedGrain1836Rise(value, options = {}) {
  const clean = clampNumber(value, 0, 1, 0);
  const pivot = clampNumber(options.spectralPivot, 0.001, 0.999, DEFAULT_SPECTRAL_PIVOT);
  const { low, high } = resolveGrainPair(options);
  const invert = boolOption(options.invertGrain || options.grainInvert, false);
  const gap = Math.max(0, clean - pivot);
  const normalizedGap = clampNumber(gap / Math.max(0.001, 1 - pivot), 0, 1, 0);
  const grainPosition = invert ? 1 - normalizedGap : normalizedGap;
  const localGrain = low + (high - low) * grainPosition;
  return Math.log1p(localGrain * normalizedGap) / Math.log1p(high);
}

function normalizedLog10Rise(value) {
  const clean = clampNumber(value, 0, 1, 0);
  return Math.log10(1 + 9 * clean);
}

function normalizedD8BassResonance(value, low = GRAIN_SPECTRAL_LOW) {
  const clean = clampNumber(value, 0, 1, 0);
  const scale = clampNumber(low, 0.001, 20, GRAIN_SPECTRAL_LOW);
  const foundation = Math.sqrt(clean);
  const resonanceCeiling = 1 + scale * clean * clean;
  return clampNumber(foundation / resonanceCeiling, 0, 1, clean);
}

function normalizedGrain6d7d8dRise(value, options = {}) {
  const clean = clampNumber(value, 0, 1, 0);
  const pivot = clampNumber(options.spectralPivot, 0.001, 0.999, DEFAULT_SPECTRAL_PIVOT);
  const { low, high } = resolveGrainPair(options);
  const invert = boolOption(options.invertGrain || options.grainInvert, false);
  const gap = Math.max(0, clean - pivot);
  const normalizedGap = clampNumber(gap / Math.max(0.001, 1 - pivot), 0, 1, 0);
  const grainPosition = invert ? 1 - normalizedGap : normalizedGap;
  const localGrain = low + (high - low) * grainPosition;
  const log6d = normalizedLog10Rise(normalizedGap);
  const ln7d = Math.log1p(localGrain * normalizedGap) / Math.log1p(high);
  const bass8d = normalizedD8BassResonance(normalizedGap, low);
  return clampNumber(
    log6d * GRAIN_6D_LOG_WEIGHT
      + ln7d * GRAIN_7D_LN_WEIGHT
      + bass8d * GRAIN_8D_BASS_WEIGHT,
    0,
    1,
    normalizedGap
  );
}

function shapeDynamicEnergy(normalizedEnergy, previousEnergy, options = {}) {
  const curve = normalizeDynamicCurve(options.curve);
  const energy = clampNumber(normalizedEnergy, 0, 1, 0);
  const previous = Number.isFinite(Number(previousEnergy)) ? clampNumber(previousEnergy, 0, 1, energy) : energy;
  const direction = energy >= previous ? 'rise' : 'fall';
  if (curve === 'linear') {
    return { curve, direction, curvedEnergy: energy };
  }

  const shaped = direction === 'rise'
    ? (
        curve === 'mg-ratio'
          ? normalizedMgRatioRise(energy, options)
          : (
              curve === 'grain-18-36'
                ? normalizedGrain1836Rise(energy, options)
                : (curve === 'grain-6d7d8d' ? normalizedGrain6d7d8dRise(energy, options) : normalizedLogRise(energy, options.riseLog))
            )
      )
    : normalizedExpFall(energy, options.fallExp);
  const delta = Math.abs(energy - previous);
  const baseAmount = clampNumber(options.curveAmount, 0, 1, DEFAULT_DYNAMIC_CURVE_AMOUNT);
  const motionAmount = clampNumber(baseAmount + Math.min(0.22, delta * 1.8), 0, 1, baseAmount);
  const curvedEnergy = energy * (1 - motionAmount) + shaped * motionAmount;
  const grainPair = curve === 'grain-18-36' || curve === 'grain-6d7d8d'
    ? resolveGrainPair(options)
    : null;
  return {
    curve,
    direction,
    shapedEnergy: shaped,
    curveAmount: motionAmount,
    mgRatio: curve === 'mg-ratio' ? MG_PHASE_TARGET_RATIO : undefined,
    grainQSpectral: curve === 'grain-18-36' || curve === 'grain-6d7d8d' ? GRAIN_Q_SPECTRAL : undefined,
    grainSpectralRemainder: curve === 'grain-18-36' || curve === 'grain-6d7d8d' ? GRAIN_SPECTRAL_REMAINDER : undefined,
    grainLow: grainPair ? grainPair.low : undefined,
    grainHigh: grainPair ? grainPair.high : undefined,
    grainDelta: curve === 'grain-18-36' ? GRAIN_18_36_DELTA : undefined,
    grain6dLogWeight: curve === 'grain-6d7d8d' ? GRAIN_6D_LOG_WEIGHT : undefined,
    grain7dLnWeight: curve === 'grain-6d7d8d' ? GRAIN_7D_LN_WEIGHT : undefined,
    grain8dBassWeight: curve === 'grain-6d7d8d' ? GRAIN_8D_BASS_WEIGHT : undefined,
    grain8dMode: curve === 'grain-6d7d8d' ? 'bass-resonance' : undefined,
    invertGrain: curve === 'grain-18-36' || curve === 'grain-6d7d8d'
      ? boolOption(options.invertGrain || options.grainInvert, false)
      : undefined,
    swapPitchGrain: grainPair ? grainPair.swapped : undefined,
    spectralPivot: curve === 'mg-ratio' || curve === 'grain-18-36' || curve === 'grain-6d7d8d' ? DEFAULT_SPECTRAL_PIVOT : undefined,
    curvedEnergy: clampNumber(curvedEnergy, 0, 1, energy),
  };
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
      curvedEnergy: mean(group.map((item) => item.curvedEnergy)),
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
  const curve = normalizeDynamicCurve(options.curve || options.dynamicCurve);
  const curveAmount = clampNumber(options.curveAmount, 0, 1, DEFAULT_DYNAMIC_CURVE_AMOUNT);
  const riseLog = clampNumber(options.riseLog, 0.05, 24, DEFAULT_DYNAMIC_RISE_LOG);
  const fallExp = clampNumber(options.fallExp, 0.05, 24, DEFAULT_DYNAMIC_FALL_EXP);
  const invertGrain = boolOption(options.invertGrain || options.grainInvert, false);
  const swapPitchGrain = boolOption(options.swapPitchGrain, false);
  const grainPair = resolveGrainPair({
    grainLow: options.grainLow,
    grainHigh: options.grainHigh,
    swapPitchGrain,
  });
  let previousNormalizedEnergy;
  const weighted = rawFrames.map((frame) => {
    const normalizedEnergy = clampNumber((frame.dbfs - floorDb) / span, 0, 1, 0);
    const shaped = shapeDynamicEnergy(normalizedEnergy, previousNormalizedEnergy, {
      curve,
      curveAmount,
      riseLog,
      fallExp,
      mgRatio: MG_PHASE_TARGET_RATIO,
      spectralPivot: DEFAULT_SPECTRAL_PIVOT,
      grainLow: grainPair.low,
      grainHigh: grainPair.high,
      grainDelta: GRAIN_18_36_DELTA,
      grain6dLogWeight: GRAIN_6D_LOG_WEIGHT,
      grain7dLnWeight: GRAIN_7D_LN_WEIGHT,
      grain8dBassWeight: GRAIN_8D_BASS_WEIGHT,
      grain8dMode: 'bass-resonance',
      invertGrain,
      swapPitchGrain,
    });
    previousNormalizedEnergy = normalizedEnergy;
    const weightRaw = MIN_HARMONIC_INTENSITY
      + shaped.curvedEnergy * (MAX_HARMONIC_INTENSITY - MIN_HARMONIC_INTENSITY);
    return {
      ...frame,
      normalizedEnergy,
      curvedEnergy: shaped.curvedEnergy,
      curveDirection: shaped.direction,
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
      curve,
      curveAmount,
      riseLog,
      fallExp,
      mgPhase: MG_PHASE,
      target0005Pi: TARGET_0005_PI,
      mgRatio: MG_PHASE_TARGET_RATIO,
      grainQSpectral: GRAIN_Q_SPECTRAL,
      grainSpectralRemainder: GRAIN_SPECTRAL_REMAINDER,
      spectralPivot: DEFAULT_SPECTRAL_PIVOT,
      grainLow: grainPair.low,
      grainHigh: grainPair.high,
      grainDelta: GRAIN_18_36_DELTA,
      grain6dLogWeight: GRAIN_6D_LOG_WEIGHT,
      grain7dLnWeight: GRAIN_7D_LN_WEIGHT,
      grain8dBassWeight: GRAIN_8D_BASS_WEIGHT,
      grain8dMode: 'bass-resonance',
      invertGrain,
      swapPitchGrain,
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

function resolvePitchPair(options = {}) {
  const swapped = boolOption(options.swapPitchGrain, false);
  if (swapped) {
    return {
      highPitch: GRAIN_SPECTRAL_HIGH,
      lowPitch: GRAIN_SPECTRAL_LOW,
      invertPitch: false,
      swapPitchGrain: true,
    };
  }
  const pitchInverted = boolOption(options.invertPitch, false);
  return {
    highPitch: pitchInverted ? RAW_LOW_PRESET.lowPitch : RAW_LOW_PRESET.highPitch,
    lowPitch: pitchInverted ? RAW_LOW_PRESET.highPitch : RAW_LOW_PRESET.lowPitch,
    invertPitch: pitchInverted,
    swapPitchGrain: false,
  };
}

function buildDynamicWeightD40Filter({ analysis, profile = 'blend', cycleSeconds, invertPitch = false, swapPitchGrain = false } = {}) {
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
  const pitchPair = resolvePitchPair({ invertPitch, swapPitchGrain });
  const highPitch = pitchPair.highPitch;
  const lowPitch = pitchPair.lowPitch;
  const useD8BassBranch = pitchPair.swapPitchGrain;
  const bodyBaseWeight = useD8BassBranch ? lowBaseWeight * D8_BODY_SHARE : lowBaseWeight;
  const bassBaseWeight = useD8BassBranch ? lowBaseWeight * D8_BASS_SHARE : 0;
  const finalSafetyFilter = pitchPair.swapPitchGrain ? SWAP_FINAL_SAFETY_FILTER : DEFAULT_FINAL_SAFETY_FILTER;
  const rubberbandOptions = 'transients=crisp:detector=compound:phase=laminar:window=short:smoothing=on:formant=preserved:pitchq=consistency:channels=together';
  const filter = useD8BassBranch
    ? [
        '[0:a]asplit=2[full][work]',
        '[full]aresample=44100,aformat=channel_layouts=stereo[dryfull]',
        '[1:a]aresample=44100,aformat=sample_fmts=flt:channel_layouts=mono,pan=stereo|c0=c0|c1=c0[autoenv]',
        '[autoenv]asplit=3[envh][envbody][envbass]',
        '[work]aformat=channel_layouts=mono,highpass=f=80,lowpass=f=6500,afftdn=nf=-28,asplit=3[h6][d7][d8]',
        `[h6]rubberband=pitch=${highPitch}:${rubberbandOptions},highpass=f=1200,lowpass=f=10000,volume=${numberText(highBaseWeight)}:eval=frame,pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=flt:channel_layouts=stereo[h6base]`,
        `[d7]rubberband=pitch=${lowPitch}:${rubberbandOptions},highpass=f=${D8_BODY_LOW_CUTOFF_HZ},lowpass=f=2600,volume=${numberText(bodyBaseWeight)}:eval=frame,pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=flt:channel_layouts=stereo[d7base]`,
        `[d8]rubberband=pitch=${lowPitch}:${rubberbandOptions},highpass=f=${D8_BASS_HIGHPASS_HZ},lowpass=f=${D8_BASS_LOW_CUTOFF_HZ},volume=${numberText(bassBaseWeight)}:eval=frame,pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=flt:channel_layouts=stereo[d8base]`,
        '[h6base][envh]amultiply[h6o]',
        '[d7base][envbody]amultiply[d7o]',
        '[d8base][envbass]amultiply[d8o]',
        `[dryfull][h6o][d7o][d8o]amix=inputs=4:weights='1 1 1 1':normalize=0,${finalSafetyFilter}[out]`,
      ].join(';')
    : [
        '[0:a]asplit=2[full][work]',
        '[full]aresample=44100,aformat=channel_layouts=stereo[dryfull]',
        '[1:a]aresample=44100,aformat=sample_fmts=flt:channel_layouts=mono,pan=stereo|c0=c0|c1=c0[autoenv]',
        '[autoenv]asplit=2[envh][envl]',
        '[work]aformat=channel_layouts=mono,highpass=f=120,lowpass=f=6500,afftdn=nf=-28,asplit=2[h1][h2]',
        `[h1]rubberband=pitch=${highPitch}:${rubberbandOptions},highpass=f=1200,lowpass=f=10000,volume=${numberText(highBaseWeight)}:eval=frame,pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=flt:channel_layouts=stereo[h1base]`,
        `[h2]rubberband=pitch=${lowPitch}:${rubberbandOptions},highpass=f=90,lowpass=f=2600,volume=${numberText(lowBaseWeight)}:eval=frame,pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=flt:channel_layouts=stereo[h2base]`,
        '[h1base][envh]amultiply[h1o]',
        '[h2base][envl]amultiply[h2o]',
        `[dryfull][h1o][h2o]amix=inputs=3:weights='1 1 1':normalize=0,${finalSafetyFilter}[out]`,
      ].join(';');

  return {
    envelope,
    analysis,
    mg,
    balance: BALANCE_AUTO,
    automation: envelope,
    dynamicExpression: null,
    highBaseWeight,
    lowBaseWeight,
    bodyBaseWeight,
    bassBaseWeight,
    highPitch,
    lowPitch,
    invertPitch: pitchPair.invertPitch,
    swapPitchGrain: pitchPair.swapPitchGrain,
    d8BassBranch: useD8BassBranch,
    finalSafetyFilter,
    highWeightMin: highBaseWeight * MIN_HARMONIC_INTENSITY,
    highWeightMax: highBaseWeight * MAX_HARMONIC_INTENSITY,
    lowWeightMin: lowBaseWeight * MIN_HARMONIC_INTENSITY,
    lowWeightMax: lowBaseWeight * MAX_HARMONIC_INTENSITY,
    filter,
  };
}

function buildDynamicWeightD40Args({ inputPath, outputPath, analysis, profile = 'blend', cycleSeconds, envelopePath, invertPitch, swapPitchGrain } = {}) {
  if (!envelopePath) throw new Error('missing_envelope_path');
  const built = buildDynamicWeightD40Filter({ analysis, profile, cycleSeconds, invertPitch, swapPitchGrain });
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
  const probedDuration = await probeAudioDurationSeconds(inputPath, { timeoutMs }).catch(() => 0);
  const analysisMaxSeconds = analysisOptions.maxSeconds
    || (probedDuration ? Math.min(900, probedDuration + 0.5) : DEFAULT_DYNAMIC_MAX_SECONDS);
  const analysis = await analyzeDynamicWeightV3({
    inputPath,
    frameMs: analysisOptions.frameMs,
    maxSeconds: analysisMaxSeconds,
    maxSegments: analysisOptions.maxSegments,
    sampleRate: analysisOptions.sampleRate,
    curve: analysisOptions.curve,
    curveAmount: analysisOptions.curveAmount,
    riseLog: analysisOptions.riseLog,
    fallExp: analysisOptions.fallExp,
    attack: analysisOptions.attack,
    release: analysisOptions.release,
    minDbSpan: analysisOptions.minDbSpan,
    invertGrain: analysisOptions.invertGrain,
    swapPitchGrain: analysisOptions.swapPitchGrain,
    cycleSeconds: analysisOptions.cycleSeconds,
    timeoutMs,
  });
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
      invertPitch: analysisOptions.invertPitch,
      swapPitchGrain: analysisOptions.swapPitchGrain,
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
      bodyBase: built.bodyBaseWeight,
      bassBase: built.bassBaseWeight,
      highMin: built.highWeightMin,
      highMax: built.highWeightMax,
      lowMin: built.lowWeightMin,
      lowMax: built.lowWeightMax,
      ratio: built.lowBaseWeight / built.highBaseWeight,
      dynamicMin: analysis.summary.weightMin,
      dynamicMax: analysis.summary.weightMax,
      dynamicMean: analysis.summary.weightMean,
      highPitch: built.highPitch,
      lowPitch: built.lowPitch,
      invertPitch: built.invertPitch,
      swapPitchGrain: built.swapPitchGrain,
      d8BassBranch: built.d8BassBranch,
      finalSafetyFilter: built.finalSafetyFilter,
    },
  };
}

function buildDynamicWeightPlanV3(options = {}) {
  const frameMs = clampNumber(options.frameMs, 50, 1000, DEFAULT_DYNAMIC_FRAME_MS);
  const maxSeconds = clampNumber(options.maxSeconds, 1, 900, DEFAULT_DYNAMIC_MAX_SECONDS);
  const invertGrain = boolOption(options.invertGrain || options.grainInvert, false);
  const invertPitch = boolOption(options.invertPitch, false);
  const swapPitchGrain = boolOption(options.swapPitchGrain, false);
  const grainPair = resolveGrainPair({
    grainLow: options.grainLow,
    grainHigh: options.grainHigh,
    swapPitchGrain,
  });
  const pitchPair = resolvePitchPair({ invertPitch, swapPitchGrain });
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
      curve: normalizeDynamicCurve(options.curve),
      curveAmount: clampNumber(options.curveAmount, 0, 1, DEFAULT_DYNAMIC_CURVE_AMOUNT),
      riseLog: clampNumber(options.riseLog, 0.05, 24, DEFAULT_DYNAMIC_RISE_LOG),
      fallExp: clampNumber(options.fallExp, 0.05, 24, DEFAULT_DYNAMIC_FALL_EXP),
      mgPhase: MG_PHASE,
      target0005Pi: TARGET_0005_PI,
      mgRatio: MG_PHASE_TARGET_RATIO,
      grainQSpectral: GRAIN_Q_SPECTRAL,
      grainSpectralRemainder: GRAIN_SPECTRAL_REMAINDER,
      spectralPivot: DEFAULT_SPECTRAL_PIVOT,
      grainLow: grainPair.low,
      grainHigh: grainPair.high,
      grainDelta: GRAIN_18_36_DELTA,
      grain6dLogWeight: GRAIN_6D_LOG_WEIGHT,
      grain7dLnWeight: GRAIN_7D_LN_WEIGHT,
      grain8dBassWeight: GRAIN_8D_BASS_WEIGHT,
      grain8dMode: 'bass-resonance',
      highPitch: pitchPair.highPitch,
      lowPitch: pitchPair.lowPitch,
      invertGrain,
      invertPitch,
      swapPitchGrain,
    },
    safety: {
      dryFirst: true,
      mgNeverChangedBySlider: true,
      sourceFormatOutput: true,
    },
  };
}

module.exports = {
  DEFAULT_DYNAMIC_CURVE,
  DEFAULT_DYNAMIC_FRAME_MS,
  DEFAULT_DYNAMIC_MAX_SECONDS,
  DEFAULT_SPECTRAL_PIVOT,
  DYNAMIC_WEIGHT_SCHEMA,
  GRAIN_18_36_DELTA,
  GRAIN_6D_LOG_WEIGHT,
  GRAIN_7D_LN_WEIGHT,
  GRAIN_8D_BASS_WEIGHT,
  GRAIN_Q_SPECTRAL,
  GRAIN_SPECTRAL_REMAINDER,
  GRAIN_SPECTRAL_HIGH,
  GRAIN_SPECTRAL_LOW,
  D8_BASS_HIGHPASS_HZ,
  D8_BASS_LOW_CUTOFF_HZ,
  D8_BASS_SHARE,
  D8_BODY_LOW_CUTOFF_HZ,
  D8_BODY_SHARE,
  MG_PHASE_TARGET_RATIO,
  DEFAULT_FINAL_SAFETY_FILTER,
  SWAP_FINAL_SAFETY_FILTER,
  analyzeDynamicWeightV3,
  analyzePcmDynamicWeightV3,
  buildDynamicAutomationSamples,
  buildDynamicWeightD40Args,
  buildDynamicWeightD40Filter,
  buildDynamicWeightExpression,
  buildDynamicWeightPlanV3,
  boolOption,
  probeAudioDurationSeconds,
  processDynamicWeightD40V3,
  resolveGrainPair,
  resolvePitchPair,
  sampleDynamicWeightAt,
  shapeDynamicEnergy,
  writeFloat32MonoWav,
};
