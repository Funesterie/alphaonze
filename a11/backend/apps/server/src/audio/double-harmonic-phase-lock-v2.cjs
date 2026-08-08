'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');

const {
  AUDIO_PIVOT_GAIN_FACTOR,
  BALANCE_AUTO,
  D40_SOURCE_DENSITY,
  D40_SOURCE_N,
  D40_TARGET_N,
  MG_PHASE,
  ONE_OVER_E,
  PIVOT_RESIDUAL_OLD,
  RAW_LOW_PRESET,
  TARGET_0005_PI,
  T_LINEAR,
  buildD40EnvelopeExpression,
  buildOutputCodecArgs,
  resolveHarmonicIntensity,
  resolveD40Density,
  runFfmpeg,
  sampleD40EnvelopeAt,
} = require('./double-harmonic-d40.cjs');

const PHASE_LOCK_SCHEMA = 'funesterie.audio.double-harmonic-phase-lock.v2';
const DEFAULT_FRAME_MS = 40;
const DEFAULT_CYCLE_SECONDS = 4;
// Le t-linear historique est un arrondi de travail, pas l'operateur canonique.
// Il reste lisible pour reproduire les anciens essais, mais la production part
// sur la dissipation 1/e.
const DEFAULT_SMOOTHING = 'one-over-e';
const DEFAULT_ANALYSIS_SAMPLE_RATE = 16_000;
const DEFAULT_MAX_SECONDS = 30;
const DEFAULT_MIN_F0 = 65;
const DEFAULT_MAX_F0 = 520;
const TWO_PI = Math.PI * 2;

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function numberText(value, digits = 12) {
  return Number(value).toFixed(digits).replace(/0+$/g, '').replace(/\.$/g, '');
}

function normalizeSmoothing(value = DEFAULT_SMOOTHING) {
  const key = String(value || DEFAULT_SMOOTHING).trim().toLowerCase();
  if (key === 'e' || key === '1/e' || key === 'one-over-e' || key === 'dissipation') return 'one-over-e';
  if (key === 't' || key === 'tlinear' || key === 't-linear' || key === 'linear') return 't-linear';
  return DEFAULT_SMOOTHING;
}

function wrapRadians(value) {
  let wrapped = Number(value) || 0;
  while (wrapped > Math.PI) wrapped -= TWO_PI;
  while (wrapped <= -Math.PI) wrapped += TWO_PI;
  return wrapped;
}

function median(values) {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function mean(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function hann(index, size) {
  if (size <= 1) return 1;
  return 0.5 * (1 - Math.cos(TWO_PI * index / (size - 1)));
}

function frameRms(frame) {
  if (!frame.length) return 0;
  let sum = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const value = frame[index];
    sum += value * value;
  }
  return Math.sqrt(sum / frame.length);
}

function zeroCrossingRate(frame) {
  if (frame.length < 2) return 0;
  let crossings = 0;
  let previous = frame[0];
  for (let index = 1; index < frame.length; index += 1) {
    const current = frame[index];
    if ((previous < 0 && current >= 0) || (previous >= 0 && current < 0)) crossings += 1;
    previous = current;
  }
  return crossings / (frame.length - 1);
}

function removeDc(frame) {
  const dc = mean(Array.from(frame));
  const out = new Float32Array(frame.length);
  for (let index = 0; index < frame.length; index += 1) out[index] = frame[index] - dc;
  return out;
}

function estimateF0Autocorrelation(frame, sampleRate, options = {}) {
  const minF0 = clampNumber(options.minF0, 40, 400, DEFAULT_MIN_F0);
  const maxF0 = clampNumber(options.maxF0, minF0 + 1, 1400, DEFAULT_MAX_F0);
  const minLag = Math.max(1, Math.floor(sampleRate / maxF0));
  const maxLag = Math.min(frame.length - 2, Math.ceil(sampleRate / minF0));
  if (maxLag <= minLag) return { f0: 0, confidence: 0, lag: 0 };

  const clean = removeDc(frame);
  let frameEnergy = 0;
  for (let index = 0; index < clean.length; index += 1) frameEnergy += clean[index] * clean[index];
  if (frameEnergy < 1e-8) return { f0: 0, confidence: 0, lag: 0 };

  let bestLag = 0;
  let bestCorrelation = -Infinity;
  const correlations = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let numerator = 0;
    let energyA = 0;
    let energyB = 0;
    const limit = clean.length - lag;
    for (let index = 0; index < limit; index += 1) {
      const a = clean[index];
      const b = clean[index + lag];
      numerator += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const denominator = Math.sqrt(energyA * energyB) || 1;
    const correlation = numerator / denominator;
    correlations.push({ lag, correlation });
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  const earlyPeak = correlations.find((item, index) => {
    const previous = correlations[index - 1]?.correlation ?? -Infinity;
    const next = correlations[index + 1]?.correlation ?? -Infinity;
    return item.correlation >= bestCorrelation * 0.92
      && item.correlation >= 0.45
      && item.correlation >= previous
      && item.correlation >= next;
  });
  const selectedLag = earlyPeak?.lag || bestLag;
  const selectedCorrelation = earlyPeak?.correlation ?? bestCorrelation;
  const confidence = Math.max(0, Math.min(1, selectedCorrelation));
  if (!bestLag || confidence < 0.25) return { f0: 0, confidence, lag: bestLag };
  return {
    f0: sampleRate / selectedLag,
    confidence,
    lag: selectedLag,
  };
}

function goertzelPower(frame, sampleRate, frequency) {
  if (!frequency || frequency >= sampleRate / 2) return 0;
  const omega = TWO_PI * frequency / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const sample = frame[index] * hann(index, frame.length);
    s0 = sample + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2) / Math.max(1, frame.length);
}

function estimatePhaseAtFrequency(frame, sampleRate, frequency) {
  if (!frequency || frequency >= sampleRate / 2) return { phase: 0, magnitude: 0 };
  const omega = TWO_PI * frequency / sampleRate;
  let real = 0;
  let imag = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const sample = frame[index] * hann(index, frame.length);
    real += sample * Math.cos(omega * index);
    imag -= sample * Math.sin(omega * index);
  }
  return {
    phase: Math.atan2(imag, real),
    magnitude: Math.sqrt(real * real + imag * imag) / Math.max(1, frame.length),
  };
}

function computeBandEnergy(frame, sampleRate, f0) {
  const low = goertzelPower(frame, sampleRate, 160);
  const body = goertzelPower(frame, sampleRate, f0 || 220);
  const presence = goertzelPower(frame, sampleRate, 2400);
  const air = goertzelPower(frame, sampleRate, Math.min(6200, sampleRate * 0.45));
  return { low, body, presence, air };
}

function pcm16leToFloat32(buffer) {
  const view = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const samples = new Float32Array(Math.floor(view.length / 2));
  for (let offset = 0, index = 0; offset + 1 < view.length; offset += 2, index += 1) {
    samples[index] = view.readInt16LE(offset) / 32768;
  }
  return samples;
}

function decodePcmMono(inputPath, options = {}) {
  const sampleRate = Math.round(clampNumber(options.sampleRate, 8000, 48000, DEFAULT_ANALYSIS_SAMPLE_RATE));
  const maxSeconds = clampNumber(options.maxSeconds, 0.25, 900, DEFAULT_MAX_SECONDS);
  const bin = String(options.ffmpegPath || process.env.A11_DH_FFMPEG_BIN || process.env.FFMPEG_BIN || 'ffmpeg').trim() || 'ffmpeg';
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-t',
    String(maxSeconds),
    '-i',
    inputPath,
    '-ac',
    '1',
    '-ar',
    String(sampleRate),
    '-f',
    's16le',
    'pipe:1',
  ];
  return new Promise((resolve, reject) => {
    execFile(bin, args, {
      windowsHide: true,
      encoding: 'buffer',
      timeout: Number(options.timeoutMs || process.env.A11_DH_FFMPEG_TIMEOUT_MS || 180_000),
      maxBuffer: Number(options.maxBuffer || 80 * 1024 * 1024),
    }, (error, stdout, stderr) => {
      if (error) {
        const err = new Error(`ffmpeg_decode_failed:${error.message}`);
        err.stderr = stderr?.toString?.('utf8') || '';
        return reject(err);
      }
      return resolve({ sampleRate, samples: pcm16leToFloat32(stdout) });
    });
  });
}

function resolvePhaseLockConstants(options = {}) {
  const d40 = resolveD40Density(options);
  const smoothingMode = normalizeSmoothing(options.smoothing);
  const smoothingValue = smoothingMode === 'one-over-e' ? ONE_OVER_E : T_LINEAR;
  const phaseCorrectionRadians = MG_PHASE * (Math.PI / 2);

  return {
    schema: PHASE_LOCK_SCHEMA,
    d40,
    pivot: D40_SOURCE_DENSITY,
    sourceCycle: D40_SOURCE_N,
    targetCycle: D40_TARGET_N,
    pivotResidualOld: PIVOT_RESIDUAL_OLD,
    audioPivotGainFactor: AUDIO_PIVOT_GAIN_FACTOR,
    mgPhase: MG_PHASE,
    mgPhaseUnit: 'pi/2-face',
    phaseCorrectionRadians,
    target0005Pi: TARGET_0005_PI,
    targetMinusMgPhase: TARGET_0005_PI - MG_PHASE,
    smoothingMode,
    smoothingValue,
  };
}

function analyzePcmPhaseLockV2({ samples, sampleRate = DEFAULT_ANALYSIS_SAMPLE_RATE, ...options } = {}) {
  if (!samples || !samples.length) throw new Error('missing_pcm_samples');
  const constants = resolvePhaseLockConstants(options);
  const frameMs = clampNumber(options.frameMs, 5, 200, DEFAULT_FRAME_MS);
  const cycleSeconds = clampNumber(options.cycleSeconds, 0.5, 30, DEFAULT_CYCLE_SECONDS);
  const frameSize = Math.max(32, Math.round(sampleRate * frameMs / 1000));
  const hopSize = Math.max(16, Math.round(frameSize * clampNumber(options.hopRatio, 0.25, 1, 0.5)));
  const maxFrames = Math.round(clampNumber(options.maxFrames, 8, 5000, 1200));
  const maxFrameDetails = Math.round(clampNumber(options.maxFrameDetails, 0, 500, 180));
  const frames = [];
  const rmsValues = [];

  for (let start = 0; start < samples.length && frames.length < maxFrames; start += hopSize) {
    const frame = samples.subarray(start, Math.min(samples.length, start + frameSize));
    const time = start / sampleRate;
    const rms = frameRms(frame);
    const zcr = zeroCrossingRate(frame);
    const f0 = estimateF0Autocorrelation(frame, sampleRate, options);
    const phase = estimatePhaseAtFrequency(frame, sampleRate, f0.f0);
    const d40 = sampleD40EnvelopeAt(time, {
      profile: options.profile,
      periodSeconds: cycleSeconds,
    });
    const phaseTarget = wrapRadians(phase.phase + constants.phaseCorrectionRadians);
    const phaseError = wrapRadians(phaseTarget - phase.phase);
    const bandEnergy = computeBandEnergy(frame, sampleRate, f0.f0);
    const previousRms = rmsValues.length ? rmsValues[rmsValues.length - 1] : rms;
    const transientScore = Math.max(0, (rms - previousRms) / Math.max(previousRms, 1e-5));
    rmsValues.push(rms);
    frames.push({
      index: frames.length,
      time,
      rms,
      zeroCrossingRate: zcr,
      f0: f0.f0,
      f0Confidence: f0.confidence,
      lag: f0.lag,
      phaseRadians: phase.phase,
      phaseMagnitude: phase.magnitude,
      phaseTargetRadians: phaseTarget,
      phaseErrorRadians: phaseError,
      d40Gain: d40.gain,
      transientScore,
      bandEnergy,
    });
  }

  const transientScores = frames.map((frame) => frame.transientScore);
  const transientMean = mean(transientScores);
  const transientStd = Math.sqrt(mean(transientScores.map((score) => (score - transientMean) ** 2)));
  const transientThreshold = Math.max(0.12, transientMean + transientStd * 1.5);
  for (const frame of frames) frame.isTransient = frame.transientScore >= transientThreshold;

  const voiced = frames.filter((frame) => frame.f0 > 0 && frame.f0Confidence >= 0.25);
  const d40Gains = frames.map((frame) => frame.d40Gain);
  const bandMeans = {
    low: mean(frames.map((frame) => frame.bandEnergy.low)),
    body: mean(frames.map((frame) => frame.bandEnergy.body)),
    presence: mean(frames.map((frame) => frame.bandEnergy.presence)),
    air: mean(frames.map((frame) => frame.bandEnergy.air)),
  };

  return {
    schema: PHASE_LOCK_SCHEMA,
    method: 'dry-first-d40-phase-lock-analysis-v2',
    state: 'measured-analysis',
    preservesV1: true,
    sampleRate,
    durationSeconds: samples.length / sampleRate,
    frameMs,
    hopMs: hopSize * 1000 / sampleRate,
    cycleSeconds,
    framesPerCycle: Math.max(1, Math.round((cycleSeconds * 1000) / frameMs)),
    constants,
    summary: {
      frames: frames.length,
      framesReturned: Math.min(frames.length, maxFrameDetails),
      voicedFrames: voiced.length,
      voicedRatio: frames.length ? voiced.length / frames.length : 0,
      meanF0: mean(voiced.map((frame) => frame.f0)),
      medianF0: median(voiced.map((frame) => frame.f0)),
      meanF0Confidence: mean(voiced.map((frame) => frame.f0Confidence)),
      meanRms: mean(frames.map((frame) => frame.rms)),
      meanPhaseErrorRadians: mean(frames.map((frame) => Math.abs(frame.phaseErrorRadians))),
      transientThreshold,
      transientFrames: frames.filter((frame) => frame.isTransient).length,
      d40GainMin: d40Gains.length ? Math.min(...d40Gains) : 0,
      d40GainMax: d40Gains.length ? Math.max(...d40Gains) : 0,
      bandEnergyMean: bandMeans,
    },
    frames: frames.slice(0, maxFrameDetails),
  };
}

async function analyzePhaseLockV2({ inputPath, ...options } = {}) {
  if (!inputPath) throw new Error('missing_input_path');
  const decoded = await decodePcmMono(inputPath, options);
  return analyzePcmPhaseLockV2({
    samples: decoded.samples,
    sampleRate: decoded.sampleRate,
    ...options,
  });
}

function resolvePhaseAwareMix(analysis = {}, options = {}) {
  const summary = analysis.summary || {};
  const constants = analysis.constants || resolvePhaseLockConstants(options);
  const intensity = resolveHarmonicIntensity(options.intensity || options.harmonicIntensity || options.weightScale);
  const voicedRatio = clampNumber(summary.voicedRatio, 0, 1, 0);
  const confidence = clampNumber(summary.meanF0Confidence, 0, 1, 0);
  const frames = Math.max(1, Number(summary.frames || 1));
  const transientRatio = clampNumber((summary.transientFrames || 0) / frames, 0, 1, 0);
  const phaseScore = clampNumber((0.65 + voicedRatio * 0.35) * (0.65 + confidence * 0.35) * (1 - transientRatio * 0.25), 0.45, 1.08, 1);
  const medianF0 = clampNumber(summary.medianF0, 40, 1400, 220);
  const sampleRate = clampNumber(options.outputSampleRate || options.sampleRate, 8000, 96000, 44100);
  const phaseDelaySamples = constants.phaseCorrectionRadians / (Math.PI * 2 * medianF0) * sampleRate;
  const phaseDelayMs = phaseDelaySamples * 1000 / sampleRate;
  const highWeight = RAW_LOW_PRESET.highWeight * AUDIO_PIVOT_GAIN_FACTOR * intensity * phaseScore;
  const lowWeight = RAW_LOW_PRESET.lowWeight * AUDIO_PIVOT_GAIN_FACTOR * intensity * phaseScore;

  return {
    intensity,
    phaseScore,
    voicedRatio,
    confidence,
    transientRatio,
    medianF0,
    phaseDelaySamples,
    phaseDelayMs,
    highWeight,
    lowWeight,
    ratio: lowWeight / highWeight,
    balance: BALANCE_AUTO,
  };
}

function buildPhaseAwareD40Filter({ analysis, profile = 'blend', intensity, cycleSeconds } = {}) {
  const envelope = buildD40EnvelopeExpression({ profile, periodSeconds: cycleSeconds });
  const mix = resolvePhaseAwareMix(analysis, { intensity, sampleRate: 44100 });
  const highVolume = `${numberText(mix.highWeight)}*(${envelope.expression})`;
  const lowVolume = `${numberText(mix.lowWeight)}*(${envelope.expression})`;
  const rubberbandOptions = 'transients=crisp:detector=compound:phase=laminar:window=short:smoothing=on:formant=preserved:pitchq=consistency:channels=together';

  return {
    envelope,
    mix,
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

function buildPhaseAwareD40Args({ inputPath, outputPath, analysis, profile = 'blend', intensity, cycleSeconds } = {}) {
  const built = buildPhaseAwareD40Filter({ analysis, profile, intensity, cycleSeconds });
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

async function processPhaseAwareD40V2({ inputPath, outputPath, profile = 'blend', intensity, timeoutMs, analysisOptions = {} } = {}) {
  if (!inputPath) throw new Error('missing_input_path');
  if (!outputPath) throw new Error('missing_output_path');
  const analysis = await analyzePhaseLockV2({
    inputPath,
    profile,
    maxFrameDetails: 180,
    ...analysisOptions,
  });
  const { built, args } = buildPhaseAwareD40Args({
    inputPath,
    outputPath,
    analysis,
    profile,
    intensity,
    cycleSeconds: analysisOptions.cycleSeconds,
  });
  await runFfmpeg(args, { timeoutMs });
  return {
    method: 'dry-first-d40-phase-aware-overlay-v2',
    state: 'experimental-process',
    profile: built.envelope.profile,
    intensity: built.mix.intensity,
    d40: built.envelope.density,
    phase: {
      mgPhase: analysis.constants.mgPhase,
      correctionRadians: analysis.constants.phaseCorrectionRadians,
      delaySamples: built.mix.phaseDelaySamples,
      delayMs: built.mix.phaseDelayMs,
      score: built.mix.phaseScore,
    },
    analysis: {
      summary: analysis.summary,
      frameMs: analysis.frameMs,
      hopMs: analysis.hopMs,
      cycleSeconds: analysis.cycleSeconds,
    },
    weights: {
      dry: 1,
      high: built.mix.highWeight,
      low: built.mix.lowWeight,
      ratio: built.mix.ratio,
    },
  };
}

function buildPhaseLockPlan(options = {}) {
  const constants = resolvePhaseLockConstants(options);
  const frameMs = clampNumber(options.frameMs, 5, 200, DEFAULT_FRAME_MS);
  const cycleSeconds = clampNumber(options.cycleSeconds, 0.5, 30, DEFAULT_CYCLE_SECONDS);
  const framesPerCycle = Math.max(1, Math.round((cycleSeconds * 1000) / frameMs));

  return {
    schema: PHASE_LOCK_SCHEMA,
    method: 'dry-first-d40-phase-lock-analysis-plan-v2',
    state: 'analysis-plan',
    preservesV1: true,
    frameMs,
    cycleSeconds,
    framesPerCycle,
    analysis: {
      requiredTracks: [
        'f0Track',
        'instantaneousPhase',
        'bandEnergy',
        'transientMap',
      ],
      suggestedMethods: {
        f0Track: ['pyin', 'yin', 'crepe-or-torchcrepe'],
        phase: ['stft-phase-vocoder', 'hilbert-instantaneous-phase'],
        separation: ['voice-band-protect-mix', 'demucs-or-stem-input-optional'],
      },
    },
    controls: {
      d40Envelope: constants.d40,
      phase: {
        mgPhase: constants.mgPhase,
        unit: constants.mgPhaseUnit,
        radians: constants.phaseCorrectionRadians,
      },
      smoothing: {
        mode: constants.smoothingMode,
        value: constants.smoothingValue,
        oneOverE: ONE_OVER_E,
        tLinear: T_LINEAR,
      },
      pivot: {
        density: constants.pivot,
        residualOld: constants.pivotResidualOld,
        gainFactor: constants.audioPivotGainFactor,
      },
    },
    stages: [
      'decode-preserve-source-format',
      'optional-stem-or-voice-band-isolation',
      'frame-analysis-f0-phase-energy-transients',
      'd40-cycle-envelope',
      'mg-phase-micro-correction',
      'phase-coherent-harmonic-overlay',
      'dry-first-protect-mix',
      'encode-like-source-format',
    ],
    safety: {
      dryFirst: true,
      noMasterDestructivePhaseWarp: true,
      keepV1RouteUntouched: true,
      metricsRequiredBeforeDefault: ['lufsMatchedAB', 'monoCorrelation', 'phaseErrorMean', 'transientDriftMs'],
    },
  };
}

module.exports = {
  DEFAULT_ANALYSIS_SAMPLE_RATE,
  DEFAULT_CYCLE_SECONDS,
  DEFAULT_FRAME_MS,
  DEFAULT_MAX_SECONDS,
  DEFAULT_SMOOTHING,
  PHASE_LOCK_SCHEMA,
  analyzePcmPhaseLockV2,
  analyzePhaseLockV2,
  buildPhaseAwareD40Args,
  buildPhaseAwareD40Filter,
  buildPhaseLockPlan,
  decodePcmMono,
  normalizeSmoothing,
  pcm16leToFloat32,
  processPhaseAwareD40V2,
  resolvePhaseAwareMix,
  resolvePhaseLockConstants,
  wrapRadians,
};
