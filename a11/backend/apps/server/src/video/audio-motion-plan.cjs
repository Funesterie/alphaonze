'use strict';

// audio-motion-plan.cjs — V2.1
// V9 reads sound at 99ms grain. A11 selects only the impacts worth a visual action.
// Peaks = curveDirection transitions rise→fall in analyzeDynamicWeightV3 frames.
// minPeakGapMs and maxPeaks are dynamic (durationMs, fps, style).
// Output: 4–12 video events. Never one action per 99ms frame.
// Falls back to ffmpeg-astats, then 4-phase layout.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const {
  analyzeDynamicWeightV3,
  DEFAULT_DYNAMIC_FRAME_MS,
} = require('../audio/double-harmonic-dynamic-v3.cjs');

const {
  DEFAULT_V9_TURBO_FRAME_MS,
  DEFAULT_V9_TURBO_ATTACK,
  DEFAULT_V9_TURBO_RELEASE,
  GRAIN_PIVOT_LOW,
  GRAIN_PIVOT_HIGH,
} = require('../audio/double-harmonic-closed-phase-v8.cjs');

const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|aac|m4a|opus|wma|webm)$/i;
const DEFAULT_FPS = 16; // Wan2.2

/**
 * Compute dynamic peak-selection parameters from durationMs, fps, style.
 *
 * Principle: V9 reads at 99ms grain, but video events need perceptual spacing.
 * minPeakGapMs = max(500ms, 10-frames-at-fps, duration/12)
 *   → guarantees events are visually distinct (≥10 frames apart)
 *   → caps total at 12 events regardless of duration
 * maxPeaks = clamp(4, 12, duration_sec × style_factor)
 */
function resolvePeakParams(durationMs, fps, style) {
  const useFps = fps || DEFAULT_FPS;
  // Minimum gap: at least 10 frames (perceptually distinct), at least duration/12
  let framesPerEvent = 10;
  if (style === 'action') framesPerEvent = 7;
  else if (style === 'calm') framesPerEvent = 14;
  const minGapFromFps = Math.round((framesPerEvent / useFps) * 1000);
  const minGapFromCount = Math.round(durationMs / 12);
  const minPeakGapMs = Math.max(500, minGapFromFps, minGapFromCount);
  // Max events: 4–12, proportional to duration
  let styleMultiplier = 1;
  if (style === 'action') styleMultiplier = 1.4;
  else if (style === 'calm') styleMultiplier = 0.7;
  const maxPeaks = Math.min(12, Math.max(4, Math.round((durationMs / 1000) * styleMultiplier)));
  return { minPeakGapMs, maxPeaks };
}

function tMsToFrame(tMs, fps) {
  return Math.round((tMs / 1000) * (fps || DEFAULT_FPS));
}

function buildFallbackPlan(durationMs, fps) {
  const f = fps || DEFAULT_FPS;
  const d = durationMs || 5000;
  return {
    durationMs: d, fps: f, source: 'fallback_phases',
    events: [
      { tMs: 0, frame: 0, layer: 'camera', action: 'slow push-in, establish character' },
      { tMs: Math.round(d * 0.25), frame: tMsToFrame(d * 0.25, f), layer: 'body', action: 'posture shift, build-up energy' },
      { tMs: Math.round(d * 0.55), frame: tMsToFrame(d * 0.55, f), layer: 'background_fx', action: 'peak action, energy burst in background' },
      { tMs: Math.round(d * 0.82), frame: tMsToFrame(d * 0.82, f), layer: 'face', action: 'expression intensifies, vocal phrase' },
      { tMs: d, frame: tMsToFrame(d, f), layer: 'camera', action: 'final pose, freeze or fade' },
    ],
  };
}

// V9 Turbo grain-aware classification:
// normalizedEnergy maps to perceptual impact layer.
// grainPivotHigh ≈ treble/vocal weight → face
// grainPivotLow  ≈ bass weight → background_fx
function classifyV9Peak(normalizedEnergy) {
  if (normalizedEnergy >= 0.8) return { layer: 'background_fx', action: 'energy burst / special effect on strong impact' };
  if (normalizedEnergy >= 0.6) return { layer: 'body', action: 'posture change / motion peak' };
  const isMedium = normalizedEnergy >= 0.4;
  return isMedium
    ? { layer: 'face', action: 'expression change / vocal phrase intensity' }
    : { layer: 'camera', action: 'camera cut / subtle angle shift' };
}

async function resolveBuffer(audioUrlOrBuffer, fetchImpl) {
  if (Buffer.isBuffer(audioUrlOrBuffer)) return { buffer: audioUrlOrBuffer, ext: '.mp3' };
  const url = String(audioUrlOrBuffer || '').trim();
  if (!url) return null;
  const ext = (() => {
    try { return path.extname(new URL(url, 'http://localhost').pathname) || '.mp3'; }
    catch { return '.mp3'; }
  })();
  const fetch_ = typeof fetchImpl === 'function' ? fetchImpl
    : (typeof globalThis.fetch === 'function' ? globalThis.fetch : null);
  if (!fetch_) return null;
  try {
    const res = await fetch_(url, { signal: AbortSignal.timeout?.(20000) });
    if (!res.ok) return null;
    return { buffer: Buffer.from(await res.arrayBuffer()), ext };
  } catch { return null; }
}

/**
 * V9 Turbo path: analyzeDynamicWeightV3 at 99ms frames.
 * Returns raw frames + summary for peak extraction.
 */
async function analyzeWithV9Turbo(tmpFile) {
  const result = await analyzeDynamicWeightV3({
    inputPath: tmpFile,
    frameMs: DEFAULT_V9_TURBO_FRAME_MS, // 99ms — V9 grain granularity
    maxSeconds: 12,                       // max video duration we care about
    attack: DEFAULT_V9_TURBO_ATTACK,
    release: DEFAULT_V9_TURBO_RELEASE,
    grainLow: GRAIN_PIVOT_LOW,
    grainHigh: GRAIN_PIVOT_HIGH,
    swapPitchGrain: true,
    timeoutMs: 20000,
  });
  return result;
}

/**
 * V1 fallback: ffmpeg astats per 100ms window.
 */
async function analyzeWithFfmpegAstats(tmpFile) {
  const { execFile } = require('node:child_process');
  const { promisify } = require('node:util');
  const execFileAsync = promisify(execFile);

  let ffprobePath = 'ffprobe';
  try {
    const { execSync } = require('node:child_process');
    const which = process.platform === 'win32'
      ? execSync('where ffprobe 2>nul', { encoding: 'utf8' }).trim().split('\n')[0].trim()
      : execSync('which ffprobe 2>/dev/null', { encoding: 'utf8' }).trim();
    if (which) ffprobePath = which;
  } catch { /* use PATH */ }

  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', tmpFile,
  ], { timeout: 10000 });
  const probe = JSON.parse(stdout);
  const fmt = probe?.format || {};
  const stream = (probe?.streams || []).find((s) => s.codec_type === 'audio') || {};
  const durationMs = Math.round(Number.parseFloat(fmt.duration || stream.duration || 0) * 1000);
  const sampleRate = Number.parseInt(stream.sample_rate || 44100, 10) || 44100;
  if (!durationMs) return null;

  const ffmpegPath = ffprobePath.replace(/ffprobe(\.exe)?$/, 'ffmpeg$1');
  const samplesPerWindow = Math.round((100 / 1000) * sampleRate);
  const { stderr } = await execFileAsync(ffmpegPath, [
    '-i', tmpFile,
    '-af', `asetnsamples=n=${samplesPerWindow},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
    '-f', 'null',
    process.platform === 'win32' ? 'NUL' : '/dev/null',
  ], { timeout: 25000 });

  const rmsValues = [];
  const re = /lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+)/g;
  let m;
  while ((m = re.exec(stderr)) !== null) {
    const db = parseFloat(m[1]);
    rmsValues.push(Number.isFinite(db) ? Math.pow(10, Math.max(-80, db) / 20) : 0);
  }

  // Convert to V9-style frames
  const windowMs = durationMs / Math.max(1, rmsValues.length);
  const maxRms = Math.max(...rmsValues, 0.0001);
  const frames = rmsValues.map((rms, i) => {
    const direction = i > 0 && rms >= rmsValues[i - 1] ? 'rise' : 'fall';
    return {
      index: i,
      startTime: (i * windowMs) / 1000,
      endTime: ((i + 1) * windowMs) / 1000,
      rms,
      normalizedEnergy: rms / maxRms,
      curveDirection: direction,
    };
  });

  return {
    frameMs: windowMs,
    frames,
    summary: { durationSeconds: durationMs / 1000, rmsMax: maxRms },
    source: 'ffmpeg_astats',
  };
}

function extractPeaksFromFrames(frames, durationMs, { minPeakGapMs, maxPeaks }) {
  if (!frames || frames.length < 3) return [];
  // Convert ms gap to frame-index gap (frames are 99ms each from V9)
  const frameWindowMs = durationMs / frames.length;
  const minGapFrames = Math.ceil(minPeakGapMs / frameWindowMs);

  // Peaks = direction transitions rise→fall — low-energy noise filtered at 0.2
  const candidates = [];
  for (let i = 1; i < frames.length - 1; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];
    const isPeak = curr.curveDirection === 'fall'
      && (prev.curveDirection === 'rise' || prev.normalizedEnergy < curr.normalizedEnergy);
    if (isPeak && curr.normalizedEnergy > 0.2) {
      candidates.push({
        index: i,
        tMs: Math.round(curr.endTime * 1000),
        normalizedEnergy: curr.normalizedEnergy,
      });
    }
  }

  // Sort by energy descending, greedy select with minimum gap
  candidates.sort((a, b) => b.normalizedEnergy - a.normalizedEnergy);
  const peaks = [];
  for (const c of candidates) {
    if (!peaks.some((p) => Math.abs(p.index - c.index) < minGapFrames)) {
      peaks.push(c);
      if (peaks.length >= maxPeaks) break;
    }
  }
  return peaks.sort((a, b) => a.tMs - b.tMs);
}

/**
 * Build a TemporalActionField from an audio URL or buffer.
 * Uses V9 Turbo 99ms analysis → falls back to ffmpeg astats → 4-phase layout.
 *
 * @param {string|Buffer} audioUrlOrBuffer
 * @param {{ fetchImpl?: Function, fps?: number }} opts
 * @returns {Promise<{durationMs, fps, source, events}|null>}
 */
async function buildAudioMotionPlan(audioUrlOrBuffer, { fetchImpl, fps, style } = {}) {
  const resolved = await resolveBuffer(audioUrlOrBuffer, fetchImpl).catch(() => null);
  if (!resolved) return null;

  const tmpFile = path.join(os.tmpdir(), `a11_amplan_${Date.now()}${resolved.ext}`);
  const useFps = fps || DEFAULT_FPS;

  try {
    fs.writeFileSync(tmpFile, resolved.buffer);

    // Try V9 Turbo path first
    let analysisResult = null;
    let analysisSource = 'v9turbo';
    try {
      analysisResult = await analyzeWithV9Turbo(tmpFile);
    } catch (e) {
      console.warn('[A11][audio-sync] V9 Turbo analysis failed, trying ffmpeg astats:', String(e?.message || e));
    }

    // V1 ffmpeg fallback
    if (!analysisResult?.frames?.length) {
      try {
        analysisResult = await analyzeWithFfmpegAstats(tmpFile);
        analysisSource = 'ffmpeg_astats';
      } catch (e) {
        console.warn('[A11][audio-sync] ffmpeg astats failed:', String(e?.message || e));
      }
    }

    const durationMs = Math.round((analysisResult?.summary?.durationSeconds || 0) * 1000);
    if (!durationMs) return null;

    if (!analysisResult?.frames?.length) {
      console.log(`[A11][audio-sync] dur=${(durationMs / 1000).toFixed(1)}s fps=${useFps} frames=0 events=5 source=fallback_phases`);
      return buildFallbackPlan(durationMs, useFps);
    }

    const { minPeakGapMs, maxPeaks } = resolvePeakParams(durationMs, useFps, style);
    const frameCount = analysisResult.frames.length;
    const peaks = extractPeaksFromFrames(analysisResult.frames, durationMs, { minPeakGapMs, maxPeaks });

    const events = [
      { tMs: 0, frame: 0, layer: 'camera', action: 'establish shot, character intro' },
    ];
    for (const peak of peaks) {
      const { layer, action } = classifyV9Peak(peak.normalizedEnergy);
      events.push({ tMs: peak.tMs, frame: tMsToFrame(peak.tMs, useFps), layer, action });
    }
    const lastTMs = events.at(-1)?.tMs || 0;
    if (durationMs - lastTMs > 500) {
      events.push({ tMs: durationMs, frame: tMsToFrame(durationMs, useFps), layer: 'camera', action: 'final pose, hold or freeze' });
    }

    console.log(`[A11][audio-sync] dur=${(durationMs / 1000).toFixed(1)}s fps=${useFps} frames=${frameCount} gap=${minPeakGapMs}ms maxPeaks=${maxPeaks} events=${events.length} source=${analysisSource}`);
    return { durationMs, fps: useFps, source: analysisSource, events };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function isLikelyAudioUrl(url = '') {
  const pathname = String(url).split('?')[0];
  return AUDIO_EXTENSIONS.test(pathname);
}

function formatAudioMotionPlanForPrompt(plan) {
  if (!plan || !Array.isArray(plan.events) || plan.events.length === 0) return '';
  const header = `Audio duration: ${(plan.durationMs / 1000).toFixed(1)}s @ ${plan.fps}fps (analysis: ${plan.source})`;
  const rows = plan.events.map((e) =>
    `  t=${(e.tMs / 1000).toFixed(2)}s(frame ${e.frame}) [${e.layer}] → ${e.action}`
  );
  return `${header}\nTemporal sync plan:\n${rows.join('\n')}`;
}

module.exports = {
  buildAudioMotionPlan,
  buildFallbackPlan,
  isLikelyAudioUrl,
  formatAudioMotionPlanForPrompt,
};
