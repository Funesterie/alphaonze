'use strict';

const { execFile } = require('node:child_process');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

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
  'storage.googleapis.com',
]);
const COMFY_GCS_HOST = 'storage.googleapis.com';
const COMFY_GCS_PREFIX = '/comfy-cloud-assets/';
const LOCAL_ROUTE_PREFIXES = Object.freeze([
  '/api/mcp-bridge/play-upload/',
  '/api/mcp-bridge/play/',
  '/api/vivy/studio/assets/',
]);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.mov']);
const execFileAsync = promisify(execFile);

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

function getLocalMappings(env = process.env) {
  const runtimeRoot = path.resolve(String(env?.A11_RUNTIME_ROOT || '/app/runtime'));
  return [
    [LOCAL_ROUTE_PREFIXES[0], [path.join(runtimeRoot, 'uploads')]],
    [LOCAL_ROUTE_PREFIXES[1], [path.join(runtimeRoot, 'double-harmonic-d40')]],
    // Même racine que getEmergencyMediaAssetPath(), qui sert réellement
    // /api/vivy/studio/assets/:filename. L'ancien dossier reste un alias de
    // lecture borné pour les volumes créés avant cette correction.
    [LOCAL_ROUTE_PREFIXES[2], [
      path.join(runtimeRoot, 'files', 'generated', 'vivy'),
      path.join(runtimeRoot, 'vivy-studio-assets'),
    ]],
  ];
}

function getOwnedMediaHosts(env = process.env) {
  return new Set([
    ...DEFAULT_AUDIO_HOSTS,
    ...splitList(env?.NOSSEN_CLIP_LOCAL_HOSTS),
  ]);
}

function assertClipRemoteUrlPolicy(value, kind = 'audio') {
  const url = value instanceof URL ? value : new URL(String(value || ''));
  if (url.hostname.toLowerCase() !== COMFY_GCS_HOST) return url;
  if (kind !== 'video'
    || url.protocol !== 'https:'
    || (url.port && url.port !== '443')
    || !url.pathname.startsWith(COMFY_GCS_PREFIX)
    || url.pathname.length <= COMFY_GCS_PREFIX.length) {
    throw new Error('clip_video_storage_path_forbidden');
  }
  return url;
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

  const mappings = getLocalMappings(env);
  const mapping = mappings.find(([prefix]) => pathname.startsWith(prefix));
  if (!mapping) throw new Error('clip_media_local_route_forbidden');

  const relativePath = pathname.slice(mapping[0].length);
  const candidates = mapping[1].map((root) => ({ root, path: assertContainedPath(root, relativePath) }));
  const selected = candidates.find((candidate) => fsSync.existsSync(candidate.path)) || candidates[0];
  const target = selected.path;
  const extension = path.extname(target).toLowerCase();
  if (!getAllowedExtensions(kind).has(extension)) throw new Error('clip_media_extension_forbidden');
  return { type: 'local', path: target, root: selected.root, candidates, pathname };
}

function resolveOwnedAbsoluteClipMedia(value, { kind = 'audio', env = process.env } = {}) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return null;
  }
  if (!getOwnedMediaHosts(env).has(url.hostname.toLowerCase())) return null;
  if (!LOCAL_ROUTE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return null;
  if (url.username || url.password) throw new Error('media_url_credentials_forbidden');
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('media_url_protocol_forbidden');
  if (url.protocol === 'http:' && String(env?.NOSSEN_CLIP_ALLOW_HTTP || '').trim() !== '1') {
    throw new Error('media_url_http_forbidden');
  }
  return resolveLocalClipMedia(`${url.pathname}${url.search}`, { kind, env });
}

async function inspectClipMediaSource(value, {
  kind = 'audio',
  env = process.env,
  lookupImpl,
} = {}) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) throw new Error('clip_media_url_invalid');
  if (raw.startsWith('/')) return resolveLocalClipMedia(raw, { kind, env });
  const ownedLocal = resolveOwnedAbsoluteClipMedia(raw, { kind, env });
  if (ownedLocal) return ownedLocal;

  const resolved = await resolveSafeRemoteUrl(raw, {
    allowHttp: String(env?.NOSSEN_CLIP_ALLOW_HTTP || '').trim() === '1',
    allowedHosts: getAllowedHosts(kind, env),
    ...(lookupImpl ? { lookupImpl } : {}),
  });
  assertClipRemoteUrlPolicy(resolved.url, kind);
  return { type: 'remote', url: resolved.url.toString() };
}

async function validateClipSongUrl(value, options = {}) {
  const source = await inspectClipMediaSource(value, { ...options, kind: 'audio' });
  return source.type === 'local' ? source.pathname : source.url;
}

function assertClipMediaSignature(buffer, kind = 'audio') {
  const head = Buffer.from(buffer || Buffer.alloc(0));
  if (!head.length) throw new Error('clip_media_empty');
  const text = head.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (text.startsWith('<!doctype html') || text.startsWith('<html') || text.startsWith('<script')) {
    throw new Error(`clip_${kind}_payload_html`);
  }

  if (kind === 'audio') {
    const valid = head.subarray(0, 3).toString('ascii') === 'ID3'
      || (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
      || (head.length >= 12 && head.subarray(0, 4).toString('ascii') === 'RIFF'
        && head.subarray(8, 12).toString('ascii') === 'WAVE')
      || head.subarray(0, 4).toString('ascii') === 'OggS'
      || head.subarray(0, 4).toString('ascii') === 'fLaC'
      || (head.length >= 12 && head.subarray(4, 8).toString('ascii') === 'ftyp');
    if (!valid) throw new Error('clip_audio_signature_invalid');
    return true;
  }

  const valid = (head.length >= 12 && head.subarray(4, 8).toString('ascii') === 'ftyp')
    || (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3);
  if (!valid) throw new Error('clip_video_signature_invalid');
  return true;
}

async function probeClipMediaFile(filename, { kind = 'audio', probeImpl } = {}) {
  const runProbe = probeImpl || (async (file, mediaKind) => {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', mediaKind === 'video' ? 'v:0' : 'a:0',
      '-show_entries', 'stream=codec_type',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file,
    ], { timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true });
    return stdout;
  });
  let output;
  try {
    output = await runProbe(filename, kind);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error('clip_media_probe_unavailable');
    throw new Error(`clip_${kind}_probe_failed`);
  }
  if (!String(output || '').toLowerCase().split(/\s+/).includes(kind)) {
    throw new Error(`clip_${kind}_probe_failed`);
  }
  return true;
}

async function validateMaterializedClipMedia(filename, { kind = 'audio', probeImpl } = {}) {
  const handle = await fs.open(filename, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new Error('clip_media_file_required');
    if (stats.size <= 0) throw new Error('clip_media_empty');
    const head = Buffer.alloc(Math.min(512, stats.size));
    await handle.read(head, 0, head.length, 0);
    assertClipMediaSignature(head, kind);
  } finally {
    await handle.close();
  }
  await probeClipMediaFile(filename, { kind, probeImpl });
  return true;
}

async function resolveVerifiedLocalFile(source, maxBytes) {
  const root = await fs.realpath(source.root).catch(() => null);
  const target = await fs.realpath(source.path).catch(() => null);
  if (!root || !target) throw new Error('clip_media_local_file_missing');
  const relative = path.relative(root, target);
  if (!relative || relative === '.' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('clip_media_local_path_forbidden');
  }
  const linkStats = await fs.lstat(source.path).catch(() => null);
  if (!linkStats) throw new Error('clip_media_local_file_missing');
  if (linkStats.isSymbolicLink()) throw new Error('clip_media_local_symlink_forbidden');
  const stats = await fs.stat(target);
  if (!stats.isFile()) throw new Error('clip_media_local_file_missing');
  if (stats.size <= 0) throw new Error('clip_media_empty');
  if (stats.size > maxBytes) throw new Error('media_payload_too_large');
  return target;
}

async function materializeClipMedia(value, destination, {
  kind = 'audio',
  env = process.env,
  fetchImpl,
  lookupImpl,
  probeImpl,
} = {}) {
  const source = await inspectClipMediaSource(value, { kind, env, lookupImpl });
  const maxBytes = getMaxBytes(kind, env);
  await fs.mkdir(path.dirname(destination), { recursive: true });

  try {
    if (source.type === 'local') {
      const verifiedPath = await resolveVerifiedLocalFile(source, maxBytes);
      await fs.copyFile(verifiedPath, destination);
    } else {
      const downloaded = await downloadRemoteMedia(source.url, {
        ...(fetchImpl ? { fetchImpl } : {}),
        ...(lookupImpl ? { lookupImpl } : {}),
        validateUrl: (url) => assertClipRemoteUrlPolicy(url, kind),
        allowHttp: String(env?.NOSSEN_CLIP_ALLOW_HTTP || '').trim() === '1',
        allowedHosts: getAllowedHosts(kind, env),
        allowedContentTypes: getAllowedContentTypes(kind),
        maxBytes,
        maxRedirects: 3,
        timeoutMs: parsePositiveInteger(env?.NOSSEN_CLIP_DOWNLOAD_TIMEOUT_MS, 30_000, 1_000, 120_000),
        userAgent: 'NOSSEN-Clip-Worker/1.0',
      });
      assertClipRemoteUrlPolicy(downloaded.finalUrl, kind);
      await fs.writeFile(destination, downloaded.buffer, { mode: 0o600 });
    }
    await validateMaterializedClipMedia(destination, { kind, probeImpl });
    return destination;
  } catch (error) {
    await fs.rm(destination, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = {
  AUDIO_EXTENSIONS,
  DEFAULT_AUDIO_HOSTS,
  DEFAULT_VIDEO_HOSTS,
  assertClipMediaSignature,
  assertClipRemoteUrlPolicy,
  getAllowedHosts,
  getMaxBytes,
  inspectClipMediaSource,
  materializeClipMedia,
  probeClipMediaFile,
  resolveLocalClipMedia,
  resolveOwnedAbsoluteClipMedia,
  validateMaterializedClipMedia,
  validateClipSongUrl,
};
