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

function getGeneratedImageDir() {
  return path.join(getRuntimeRoot(), 'files', 'generated', 'images');
}

function resolveRequestOrigin(req = null) {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const rawProto = forwardedProto || req?.protocol || (req?.socket?.encrypted ? 'https' : 'http');
  const forwardedHost = String(
    req?.headers?.['x-forwarded-host']
    || req?.headers?.host
    || ''
  ).split(',')[0].trim();
  if (!forwardedHost) return '';
  const hostWithoutPort = forwardedHost.split(':')[0];
  const isLocalHost = hostWithoutPort === '127.0.0.1'
    || hostWithoutPort === 'localhost'
    || hostWithoutPort === '::1'
    || /^10\./.test(hostWithoutPort)
    || /^192\.168\./.test(hostWithoutPort)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostWithoutPort);
  const proto = rawProto === 'http' && !isLocalHost ? 'https' : rawProto;
  return `${proto || 'http'}://${forwardedHost}`;
}

function buildPublicUrl(req, publicPath) {
  const requestOrigin = resolveRequestOrigin(req);
  const origin = String(
    requestOrigin
    || process.env.PUBLIC_API_URL
    || process.env.API_URL
    || process.env.A11_SERVER_URL
    || ''
  ).replace(/\/+$/, '');
  return origin ? `${origin}${publicPath}` : publicPath;
}

function hashSeed(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest();
}

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapSvgText(value = '', maxLineLength = 34, maxLines = 6) {
  const words = cleanText(value, 420).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLineLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length ? lines : ['Image fallback A11'];
}

function createEmergencyImageSvg({ prompt = '', width = 1024, height = 1024 } = {}) {
  const safeWidth = Math.max(256, Math.min(1536, Math.round(Number(width || 1024) || 1024)));
  const safeHeight = Math.max(256, Math.min(1536, Math.round(Number(height || 1024) || 1024)));
  const seed = hashSeed(prompt);
  const accent = `#${seed.subarray(0, 3).toString('hex')}`;
  const secondary = `#${seed.subarray(3, 6).toString('hex')}`;
  const lines = wrapSvgText(prompt).map(escapeXml);
  const lineHeight = Math.max(26, Math.round(safeHeight * 0.045));
  const startY = Math.round((safeHeight - (lines.length * lineHeight)) / 2);
  const textLines = lines.map((line, index) => (
    `<text x="50%" y="${startY + index * lineHeight}" text-anchor="middle" class="prompt">${line}</text>`
  )).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="44%" r="70%">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.48"/>
      <stop offset="54%" stop-color="#111827" stop-opacity="0.86"/>
      <stop offset="100%" stop-color="#02040a" stop-opacity="1"/>
    </radialGradient>
    <linearGradient id="ring" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="${accent}"/>
      <stop offset="55%" stop-color="#75f5d1"/>
      <stop offset="100%" stop-color="${secondary}"/>
    </linearGradient>
    <filter id="soft">
      <feGaussianBlur stdDeviation="5"/>
    </filter>
    <style>
      .brand { font: 800 ${Math.max(42, Math.round(safeWidth * 0.08))}px Arial, sans-serif; fill: #ffffff; letter-spacing: 2px; }
      .sub { font: 600 ${Math.max(18, Math.round(safeWidth * 0.026))}px Arial, sans-serif; fill: #b7f8e8; letter-spacing: 3px; }
      .prompt { font: 600 ${Math.max(18, Math.round(safeWidth * 0.03))}px Arial, sans-serif; fill: #f7fbff; }
      .note { font: 500 ${Math.max(14, Math.round(safeWidth * 0.018))}px Arial, sans-serif; fill: #a7b4c8; }
    </style>
  </defs>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <circle cx="50%" cy="48%" r="${Math.round(Math.min(safeWidth, safeHeight) * 0.34)}" fill="none" stroke="url(#ring)" stroke-width="${Math.max(3, Math.round(safeWidth * 0.008))}" opacity="0.82"/>
  <circle cx="50%" cy="48%" r="${Math.round(Math.min(safeWidth, safeHeight) * 0.28)}" fill="none" stroke="#ffffff" stroke-width="1" opacity="0.16"/>
  <circle cx="22%" cy="24%" r="${Math.round(safeWidth * 0.07)}" fill="${accent}" opacity="0.16" filter="url(#soft)"/>
  <circle cx="79%" cy="74%" r="${Math.round(safeWidth * 0.09)}" fill="${secondary}" opacity="0.15" filter="url(#soft)"/>
  <text x="50%" y="${Math.round(safeHeight * 0.22)}" text-anchor="middle" class="brand">A11</text>
  <text x="50%" y="${Math.round(safeHeight * 0.285)}" text-anchor="middle" class="sub">FUNESTERIE IMAGE FALLBACK</text>
  ${textLines}
  <text x="50%" y="${Math.round(safeHeight * 0.84)}" text-anchor="middle" class="note">Generation de secours activee pendant la reprise media</text>
</svg>`;
}

async function createEmergencyImageAsset({ prompt = '', body = {}, req = null } = {}) {
  const title = cleanText(body.title || body.subject || prompt || body.message || 'A11 emergency image', 100);
  const width = Math.max(256, Math.min(1536, Number(body.width || 1024) || 1024));
  const height = Math.max(256, Math.min(1536, Number(body.height || 1024) || 1024));
  const digest = crypto.createHash('sha1').update(`${title}\n${prompt}`).digest('hex').slice(0, 10);
  const filename = `a11-emergency-image-${slugify(title, 'image')}-${digest}.svg`;
  const dir = getGeneratedImageDir();
  const filePath = path.join(dir, filename);
  await fsp.mkdir(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    await fsp.writeFile(filePath, createEmergencyImageSvg({ prompt: prompt || title, width, height }), 'utf8');
  }
  const url = buildPublicUrl(req, `/files/runtime/files/generated/images/${encodeURIComponent(filename)}`);
  return {
    ok: true,
    kind: 'image',
    artifact_type: 'image',
    provider: 'a11-emergency-svg',
    mode: 'synthetic-frame',
    filename,
    path: filePath,
    output_path: filePath,
    local_path: filePath,
    url,
    image_url: url,
    content_type: 'image/svg+xml',
    width,
    height,
    prompt: cleanText(prompt || title, 1600),
    emergencyFallback: true,
  };
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
  createEmergencyImageAsset,
  createEmergencySongAsset,
  createEmergencyVideoAsset,
  getEmergencyMediaAssetPath,
};
