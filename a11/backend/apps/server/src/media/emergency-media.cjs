'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

function cleanText(value, max = 400) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, max);
}

function slugify(value = '', fallback = 'funesterie') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

function getWorkspaceRoot() {
  return path.resolve(String(
    process.env.A11_WORKSPACE_ROOT
    || path.resolve(__dirname, '..', '..', '..')
  ).trim());
}

function getRuntimeRoot() {
  return path.resolve(String(
    process.env.A11_RUNTIME_ROOT
    || path.join(getWorkspaceRoot(), 'runtime')
  ).trim());
}

function getVivyGeneratedDir() {
  return path.join(getRuntimeRoot(), 'files', 'generated', 'vivy');
}

function resolveRequestOrigin(req = null) {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || req?.protocol || (req?.socket?.encrypted ? 'https' : 'http');
  const forwardedHost = String(
    req?.headers?.['x-forwarded-host']
    || req?.headers?.host
    || ''
  ).split(',')[0].trim();
  return forwardedHost ? `${proto || 'http'}://${forwardedHost}` : '';
}

function buildPublicUrl(req, publicPath) {
  const origin = String(
    process.env.PUBLIC_API_URL
    || process.env.API_URL
    || process.env.A11_SERVER_URL
    || resolveRequestOrigin(req)
    || ''
  ).replace(/\/+$/, '');
  return origin ? `${origin}${publicPath}` : publicPath;
}

function hashSeed(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest();
}

function writeAscii(target, offset, value) {
  target.write(String(value), offset, 'ascii');
}

function createEmergencyWavBuffer({ seedText = '', durationSeconds = 10, sampleRate = 22050 } = {}) {
  const duration = Math.max(3, Math.min(24, Number(durationSeconds) || 10));
  const samples = Math.max(1, Math.floor(sampleRate * duration));
  const dataBytes = samples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  const seed = hashSeed(seedText);
  const notes = [220, 246.94, 261.63, 293.66, 329.63, 369.99, 392, 440, 493.88, 523.25, 587.33, 659.25];

  writeAscii(buffer, 0, 'RIFF');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  writeAscii(buffer, 8, 'WAVE');
  writeAscii(buffer, 12, 'fmt ');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  writeAscii(buffer, 36, 'data');
  buffer.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const beat = Math.floor(t * 2.4);
    const noteIndex = (seed[beat % seed.length] + beat) % notes.length;
    const bassIndex = (noteIndex + 7) % notes.length;
    const freq = notes[noteIndex];
    const bass = notes[bassIndex] / 2;
    const attack = Math.min(1, t / 0.18);
    const release = Math.min(1, (duration - t) / 0.8);
    const env = Math.max(0, Math.min(attack, release));
    const tremolo = 0.68 + (0.16 * Math.sin(2 * Math.PI * 4.2 * t));
    const sample = (
      Math.sin(2 * Math.PI * freq * t)
      + 0.45 * Math.sin(2 * Math.PI * bass * t)
      + 0.18 * Math.sin(2 * Math.PI * (freq * 1.5) * t)
    ) / 1.63;
    const value = Math.max(-1, Math.min(1, sample * env * tremolo * 0.48));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }

  return buffer;
}

async function createEmergencySongAsset(input = {}, req = null) {
  const material = cleanText([
    input.songText,
    input.lyrics,
    input.text,
    input.theme,
    input.instruction,
    input.prompt,
    input.songMood,
  ].filter(Boolean).join('\n'), 1600);
  const title = cleanText(input.title || input.songTitle || material.split(/\n|[.!?]/).find(Boolean), 80) || 'Vivy emergency song';
  const digest = crypto.createHash('sha1').update(`${title}\n${material}`).digest('hex').slice(0, 10);
  const filename = `vivy-song-${slugify(title, 'song')}-${digest}.wav`;
  const dir = getVivyGeneratedDir();
  const filePath = path.join(dir, filename);

  await fsp.mkdir(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    const wav = createEmergencyWavBuffer({
      seedText: `${title}\n${material}`,
      durationSeconds: input.durationSeconds || input.duration || 12,
    });
    await fsp.writeFile(filePath, wav);
  }

  const url = buildPublicUrl(req, `/api/vivy/studio/assets/${encodeURIComponent(filename)}`);
  return {
    ok: true,
    kind: 'audio',
    provider: 'a11-emergency-wav',
    mode: 'emergency_music_demo',
    title,
    filename,
    path: filePath,
    url,
    audio_url: url,
    audioUrl: url,
    content_type: 'audio/wav',
    durationSeconds: Math.max(3, Math.min(24, Number(input.durationSeconds || input.duration || 12) || 12)),
    emergencyFallback: true,
  };
}

function resolveFfmpegBin() {
  return String(process.env.A11_VIDEO_FFMPEG_BIN || process.env.FFMPEG_BIN || 'ffmpeg').trim() || 'ffmpeg';
}

function runProcess(command, args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command}_timeout`));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '').slice(0, 2000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true });
      else reject(new Error(stderr.trim() || `${command}_exit_${code}`));
    });
  });
}

async function createEmergencyVideoAsset({ prompt = '', body = {}, req = null } = {}) {
  const title = cleanText(body.title || prompt || body.message || 'Funesterie emergency clip', 100);
  const digest = crypto.createHash('sha1').update(`${title}\n${Date.now()}`).digest('hex').slice(0, 10);
  const dir = path.join(getRuntimeRoot(), 'files', 'generated', 'videos');
  const baseName = `a11-emergency-video-${slugify(title, 'clip')}-${digest}`;
  const filename = `${baseName}.mp4`;
  const filePath = path.join(dir, filename);
  await fsp.mkdir(dir, { recursive: true });

  const duration = Math.max(2, Math.min(10, Number(body.durationSeconds || body.duration || 4) || 4));
  const fps = Math.max(6, Math.min(18, Number(body.fps || 12) || 12));
  const width = Math.max(256, Math.min(720, Number(body.width || 512) || 512));
  const height = Math.max(256, Math.min(720, Number(body.height || 512) || 512));
  const tone = 220 + (hashSeed(title)[0] % 280);

  const args = [
    '-y',
    '-f', 'lavfi',
    '-i', `testsrc2=size=${width}x${height}:rate=${fps}:duration=${duration}`,
    '-f', 'lavfi',
    '-i', `sine=frequency=${tone}:duration=${duration}`,
    '-shortest',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-movflags', '+faststart',
    filePath,
  ];
  try {
    await runProcess(resolveFfmpegBin(), args, {
      timeoutMs: Math.max(15000, Math.min(45000, Number(body.timeoutMs || 25000) || 25000)),
    });

    const publicPath = `/files/runtime/files/generated/videos/${encodeURIComponent(filename)}`;
    const url = buildPublicUrl(req, publicPath);
    return {
      ok: true,
      kind: 'video',
      provider: 'a11-emergency-ffmpeg',
      mode: 'emergency_video_demo',
      filename,
      path: filePath,
      url,
      video_url: url,
      videoUrl: url,
      content_type: 'video/mp4',
      durationSeconds: duration,
      fps,
      width,
      height,
      emergencyFallback: true,
    };
  } catch (error) {
    const fallbackName = `${baseName}.gif`;
    const fallbackPath = path.join(dir, fallbackName);
    const fallbackGif = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      'base64'
    );
    await fsp.writeFile(fallbackPath, fallbackGif);
    const publicPath = `/files/runtime/files/generated/videos/${encodeURIComponent(fallbackName)}`;
    const url = buildPublicUrl(req, publicPath);
    return {
      ok: true,
      kind: 'video',
      provider: 'a11-emergency-gif',
      mode: 'emergency_video_demo',
      filename: fallbackName,
      path: fallbackPath,
      url,
      video_url: url,
      videoUrl: url,
      content_type: 'image/gif',
      durationSeconds: 1,
      fps: 1,
      width: 1,
      height: 1,
      warning: 'ffmpeg_unavailable',
      message: String(error?.message || error || 'ffmpeg_unavailable'),
      emergencyFallback: true,
    };
  }
}

function getEmergencyMediaAssetPath(filename = '') {
  const safeName = path.basename(String(filename || '').trim());
  if (!safeName || !/^[a-z0-9_.-]+$/i.test(safeName)) return '';
  return path.join(getVivyGeneratedDir(), safeName);
}

module.exports = {
  createEmergencySongAsset,
  createEmergencyVideoAsset,
  getEmergencyMediaAssetPath,
};
