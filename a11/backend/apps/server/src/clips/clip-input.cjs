'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const {
  downloadRemoteMedia,
  parsePositiveInteger,
  resolveSafeRemoteUrl,
  splitList,
} = require('../security/safe-media-input.cjs');

const DEFAULT_AUDIO_HOSTS = Object.freeze([
  'a11.funesterie.me',
  'vivy.funesterie.me',
  'music.funesterie.me',
  'files.funesterie.me',
]);
const DEFAULT_VIDEO_HOSTS = Object.freeze([
  'cloud.comfy.org',
  '*.comfy.org',
]);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.mov']);

function getAllowedHosts(kind, env = process.env) {
  const configured = splitList(kind === 'video'
    ? env?.NOSSEN_CLIP_VIDEO_ALLOWED_HOSTS
    : env?.NOSSEN_CLIP_AUDIO_ALLOWED_HOSTS);
  return configured.length ? configured : [...(kind === 'video' ? DEFAULT_VIDEO_HOSTS : DEFAULT_AUDIO_HOSTS)];
}

function getMaxBytes(kind, env = process.env) {
  return parsePositiveInteger(
    kind === 'video' ? env?.NOSSEN_CLIP_VIDEO_MAX_BYTES : env?.NOSSEN_CLIP_AUDIO_MAX_BYTES,
    kind === 'video' ? 512 * 1024 * 1024 : 50 * 1024 * 1024,
    1024,
    1024 * 1024 * 1024,
  );
}

function getAllowedExtensions(kind) {
  return kind === 'video' ? VIDEO_EXTENSIONS : AUDIO_EXTENSIONS;
}

function getAllowedContentTypes(kind) {
  return kind === 'video'
    ? ['video/*', 'application/octet-stream']
    : ['audio/*', 'application/ogg'];
}

function assertContainedPath(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, target);
  if (!relative || relative === '.') throw new Error('clip_media_file_required');
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('clip_media_path_forbidden');
  return target;
}

function resolveLocalClipMedia(value, { kind = 'audio', env = process.env } = {}) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.length > 2048) {
    throw new Error('clip_media_url_invalid');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(raw, 'https://a11.invalid').pathname);
  } catch {
    throw new Error('clip_media_url_invalid');
  }
  if (pathname.includes('\0') || pathname.includes('\\')) throw new Error('clip_media_path_forbidden');

  const runtimeRoot = path.resolve(String(env?.A11_RUNTIME_ROOT || '/app/runtime'));
  const mappings = [
    ['/api/mcp-bridge/play-upload/', path.join(runtimeRoot, 'uploads')],
    ['/api/mcp-bridge/play/', path.join(runtimeRoot, 'double-harmonic-d40')],
    ['/api/vivy/studio/assets/', path.join(runtimeRoot, 'vivy-studio-assets')],
  ];
  const mapping = mappings.find(([prefix]) => pathname.startsWith(prefix));
  if (!mapping) throw new Error('clip_media_local_route_forbidden');

  const relativePath = pathname.slice(mapping[0].length);
  const target = assertContainedPath(mapping[1], relativePath);
  const extension = path.extname(target).toLowerCase();
  if (!getAllowedExtensions(kind).has(extension)) throw new Error('clip_media_extension_forbidden');
  return { type: 'local', path: target, pathname };
}

async function inspectClipMediaSource(value, {
  kind = 'audio',
  env = process.env,
  lookupImpl,
} = {}) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) throw new Error('clip_media_url_invalid');
  if (raw.startsWith('/')) return resolveLocalClipMedia(raw, { kind, env });

  const resolved = await resolveSafeRemoteUrl(raw, {
    allowHttp: String(env?.NOSSEN_CLIP_ALLOW_HTTP || '').trim() === '1',
    allowedHosts: getAllowedHosts(kind, env),
    ...(lookupImpl ? { lookupImpl } : {}),
  });
  return { type: 'remote', url: resolved.url.toString() };
}

async function validateClipSongUrl(value, options = {}) {
  const source = await inspectClipMediaSource(value, { ...options, kind: 'audio' });
  return source.type === 'local' ? source.pathname : source.url;
}

async function materializeClipMedia(value, destination, {
  kind = 'audio',
  env = process.env,
  fetchImpl,
  lookupImpl,
} = {}) {
  const source = await inspectClipMediaSource(value, { kind, env, lookupImpl });
  const maxBytes = getMaxBytes(kind, env);
  await fs.mkdir(path.dirname(destination), { recursive: true });

  if (source.type === 'local') {
    const stats = await fs.stat(source.path).catch(() => null);
    if (!stats?.isFile()) throw new Error('clip_media_local_file_missing');
    if (stats.size > maxBytes) throw new Error('media_payload_too_large');
    await fs.copyFile(source.path, destination);
    return destination;
  }

  const downloaded = await downloadRemoteMedia(source.url, {
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(lookupImpl ? { lookupImpl } : {}),
    allowHttp: String(env?.NOSSEN_CLIP_ALLOW_HTTP || '').trim() === '1',
    allowedHosts: getAllowedHosts(kind, env),
    allowedContentTypes: getAllowedContentTypes(kind),
    maxBytes,
    maxRedirects: 3,
    timeoutMs: parsePositiveInteger(env?.NOSSEN_CLIP_DOWNLOAD_TIMEOUT_MS, 30_000, 1_000, 120_000),
    userAgent: 'NOSSEN-Clip-Worker/1.0',
  });
  await fs.writeFile(destination, downloaded.buffer, { mode: 0o600 });
  return destination;
}

module.exports = {
  AUDIO_EXTENSIONS,
  DEFAULT_AUDIO_HOSTS,
  DEFAULT_VIDEO_HOSTS,
  getAllowedHosts,
  getMaxBytes,
  inspectClipMediaSource,
  materializeClipMedia,
  resolveLocalClipMedia,
  validateClipSongUrl,
};
