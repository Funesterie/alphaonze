const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const axios = require('axios');
const AdmZip = require('adm-zip');
const PDFDocument = require('pdfkit');
const fsSync = require('node:fs');
const { exec, spawn } = require('node:child_process');
const { getShellToolName, isShellAllowed } = require('../../lib/safe-shell.cjs');
const { analyzeUploadedResource } = require('../../lib/resource-reader.cjs');
const {
  resolveSdProxyUrl,
  resolveSdScriptPath,
  runSdScript,
} = require('../../lib/sd-runtime.cjs');
const {
  callJanusVisionText,
  resolveJanusVisionConfig,
  resolveVisionProvider,
} = require('../../lib/janus-vision-runtime.cjs');
const {
  buildSdPromptBundle,
  compileCharacterCountConstraints,
} = require('../mask/build-sd-prompt-bundle.cjs');
const { compileMaskImageGenerateRuntime } = require('../mask/image-chat-runtime.cjs');
const {
  buildCanonicalImageMaskFromText,
} = require('../mask/resolve-image-mask-from-text.cjs');
const { callStructuredLlmJson } = require('../mask/resolve-text-to-wazaa.cjs');
const {
  resolveSubjectProfile,
} = require('../mask/semantic/subject-profile-library.cjs');

// ⚠️ IMPORTANT : importer le manifest AVANT d'utiliser WORKSPACE_ROOTS
const { TOOL_MANIFEST, WORKSPACE_ROOTS, SAFE_DATA_ROOT } = require('./tools-manifest.cjs');
const { runQflushFlow } = require('../qflush-integration.cjs');
const { callA11Host, getA11HostStatus } = require('../../a11host.cjs');

function resolveSafePath(p, label) {
  const raw = String(p || "").trim();
  if (!raw) throw new Error(`${label || "path"}: empty path not allowed`);
  const target = path.isAbsolute(raw)
    ? path.join(SAFE_DATA_ROOT, path.relative(path.parse(raw).root, raw))
    : path.join(SAFE_DATA_ROOT, raw.replace(/^[/\\]+/, ""));
  if (!target.startsWith(SAFE_DATA_ROOT)) {
    throw new Error(`${label || "path"}: path outside SAFE_DATA_ROOT is forbidden`);
  }
  return target;
}

function isPathWithinRoot(targetPath, rootPath) {
  const target = path.resolve(String(targetPath || ''));
  const root = path.resolve(String(rootPath || ''));
  const normalizedTarget = process.platform === 'win32' ? target.toLowerCase() : target;
  const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root;
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep);
}

function resolveManagedPath(p, label) {
  const raw = String(p || '').trim();
  if (!raw) throw new Error(`${label || 'path'}: empty path not allowed`);

  if (!path.isAbsolute(raw)) {
    return resolveSafePath(raw, label);
  }

  const absolute = path.resolve(raw);
  const allowedRoots = [SAFE_DATA_ROOT, ...(Array.isArray(WORKSPACE_ROOTS) ? WORKSPACE_ROOTS : [])];
  if (allowedRoots.some((root) => isPathWithinRoot(absolute, root))) {
    return absolute;
  }

  throw new Error(`${label || 'path'}: path outside allowed roots`);
}

// ─────────────────────────────
// Base mémoire JSON pour A-11
// ─────────────────────────────

// Workspace de base pour la mémoire.
const DEFAULT_WORKSPACE_ROOT =
  (Array.isArray(WORKSPACE_ROOTS) && WORKSPACE_ROOTS[0]) ||
  process.cwd();

// ⚠️ Renommé → A11_MEMORY_ROOT pour éviter tout conflit avec d'autres modules
const A11_MEMORY_ROOT = path.resolve(DEFAULT_WORKSPACE_ROOT, 'a11_memory');
const A11_MEMO_DIR = path.join(A11_MEMORY_ROOT, 'memos');

function slugifyAssetSegment(value, fallback = 'asset', maxLength = 80) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, Math.max(12, Number(maxLength || 80) || 80))
    .replace(/[-._]+$/g, '');
  return normalized || fallback;
}

function buildGeneratedAssetPath(filename, label = 'generated.outputPath') {
  return resolveSafePath(path.join('generated', filename), label);
}

function guessDownloadExtension(rawExt, contentType = '') {
  const normalizedExt = String(rawExt || '').trim().toLowerCase();
  if (/^\.[a-z0-9]{1,10}$/i.test(normalizedExt)) {
    return normalizedExt;
  }
  const normalizedType = String(contentType || '').trim().toLowerCase().split(';')[0];
  switch (normalizedType) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/gif':
      return '.gif';
    case 'image/webp':
      return '.webp';
    case 'application/pdf':
      return '.pdf';
    case 'text/plain':
      return '.txt';
    case 'text/markdown':
      return '.md';
    case 'application/json':
    case 'text/json':
      return '.json';
    case 'audio/wav':
    case 'audio/x-wav':
      return '.wav';
    default:
      return '.bin';
  }
}

function getInternalApiBaseUrl() {
  const configured = String(process.env.A11_INTERNAL_API_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  const port = String(process.env.PORT || 3000).trim() || '3000';
  return `http://127.0.0.1:${port}`;
}

function getAuthTokenFromContext(context = {}) {
  return String(context.authToken || context.token || '').trim();
}

function guessContentType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.txt':
    case '.md':
      return 'text/plain; charset=utf-8';
    case '.json':
      return 'application/json';
    case '.csv':
      return 'text/csv; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    default:
      return 'application/octet-stream';
  }
}

function extractShareFileDownloadUrl(result = {}) {
  return String(
    result?.file?.downloadUrl
    || result?.conversationResource?.downloadUrl
    || ''
  ).trim();
}

async function fetchInternalJson(pathname, options = {}, context = {}) {
  const authToken = getAuthTokenFromContext(context);
  if (!authToken) {
    throw new Error(`${pathname}: authenticated user context required`);
  }

  const url = `${getInternalApiBaseUrl()}${pathname}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-NEZ-TOKEN': authToken,
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(async () => ({
    ok: false,
    error: await res.text().catch(() => 'invalid_response'),
  }));

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      ...(data && typeof data === 'object' ? data : { error: String(data) }),
    };
  }

  return data;
}

async function fetchInternalBuffer(pathname, options = {}, context = {}) {
  const authToken = getAuthTokenFromContext(context);
  if (!authToken) {
    throw new Error(`${pathname}: authenticated user context required`);
  }

  const url = `${getInternalApiBaseUrl()}${pathname}`;
  const headers = {
    'X-NEZ-TOKEN': authToken,
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
  });

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: buffer.toString('utf8') || `${pathname}: request_failed`,
    };
  }

  return {
    ok: true,
    status: res.status,
    buffer,
    contentType: String(res.headers.get('content-type') || '').trim(),
    contentLength: Number(res.headers.get('content-length') || buffer.length || 0),
  };
}

function listAttachmentPaths(args = {}) {
  const items = [];
  if (typeof args.path === 'string' && args.path.trim()) items.push(args.path);
  if (typeof args.attachmentPath === 'string' && args.attachmentPath.trim()) items.push(args.attachmentPath);
  if (typeof args.filePath === 'string' && args.filePath.trim()) items.push(args.filePath);
  if (typeof args.outputPath === 'string' && args.outputPath.trim()) items.push(args.outputPath);
  if (Array.isArray(args.paths)) items.push(...args.paths);
  if (Array.isArray(args.attachments)) {
    for (const item of args.attachments) {
      if (typeof item === 'string' && item.trim()) items.push(item);
      else if (item && typeof item === 'object' && typeof item.path === 'string' && item.path.trim()) items.push(item.path);
    }
  }
  return Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean)));
}

function buildResourceRefCandidates(ref) {
  const raw = String(ref || '').trim();
  if (!raw) return [];

  const filename = path.basename(raw);
  const noQuery = filename.split('?')[0].split('#')[0];
  const stem = noQuery.replace(/\.[^.]+$/, '');
  const normalized = [raw, filename, noQuery, stem]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return Array.from(new Set(normalized));
}

function isLikelyImageResource(resource) {
  const contentType = String(resource?.contentType || '').toLowerCase();
  if (contentType.startsWith('image/')) return true;
  const filename = String(resource?.filename || '').toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filename);
}

function scoreConversationResourceMatch(resource, candidates) {
  const id = Number(resource?.id || 0);
  const filename = String(resource?.filename || '').trim().toLowerCase();
  const url = String(resource?.url || '').trim().toLowerCase();
  const stem = filename.replace(/\.[^.]+$/, '');
  let score = 0;

  for (const candidate of candidates) {
    const normalized = String(candidate || '').trim().toLowerCase();
    if (!normalized) continue;
    if (Number.isFinite(id) && id > 0 && normalized === String(id)) score = Math.max(score, 120);
    if (normalized === filename) score = Math.max(score, 110);
    if (normalized === path.basename(filename)) score = Math.max(score, 105);
    if (normalized === stem) score = Math.max(score, 95);
    if (filename.includes(normalized)) score = Math.max(score, 72);
    if (url && (url === normalized || url.includes(normalized))) score = Math.max(score, 68);
  }

  if (isLikelyImageResource(resource)) score += 12;
  return score;
}

async function listConversationResourcesForContext(options = {}) {
  const context = options.context || {};
  const cache = options.resourceCache && typeof options.resourceCache === 'object' ? options.resourceCache : null;
  if (cache?.resourcesPromise) return cache.resourcesPromise;

  const conversationId = String(
    options.conversationId ||
    context.conversationId ||
    context.convId ||
    context.sessionId ||
    ''
  ).trim();
  if (!conversationId) return [];

  const search = new URLSearchParams();
  search.set('conversationId', conversationId);
  search.set('limit', String(Math.max(10, Math.min(60, Number(options.limit || 40)))));

  const promise = fetchInternalJson(`/api/resources/my?${search.toString()}`, {
    method: 'GET',
  }, context)
    .then((result) => (result?.ok && Array.isArray(result.resources) ? result.resources : []))
    .catch(() => []);

  if (cache) cache.resourcesPromise = promise;
  return promise;
}

async function resolveStoredConversationResource(ref, options = {}) {
  const rawRef = String(ref || '').trim();
  if (!rawRef) return null;

  const cache = options.resourceCache && typeof options.resourceCache === 'object' ? options.resourceCache : null;
  if (cache?.resolvedByRef instanceof Map && cache.resolvedByRef.has(rawRef)) {
    return cache.resolvedByRef.get(rawRef) || null;
  }

  const candidates = buildResourceRefCandidates(rawRef);
  if (!candidates.length) return null;

  const resources = await listConversationResourcesForContext(options);
  if (!resources.length) {
    if (cache?.resolvedByRef instanceof Map) cache.resolvedByRef.set(rawRef, null);
    return null;
  }

  let best = null;
  let bestScore = 0;
  for (const resource of resources) {
    const score = scoreConversationResourceMatch(resource, candidates);
    if (score > bestScore) {
      best = resource;
      bestScore = score;
    }
  }

  const selected = bestScore >= 68 ? best : null;
  if (cache?.resolvedByRef instanceof Map) cache.resolvedByRef.set(rawRef, selected);
  return selected;
}

async function listStoredFilesForContext(options = {}) {
  const context = options.context || {};
  const cache = options.resourceCache && typeof options.resourceCache === 'object' ? options.resourceCache : null;
  if (cache?.storedFilesPromise) return cache.storedFilesPromise;

  const limit = Math.max(10, Math.min(80, Number(options.limit || 50)));
  const promise = fetchInternalJson(`/api/files/my?limit=${limit}`, {
    method: 'GET',
  }, context)
    .then((result) => (result?.ok && Array.isArray(result.files) ? result.files : []))
    .catch(() => []);

  if (cache) cache.storedFilesPromise = promise;
  return promise;
}

async function resolveStoredUserFile(ref, options = {}) {
  const rawRef = String(ref || '').trim();
  if (!rawRef) return null;

  const cache = options.resourceCache && typeof options.resourceCache === 'object' ? options.resourceCache : null;
  if (cache?.resolvedStoredFilesByRef instanceof Map && cache.resolvedStoredFilesByRef.has(rawRef)) {
    return cache.resolvedStoredFilesByRef.get(rawRef) || null;
  }

  const candidates = buildResourceRefCandidates(rawRef);
  if (!candidates.length) return null;

  const files = await listStoredFilesForContext(options);
  if (!files.length) {
    if (cache?.resolvedStoredFilesByRef instanceof Map) cache.resolvedStoredFilesByRef.set(rawRef, null);
    return null;
  }

  let best = null;
  let bestScore = 0;
  for (const file of files) {
    const score = scoreConversationResourceMatch({
      id: file?.id,
      filename: file?.filename,
      url: file?.url,
      contentType: file?.content_type || file?.contentType,
    }, candidates);
    if (score > bestScore) {
      best = file;
      bestScore = score;
    }
  }

  const selected = bestScore >= 68 ? best : null;
  if (cache?.resolvedStoredFilesByRef instanceof Map) cache.resolvedStoredFilesByRef.set(rawRef, selected);
  return selected;
}

function isImageLikeContentType(value) {
  return String(value || '').trim().toLowerCase().startsWith('image/');
}

function isImageLikeFilename(value) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(String(value || '').trim());
}

function getExistingResourceAnalysis(resource) {
  const metadata = resource?.metadata && typeof resource.metadata === 'object' ? resource.metadata : null;
  const analysis = metadata?.analysis && typeof metadata.analysis === 'object' ? metadata.analysis : null;
  return analysis || null;
}

async function findLatestImageConversationResource(options = {}) {
  const resources = await listConversationResourcesForContext({
    ...options,
    limit: Math.max(12, Number(options.limit || 24)),
  });
  if (!Array.isArray(resources) || !resources.length) return null;
  return resources.find((resource) => {
    const analysis = getExistingResourceAnalysis(resource);
    return isImageLikeContentType(resource?.contentType)
      || isImageLikeFilename(resource?.filename)
      || isImageLikeContentType(analysis?.mime)
      || isImageLikeFilename(resource?.url);
  }) || null;
}

async function loadConversationResourceBuffer(resource, context = {}) {
  const resourceId = Number(resource?.id || 0);
  if (!Number.isFinite(resourceId) || resourceId <= 0) return null;
  const downloaded = await fetchInternalBuffer(`/api/resources/${resourceId}/download`, {
    method: 'GET',
  }, context);
  if (!downloaded?.ok || !downloaded.buffer) {
    throw new Error(downloaded?.error || downloaded?.message || 'resource_download_failed');
  }
  return {
    buffer: downloaded.buffer,
    filename: String(resource?.filename || `resource-${resourceId}.bin`).trim(),
    contentType: String(downloaded.contentType || resource?.contentType || '').trim() || 'application/octet-stream',
    source: 'conversation_resource',
    resourceId,
    resource,
  };
}

async function resolveVisionImageSource(args = {}, options = {}) {
  const context = options.context || {};
  const conversationId = String(
    options.conversationId ||
    args.conversationId ||
    args.convId ||
    args.sessionId ||
    context.conversationId ||
    ''
  ).trim();
  const resourceCache = options.resourceCache && typeof options.resourceCache === 'object'
    ? options.resourceCache
    : {
        resolvedByRef: new Map(),
        resolvedStoredFilesByRef: new Map(),
        resourcesPromise: null,
        storedFilesPromise: null,
      };
  const explicitRef = String(
    args.path ||
    args.imagePath ||
    args.filePath ||
    args.resourceRef ||
    args.ref ||
    args.url ||
    ''
  ).trim();
  const requestedResourceId = Number(args.resourceId || args.resource_id || args.id || 0);

  if (Number.isFinite(requestedResourceId) && requestedResourceId > 0) {
    const resources = await listConversationResourcesForContext({
      context,
      conversationId,
      resourceCache,
      limit: 60,
    });
    const matched = resources.find((entry) => Number(entry?.id || 0) === requestedResourceId) || null;
    if (!matched) {
      throw new Error(`vision_analyze: resource ${requestedResourceId} introuvable`);
    }
    return loadConversationResourceBuffer(matched, context);
  }

  if (explicitRef) {
    const matchedResource = await resolveStoredConversationResource(explicitRef, {
      context,
      conversationId,
      resourceCache,
      limit: 60,
    }).catch(() => null);
    if (matchedResource) {
      return loadConversationResourceBuffer(matchedResource, context);
    }

    const matchedFile = await resolveStoredUserFile(explicitRef, {
      context,
      conversationId,
      resourceCache,
      limit: 60,
    }).catch(() => null);
    if (matchedFile?.url) {
      const response = await fetch(String(matchedFile.url));
      if (!response.ok) {
        throw new Error(`vision_analyze: impossible de recuperer ${matchedFile.url} (${response.status})`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        buffer,
        filename: String(matchedFile.filename || path.basename(explicitRef) || 'image').trim(),
        contentType: String(matchedFile.content_type || matchedFile.contentType || guessContentType(matchedFile.filename || explicitRef)).trim(),
        source: 'stored_file',
        file: matchedFile,
      };
    }

    if (/^https?:\/\//i.test(explicitRef)) {
      const response = await fetch(explicitRef);
      if (!response.ok) {
        throw new Error(`vision_analyze: impossible de recuperer ${explicitRef} (${response.status})`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        buffer,
        filename: path.basename(new URL(explicitRef).pathname || 'image'),
        contentType: String(response.headers.get('content-type') || '').trim() || 'application/octet-stream',
        source: 'remote_url',
        url: explicitRef,
      };
    }

    const localPath = resolveManagedPath(explicitRef, 'vision_analyze.path');
    if (!fsSync.existsSync(localPath)) {
      throw new Error(`vision_analyze: image introuvable (${localPath})`);
    }
    const stats = fsSync.statSync(localPath);
    if (!stats.isFile()) {
      throw new Error(`vision_analyze: le chemin n'est pas un fichier (${localPath})`);
    }
    return {
      buffer: await fsp.readFile(localPath),
      filename: path.basename(localPath),
      contentType: guessContentType(localPath),
      source: 'local_path',
      path: localPath,
    };
  }

  const latestImage = await findLatestImageConversationResource({
    context,
    conversationId,
    resourceCache,
    limit: 40,
  });
  if (!latestImage) {
    throw new Error('vision_analyze: aucune image recente trouvee dans cette conversation');
  }
  return loadConversationResourceBuffer(latestImage, context);
}

function extractVisionTextContent(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (entry && typeof entry === 'object' && entry.type === 'text') {
          return String(entry.text || '').trim();
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

async function describeImageWithRemoteVision(source, args = {}) {
  const apiKey = String(
    args.apiKey ||
    process.env.A11_VISION_API_KEY ||
    ''
  ).trim();
  const baseUrl = String(
    args.baseUrl ||
    process.env.A11_VISION_BASE_URL ||
    ''
  ).trim();
  const model = String(
    args.model ||
    process.env.A11_VISION_MODEL ||
    process.env.OPENAI_VISION_MODEL ||
    'gpt-4o-mini'
  ).trim();

  if (!apiKey || !baseUrl || !Buffer.isBuffer(source?.buffer) || !source.buffer.length) {
    return null;
  }

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const url = normalizedBase.endsWith('/v1')
    ? `${normalizedBase}/chat/completions`
    : `${normalizedBase}/v1/chat/completions`;
  const task = String(args.task || 'describe').trim().toLowerCase();
  const prompt = task === 'ocr'
    ? "Lis tout le texte visible dans l'image. Si aucun texte n'est visible, dis-le clairement."
    : "Decris tres brievement ce qui est visible dans cette image, sans inventer. Si le contenu est incertain, dis-le.";
  const dataUrl = `data:${String(source.contentType || 'image/png').trim() || 'image/png'};base64,${source.buffer.toString('base64')}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'Tu es un module de vision pour A11. Reponds en francais, en 1 ou 2 phrases courtes maximum, sans inventer.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 220,
      stream: false,
    }),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`vision_remote_failed:${response.status}:${rawText.slice(0, 240)}`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return rawText.trim();
  }

  return extractVisionTextContent(parsed?.choices?.[0]?.message?.content || parsed?.output_text || '');
}

async function describeImageWithConfiguredVision(source, args = {}) {
  const provider = resolveVisionProvider({ provider: args.provider || args.visionProvider });
  const task = String(args.task || 'describe').trim().toLowerCase();
  const janusPrompt = task === 'ocr'
    ? "Lis tout le texte visible dans cette image. Si aucun texte n'est visible, dis-le clairement en francais."
    : "Decris tres brievement ce qui est visible dans cette image, en francais, sans inventer. Si le contenu est incertain, dis-le.";

  if (provider === 'janus') {
    try {
      const janus = resolveJanusVisionConfig({
        modelRef: args.janusModelRef,
        device: args.janusDevice,
        torchDtype: args.janusTorchDtype,
      });
      const result = await callJanusVisionText({
        imageBuffer: source?.buffer,
        contentType: source?.contentType,
        prompt: janusPrompt,
        maxNewTokens: Math.min(janus.maxNewTokens, 220),
        timeoutMs: janus.timeoutMs,
        modelRef: janus.modelRef,
        device: janus.device,
        torchDtype: janus.torchDtype,
      });
      const text = String(result?.text || result || '').trim();
      if (text) return text;
    } catch (error_) {
      if (provider !== 'janus') return '';
    }
  }

  try {
    return String(await describeImageWithRemoteVision(source, args) || '').trim();
  } catch {
    return '';
  }
}

function buildVisionSummary(source, analysis, remoteDescription, task = '') {
  const normalizedTask = String(task || '').trim().toLowerCase();
  if (remoteDescription) return remoteDescription;
  if (analysis?.readableInChatContext && analysis.preview) {
    return normalizedTask === 'ocr'
      ? `J'ai pu lire ce texte dans l'image : ${String(analysis.preview).trim()}`
      : `Je peux au moins lire ceci dans l'image : ${String(analysis.preview).trim()}`;
  }

  const format = String(analysis?.format || source?.contentType || 'image').trim();
  const width = Number(analysis?.width || 0) || null;
  const height = Number(analysis?.height || 0) || null;
  const dimensions = width && height ? ` (${width}x${height})` : '';
  return `Je peux confirmer que c'est une image ${format}${dimensions}, mais aucun modele vision n'est configure ici pour decrire son contenu visuel avec fiabilite.`;
}

function normalizeRecipientsInput(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(
      value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    ));
  }

  const raw = String(value || '').trim();
  if (!raw) return [];
  return Array.from(new Set(
    raw
      .split(/[;,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  ));
}

function buildAttachmentPayload(fullPath, index = 0, forcedFilename = '') {
  if (!fsSync.existsSync(fullPath)) {
    throw new Error(`attachment file not found: ${fullPath}`);
  }
  const stats = fsSync.statSync(fullPath);
  if (!stats.isFile()) {
    throw new Error(`attachment path is not a file: ${fullPath}`);
  }
  const buffer = fsSync.readFileSync(fullPath);
  return {
    filename: forcedFilename && index === 0 ? String(forcedFilename).trim() : path.basename(fullPath),
    contentBase64: buffer.toString('base64'),
    contentType: guessContentType(fullPath),
    sizeBytes: stats.size,
  };
}

function buildDownloadedAssetPath(sourceUrl, label = 'download_file.path', contentType = '') {
  const fallbackName = `download-${Date.now()}.bin`;
  let filename = fallbackName;
  try {
    const parsed = new URL(String(sourceUrl || ''));
    const rawName = path.basename(parsed.pathname || '') || '';
    const ext = path.extname(rawName).toLowerCase();
    const baseName = path.basename(rawName, ext);
    const safeBase = slugifyAssetSegment(baseName || 'download', 'download');
    const safeExt = guessDownloadExtension(ext, contentType);
    filename = `${safeBase}-${Date.now()}${safeExt}`;
  } catch {
    filename = fallbackName;
  }
  return resolveSafePath(path.join('downloads', filename), label);
}

async function resolveWriteTarget(filePath, options = {}) {
  const {
    overwrite = false,
    content = '',
    encoding = 'utf8',
  } = options;

  if (overwrite || !fsSync.existsSync(filePath)) {
    return {
      path: filePath,
      requestedPath: filePath,
      collisionResolved: false,
      reusedExisting: false,
    };
  }

  try {
    const existingBuffer = await fsp.readFile(filePath);
    const incomingBuffer = Buffer.isBuffer(content)
      ? content
      : Buffer.from(String(content ?? ''), encoding);
    if (Buffer.compare(existingBuffer, incomingBuffer) === 0) {
      return {
        path: filePath,
        requestedPath: filePath,
        collisionResolved: false,
        reusedExisting: true,
      };
    }
  } catch {
    // ignore comparison issues and fall through to path suffixing
  }

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const baseName = path.basename(filePath, ext);
  for (let index = 2; index <= 9999; index += 1) {
    const candidate = path.join(dir, `${baseName}-${index}${ext}`);
    if (!fsSync.existsSync(candidate)) {
      return {
        path: candidate,
        requestedPath: filePath,
        collisionResolved: true,
        reusedExisting: false,
      };
    }
  }

  const fallback = path.join(dir, `${baseName}-${Date.now()}${ext}`);
  return {
    path: fallback,
    requestedPath: filePath,
    collisionResolved: true,
    reusedExisting: false,
  };
}

function parseImageSize(value, fallbackWidth = 1024, fallbackHeight = 1024) {
  const raw = String(value || '').trim().toLowerCase();
  const match = /^(\d{2,4})\s*[xX]\s*(\d{2,4})$/.exec(raw);
  if (!match) {
    return { width: fallbackWidth, height: fallbackHeight };
  }
  const width = Math.max(64, Math.min(2048, Number(match[1]) || fallbackWidth));
  const height = Math.max(64, Math.min(2048, Number(match[2]) || fallbackHeight));
  return { width, height };
}

function hasExplicitImageCanvasArgs(args = {}) {
  return (
    args.width !== undefined
    || args.height !== undefined
    || String(args.imageSize || '').trim() !== ''
  );
}

function getMaskSubjectProfileType(mask = {}) {
  return String(
    mask?.meta?.subjectProfile?.type
    || mask?.meta?.semantic?.subjectProfile?.type
    || ''
  ).trim().toLowerCase();
}

function inferAutoImageCanvas(promptText = '', mask = null) {
  const rawPrompt = String(promptText || mask?.raw || '').trim();
  const pair = compileCharacterCountConstraints(rawPrompt);
  if (pair?.count === 2) {
    return {
      width: 1024,
      height: 768,
      reason: 'pair_landscape',
    };
  }

  const subjectProfileType = getMaskSubjectProfileType(mask);
  const resolvedProfile = subjectProfileType
    ? { type: subjectProfileType }
    : resolveSubjectProfile({
      subject: rawPrompt,
      sourceText: rawPrompt,
    });
  const resolvedProfileType = String(resolvedProfile?.type || '').trim().toLowerCase();
  const hasHumanFigureCue = /\b(maillot(?:\s+de\s+bain)?|bikini|swimsuit|bathing suit|robe|dress|armure|armor|costume|tenue|lingerie|gown|cape|veste|jacket|shirt|chemise|jupe|skirt)\b/i.test(rawPrompt);
  const hasFullBodyCue = /\b(corps entier|plein pied|en pied|full[\s-]?body|head to toe)\b/i.test(rawPrompt);

  if (
    ['reference_character', 'single_human_figure'].includes(resolvedProfileType)
    || hasHumanFigureCue
    || hasFullBodyCue
  ) {
    return {
      width: 768,
      height: 1024,
      reason: 'single_figure_portrait',
    };
  }

  return {
    width: 1024,
    height: 1024,
    reason: 'default_square',
  };
}

function ensureMemoDir() {
  try {
    fs.mkdirSync(A11_MEMO_DIR, { recursive: true });
  } catch (e) {
    console.warn('[A11][tools-memo] mkdir failed:', e && e.message);
  }
}

function saveMemoEntry(type, data) {
  try {
    ensureMemoDir();
    const ts = new Date().toISOString();
    const safeType = (type || 'generic').replace(/[^a-z0-9_\-]/gi, '_');
    const id = `${ts.replace(/[:.]/g, '-')}_${safeType}`;
    const entry = { id, type: safeType, ts, data };
    const file = path.join(A11_MEMO_DIR, `${id}.json`);
    fs.writeFileSync(file, JSON.stringify(entry, null, 2), 'utf8');
    return entry;
  } catch (e) {
    console.warn('[A11][tools-memo] save failed:', e && e.message);
    return null;
  }
}

// Tool accessible via Cerbère / A-11 pour enregistrer un mémo JSON
async function t_a11_save_memo(args = {}) {
  const { type, data } = args;
  if (!type) throw new Error('a11_save_memo: missing "type"');
  const entry = saveMemoEntry(type, data ?? {});
  if (!entry) {
    return { ok: false, error: 'saveMemoEntry failed' };
  }
  return { ok: true, memo: entry };
}

// Mémoire persistante A-11
const MEMORY_FACTS_PATH = path.join(A11_MEMORY_ROOT, 'facts.json');

async function ensureMemoryFolder() {
  try {
    await fsp.mkdir(A11_MEMORY_ROOT, { recursive: true });
    if (!fsSync.existsSync(MEMORY_FACTS_PATH)) {
      await fsp.writeFile(MEMORY_FACTS_PATH, '{}', 'utf8');
    }
  } catch (e) {
    console.warn('[A11][memory] ensureMemoryFolder error:', e && e.message);
  }
}

async function loadFacts() {
  await ensureMemoryFolder();
  try {
    const raw = await fsp.readFile(MEMORY_FACTS_PATH, 'utf8');
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveFacts(obj) {
  await ensureMemoryFolder();
  const safe = obj && typeof obj === 'object' ? obj : {};
  await fsp.writeFile(MEMORY_FACTS_PATH, JSON.stringify(safe, null, 2), 'utf8');
}

async function t_download_file(args = {}) {
  const { url } = args;

  if (!url || typeof url !== 'string') {
    throw new Error('download_file: missing "url"');
  }

  // 🔒 Garde-fou anti-URL factice (example.com, dummy, about:blank, etc.)
  const lower = url.toLowerCase();
  if (
    lower.includes('example.com') ||
    lower.includes('dummy') ||
    lower === 'about:blank' ||
    lower.startsWith('data:')
  ) {
    return {
      ok: false,
      url,
      outputPath: null,
      error: 'invalid_dummy_url',
      message:
        'download_file: refused dummy URL (example.com / dummy / about:blank / data:). ' +
        'Le LLM doit appeler web_search puis utiliser une URL réelle.'
    };
  }

  const explicitOutputPath = args.path || args.outputPath
    ? resolveSafePath(args.path || args.outputPath, 'download_file.path')
    : null;

  let response;
  try {
    response = await axios.get(url, {
      responseType: 'arraybuffer',
      validateStatus: s => s >= 200 && s < 400, // handle errors manually
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
  } catch (e) {
    return {
      ok: false,
      url,
      outputPath: explicitOutputPath,
      error: String(e && e.message)
    };
  }

  if (response.status >= 400) {
    return {
      ok: false,
      url,
      outputPath: explicitOutputPath,
      status: response.status,
      error: `HTTP ${response.status}`
    };
  }

  // 🔒 Vérifie le content-type
  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
    return {
      ok: false,
      url,
      outputPath: explicitOutputPath,
      error: 'html_content_type_not_supported',
      message: `download_file: HTML page responses are not supported (${contentType})`
    };
  }

  const requestedPath = explicitOutputPath || buildDownloadedAssetPath(url, 'download_file.path', contentType);
  const writeTarget = await resolveWriteTarget(requestedPath, {
    overwrite: args.overwrite === true,
    content: Buffer.from(response.data),
  });

  await fsp.mkdir(path.dirname(writeTarget.path), { recursive: true });
  if (!writeTarget.reusedExisting) {
    await fsp.writeFile(writeTarget.path, response.data);
  }

  let stat;
  try {
    stat = await fsp.stat(writeTarget.path);
  } catch (e) {
    return {
      ok: false,
      error: 'download_stat_failed',
      details: e?.message,
      path: writeTarget.path,
      requestedPath: writeTarget.requestedPath,
    };
  }

  let meta = null;
  if (contentType.startsWith('image/')) {
    try {
      const sharp = require('sharp');
      if (stat.size < 8000) {
        return { ok: false, error: "BAD_IMAGE_TOO_SMALL", path: writeTarget.path };
      }
      meta = await sharp(writeTarget.path).metadata();
      if (!meta.width || !meta.height) {
        return { ok: false, error: "BAD_IMAGE_NO_METADATA", path: writeTarget.path };
      }
      if (meta.width < 350 && meta.height < 350) {
        return { ok: false, error: "BAD_IMAGE_PLACEHOLDER_DIMENSIONS", path: writeTarget.path, meta };
      }
    } catch (e) {
      return { ok: false, error: "BAD_IMAGE_VALIDATION_FAILED", details: e?.message, path: writeTarget.path };
    }
  }

  return {
    ok: true,
    url,
    outputPath: writeTarget.path,
    requestedPath: writeTarget.requestedPath,
    collisionResolved: writeTarget.collisionResolved,
    reusedExisting: writeTarget.reusedExisting,
    contentType,
    size: stat.size,
    meta,
  };
}

async function t_share_file(args = {}) {
  const context = args._context || {};
  const fullPath = resolveManagedPath(args.path || args.outputPath || args.filePath, 'share_file.path');
  if (!fsSync.existsSync(fullPath)) {
    return { ok: false, error: 'File not found', path: fullPath };
  }

  const stats = fsSync.statSync(fullPath);
  if (!stats.isFile()) {
    return { ok: false, error: 'Path is not a file', path: fullPath };
  }

  const buffer = fsSync.readFileSync(fullPath);
  const recipients = normalizeRecipientsInput(args.emailTo || args.to || args.email || args.recipient || args.recipients || '');
  const attachToEmail = recipients.length
    ? args.attachToEmail !== false && args.asAttachment !== false
    : (args.attachToEmail === true || args.asAttachment === true);
  const conversationId = String(
    args.conversationId ||
    args.convId ||
    args.sessionId ||
    context.conversationId ||
    context.convId ||
    context.sessionId ||
    ''
  ).trim();
  const payload = {
    filename: args.filename || path.basename(fullPath),
    contentBase64: buffer.toString('base64'),
    contentType: args.contentType || guessContentType(fullPath),
    conversationId: conversationId || null,
    emailTo: recipients.length ? recipients : '',
    emailSubject: args.emailSubject || args.subject || '',
    emailMessage: args.emailMessage || args.message || args.body || args.text || '',
    attachToEmail,
    ttlSeconds: Number.isFinite(Number(args.ttlSeconds)) && Number(args.ttlSeconds) > 0
      ? Number(args.ttlSeconds)
      : 3600,
  };

  const result = await fetchInternalJson('/api/files/upload', {
    method: 'POST',
    body: payload,
  }, context);

  if (result?.ok) {
    const publicDownloadUrl = extractShareFileDownloadUrl(result);
    if (!publicDownloadUrl) {
      return {
        ok: false,
        path: fullPath,
        error: 'public_download_url_missing',
        detail: result,
      };
    }
    return {
      ok: true,
      path: fullPath,
      file: result.file || null,
      mail: result.mail || null,
      record: result.record || null,
      conversationResource: result.conversationResource || null,
      url: publicDownloadUrl,
      expiresAt: result?.file?.expiresAt || result?.conversationResource?.expiresAt || null,
    };
  }

  const errorCode = String(result?.error || result?.message || '').trim();
  const storageLikelyFailed = /r2_|upload_failed|signature|storage|public_download_url_missing/i.test(errorCode)
    || /signature/i.test(String(result?.detail?.message || result?.detail?.error || ''));
  if (recipients.length && storageLikelyFailed) {
    const mailFallback = await t_send_email({
      ...args,
      to: recipients,
      path: fullPath,
      filename: payload.filename,
      attachToEmail: true,
      _context: context,
      conversationId: conversationId || null,
    });

    if (mailFallback?.ok) {
      return {
        ok: true,
        path: fullPath,
        file: null,
        mail: mailFallback.mail || null,
        record: null,
        conversationResource: null,
        url: '',
        expiresAt: null,
        mailOnly: true,
        storageFallbackReason: errorCode || 'storage_failed',
      };
    }
  }

  return {
    ok: false,
    path: fullPath,
    error: result?.error || result?.message || 'share_file_failed',
    detail: result,
  };
}

async function t_list_stored_files(args = {}) {
  const context = args._context || {};
  const limit = Number.isFinite(Number(args.limit))
    ? Math.max(1, Math.min(100, Number(args.limit)))
    : 20;
  const result = await fetchInternalJson(`/api/files/my?limit=${limit}`, {
    method: 'GET',
  }, context);
  if (result?.ok) return result;
  return {
    ok: false,
    error: result?.error || result?.message || 'list_stored_files_failed',
    detail: result,
  };
}

async function t_list_resources(args = {}) {
  const context = args._context || {};
  const limit = Number.isFinite(Number(args.limit))
    ? Math.max(1, Math.min(100, Number(args.limit)))
    : 20;
  const search = new URLSearchParams();
  search.set('limit', String(limit));
  if (String(args.conversationId || args.convId || args.sessionId || '').trim()) {
    search.set('conversationId', String(args.conversationId || args.convId || args.sessionId).trim());
  }
  if (String(args.kind || args.resourceKind || '').trim()) {
    search.set('kind', String(args.kind || args.resourceKind).trim());
  }

  const result = await fetchInternalJson(`/api/resources/my?${search.toString()}`, {
    method: 'GET',
  }, context);
  if (result?.ok) return result;
  return {
    ok: false,
    error: result?.error || result?.message || 'list_resources_failed',
    detail: result,
  };
}

async function t_email_resource(args = {}) {
  const context = args._context || {};
  const resourceId = Number(args.resourceId || args.resource_id || args.id || args.conversationResourceId || 0);
  if (!Number.isFinite(resourceId) || resourceId <= 0) {
    throw new Error('email_resource: missing valid "resourceId"');
  }

  const recipients = normalizeRecipientsInput(args.to || args.emailTo || args.email || args.recipient || args.recipients || '');
  if (!recipients.length) {
    throw new Error('email_resource: missing "to"');
  }

  const payload = {
    resourceId,
    to: recipients,
    subject: args.subject || args.emailSubject || '',
    message: args.message || args.emailMessage || args.body || args.text || '',
    attachToEmail: args.attachToEmail === true || args.asAttachment === true || args.attach === true,
  };

  const result = await fetchInternalJson('/api/resources/email', {
    method: 'POST',
    body: payload,
  }, context);

  if (result?.ok) {
    return {
      ok: true,
      resourceId,
      to: recipients,
      mail: result.mail || null,
      resource: result.resource || null,
    };
  }

  return {
    ok: false,
    resourceId,
    to: recipients,
    error: result?.error || result?.message || 'email_resource_failed',
    detail: result,
  };
}

async function t_get_latest_resource(args = {}) {
  const context = args._context || {};
  const search = new URLSearchParams();
  if (String(args.conversationId || args.convId || args.sessionId || '').trim()) {
    search.set('conversationId', String(args.conversationId || args.convId || args.sessionId).trim());
  }
  if (String(args.kind || args.resourceKind || '').trim()) {
    search.set('kind', String(args.kind || args.resourceKind).trim());
  }

  const suffix = search.toString() ? `?${search.toString()}` : '';
  const result = await fetchInternalJson(`/api/resources/latest${suffix}`, {
    method: 'GET',
  }, context);

  if (result?.ok) return result;
  return {
    ok: false,
    error: result?.error || result?.message || 'get_latest_resource_failed',
    detail: result,
  };
}

async function t_email_latest_resource(args = {}) {
  const context = args._context || {};
  const recipients = normalizeRecipientsInput(args.to || args.emailTo || args.email || args.recipient || args.recipients || '');
  if (!recipients.length) {
    throw new Error('email_latest_resource: missing "to"');
  }

  const payload = {
    conversationId: args.conversationId || args.convId || args.sessionId || null,
    kind: args.kind || args.resourceKind || '',
    to: recipients,
    subject: args.subject || args.emailSubject || '',
    message: args.message || args.emailMessage || args.body || args.text || '',
    attachToEmail: args.attachToEmail === true || args.asAttachment === true || args.attach === true,
  };

  const result = await fetchInternalJson('/api/resources/latest/email', {
    method: 'POST',
    body: payload,
  }, context);

  if (result?.ok) {
    return {
      ok: true,
      to: recipients,
      mail: result.mail || null,
      resource: result.resource || null,
      latest: true,
    };
  }

  return {
    ok: false,
    to: recipients,
    error: result?.error || result?.message || 'email_latest_resource_failed',
    detail: result,
  };
}

async function t_schedule_email(args = {}) {
  const context = args._context || {};
  const recipients = normalizeRecipientsInput(args.to || args.emailTo || args.email || args.recipient || args.recipients || '');
  if (!recipients.length) {
    throw new Error('schedule_email: missing "to"');
  }

  const attachmentPaths = args.attachToEmail !== false ? listAttachmentPaths(args) : [];
  const attachments = attachmentPaths.map((candidate, index) => {
    const fullPath = resolveManagedPath(candidate, `schedule_email.path[${index}]`);
    return buildAttachmentPayload(fullPath, index, args.filename || '');
  });

  const payload = {
    kind: 'email',
    to: recipients,
    subject: args.subject || args.emailSubject || 'A11',
    message: args.message || args.emailMessage || args.body || args.text || args.content || '',
    html: args.html || '',
    conversationId: args.conversationId || args.convId || args.sessionId || null,
    sendAt: args.sendAt || args.when || '',
    delaySeconds: args.delaySeconds || args.delay || args.inSeconds || null,
    delayMinutes: args.delayMinutes || args.inMinutes || null,
    attachments,
  };

  const result = await fetchInternalJson('/api/mail/schedule', {
    method: 'POST',
    body: payload,
  }, context);

  if (result?.ok) return result;
  return {
    ok: false,
    error: result?.error || result?.message || 'schedule_email_failed',
    detail: result,
  };
}

async function t_schedule_resource_email(args = {}) {
  const context = args._context || {};
  const recipients = normalizeRecipientsInput(args.to || args.emailTo || args.email || args.recipient || args.recipients || '');
  if (!recipients.length) {
    throw new Error('schedule_resource_email: missing "to"');
  }

  const resourceId = Number(args.resourceId || args.resource_id || args.id || args.conversationResourceId || 0);
  if (!Number.isFinite(resourceId) || resourceId <= 0) {
    throw new Error('schedule_resource_email: missing valid "resourceId"');
  }

  const result = await fetchInternalJson('/api/mail/schedule', {
    method: 'POST',
    body: {
      kind: 'resource_email',
      resourceId,
      to: recipients,
      subject: args.subject || args.emailSubject || '',
      message: args.message || args.emailMessage || args.body || args.text || '',
      conversationId: args.conversationId || args.convId || args.sessionId || null,
      sendAt: args.sendAt || args.when || '',
      delaySeconds: args.delaySeconds || args.delay || args.inSeconds || null,
      delayMinutes: args.delayMinutes || args.inMinutes || null,
      attachToEmail: args.attachToEmail === true || args.asAttachment === true || args.attach === true,
    },
  }, context);

  if (result?.ok) return result;
  return {
    ok: false,
    error: result?.error || result?.message || 'schedule_resource_email_failed',
    detail: result,
  };
}

async function t_schedule_latest_resource_email(args = {}) {
  const context = args._context || {};
  const recipients = normalizeRecipientsInput(args.to || args.emailTo || args.email || args.recipient || args.recipients || '');
  if (!recipients.length) {
    throw new Error('schedule_latest_resource_email: missing "to"');
  }

  const result = await fetchInternalJson('/api/mail/schedule', {
    method: 'POST',
    body: {
      kind: 'latest_resource_email',
      to: recipients,
      subject: args.subject || args.emailSubject || '',
      message: args.message || args.emailMessage || args.body || args.text || '',
      conversationId: args.conversationId || args.convId || args.sessionId || null,
      kindFilter: args.kind || args.resourceKind || '',
      sendAt: args.sendAt || args.when || '',
      delaySeconds: args.delaySeconds || args.delay || args.inSeconds || null,
      delayMinutes: args.delayMinutes || args.inMinutes || null,
      attachToEmail: args.attachToEmail === true || args.asAttachment === true || args.attach === true,
    },
  }, context);

  if (result?.ok) return result;
  return {
    ok: false,
    error: result?.error || result?.message || 'schedule_latest_resource_email_failed',
    detail: result,
  };
}

async function t_list_scheduled_emails(args = {}) {
  const context = args._context || {};
  const search = new URLSearchParams();
  const limit = Number.isFinite(Number(args.limit))
    ? Math.max(1, Math.min(100, Number(args.limit)))
    : 20;
  search.set('limit', String(limit));
  if (String(args.status || '').trim()) {
    search.set('status', String(args.status).trim());
  }

  const result = await fetchInternalJson(`/api/mail/scheduled?${search.toString()}`, {
    method: 'GET',
  }, context);
  if (result?.ok) return result;
  return {
    ok: false,
    error: result?.error || result?.message || 'list_scheduled_emails_failed',
    detail: result,
  };
}

async function t_cancel_scheduled_email(args = {}) {
  const context = args._context || {};
  const jobId = String(args.jobId || args.id || args.scheduledId || '').trim();
  if (!jobId) {
    throw new Error('cancel_scheduled_email: missing "jobId"');
  }

  const result = await fetchInternalJson(`/api/mail/scheduled/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    body: {},
  }, context);
  if (result?.ok) return result;
  return {
    ok: false,
    error: result?.error || result?.message || 'cancel_scheduled_email_failed',
    detail: result,
  };
}

async function t_send_email(args = {}) {
  const context = args._context || {};
  const recipients = normalizeRecipientsInput(args.to || args.emailTo || args.email || args.recipient || args.recipients || '');
  if (!recipients.length) {
    throw new Error('send_email: missing "to"');
  }

  const includeAttachments = args.attachToEmail !== false;
  const attachmentPaths = includeAttachments ? listAttachmentPaths(args) : [];
  const attachments = attachmentPaths.map((candidate, index) => {
    const fullPath = resolveManagedPath(candidate, `send_email.path[${index}]`);
    return buildAttachmentPayload(fullPath, index, args.filename || '');
  });

  const payload = {
    to: recipients,
    subject: args.subject || args.emailSubject || 'A11',
    message: args.message || args.emailMessage || args.body || args.text || args.content || '',
    html: args.html || '',
    conversationId: args.conversationId || args.convId || args.sessionId || null,
    attachments,
  };

  const result = await fetchInternalJson('/api/mail/send', {
    method: 'POST',
    body: payload,
  }, context);

  if (result?.ok) {
    return {
      ok: true,
      to: recipients,
      subject: payload.subject,
      attachmentCount: attachments.length,
      mail: result.mail || null,
    };
  }

  return {
    ok: false,
    to: recipients,
    subject: payload.subject,
    error: result?.error || result?.message || 'send_email_failed',
    detail: result,
  };
}

function isPathInRoots(p) {
  const resolved = path.resolve(p);
  return WORKSPACE_ROOTS.some(root => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
}

function assertPathAllowed(p, label = 'path') {
  if (!p || typeof p !== 'string') {
    throw new Error(`Invalid ${label}: must be a non-empty string`);
  }
  if (!isPathInRoots(p)) {
    throw new Error(`Path outside allowed roots: ${p}`);
  }
}

const PROTECTED_PATH_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.env',
  '.a11_backups',
  '.qflash',
  '.qflush'
]);

const SAFE_MODE = String(process.env.A11_SAFE_MODE ?? 'true').toLowerCase() !== 'false';

function hasDeleteConfirmation(args = {}) {
  const token = String(args.confirm || args.confirmation || '').trim();
  return args.confirmDelete === true && token === 'DELETE';
}

function isProtectedPath(targetPath) {
  const normalized = path.resolve(String(targetPath || '')).toLowerCase();
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts.some((segment) => PROTECTED_PATH_SEGMENTS.has(segment));
}

function assertDeleteGuards(targetPath, args = {}) {
  console.log('[A11 ACTION]', {
    action: 'delete',
    path: targetPath,
    user: args.user || args.requestedBy || 'unknown',
    timestamp: Date.now()
  });
  if (SAFE_MODE) {
    throw new Error('delete operation refused: SAFE_MODE is enabled');
  }
  if (!hasDeleteConfirmation(args)) {
    throw new Error(
      'delete operation refused: explicit confirmation required (confirmDelete=true and confirm="DELETE")'
    );
  }
  if (isProtectedPath(targetPath)) {
    throw new Error(`delete operation refused on protected path: ${targetPath}`);
  }
}

function ensureToolAvailable(name) {
  const spec = TOOL_MANIFEST[name];
  if (!spec) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return spec;
}

// QFLUSH
async function t_qflush_flow(args = {}) {
  const { flow, payload } = args;
  if (!flow || typeof flow !== 'string') {
    throw new Error('qflush_flow: missing "flow"');
  }
  return await runQflushFlow(flow, payload || {}, {
    admin: args.admin === true,
  });
}

function resolveQflushMemoryScope(args = {}) {
  const context = args._context || {};
  const explicitScope = String(args.scope || '').trim();
  if (explicitScope) return explicitScope;
  const conversationId = String(
    args.conversationId ||
    args.convId ||
    args.sessionId ||
    context.conversationId ||
    ''
  ).trim();
  if (conversationId) return `conversation:${conversationId}`;
  const userId = String(args.userId || context.userId || '').trim();
  if (userId) return `user:${userId}`;
  return 'shared';
}

function resolveQflushMemoryNamespace(args = {}) {
  return String(args.namespace || 'a11').trim() || 'a11';
}

async function runQflushMemoryOperation(op, args = {}) {
  return await runQflushFlow('a11.memory.ephemeral.v1', {
    op,
    key: args.key,
    value: args.value,
    ttlSec: args.ttlSec ?? args.ttl ?? args.expiresInSec,
    scope: resolveQflushMemoryScope(args),
    namespace: resolveQflushMemoryNamespace(args),
    prefix: args.prefix,
    limit: args.limit,
    metadata: args.metadata,
  }, {
    admin: true,
  });
}

async function t_qflush_memory_write(args = {}) {
  if (!String(args.key || '').trim()) {
    throw new Error('qflush_memory_write: missing "key"');
  }
  return await runQflushMemoryOperation('set', args);
}

async function t_qflush_memory_read(args = {}) {
  if (!String(args.key || '').trim()) {
    throw new Error('qflush_memory_read: missing "key"');
  }
  return await runQflushMemoryOperation('get', args);
}

async function t_qflush_memory_list(args = {}) {
  return await runQflushMemoryOperation('list', args);
}

async function t_qflush_memory_delete(args = {}) {
  if (!String(args.key || '').trim()) {
    throw new Error('qflush_memory_delete: missing "key"');
  }
  return await runQflushMemoryOperation('delete', args);
}

async function t_qflush_memory_clear(args = {}) {
  return await runQflushMemoryOperation('clear', args);
}

// FS
async function t_fs_read(args = {}) {
  const { path: filePath } = args;
  assertPathAllowed(filePath, 'fs_read.path');
  const data = await fsp.readFile(filePath, 'utf8');
  return { ok: true, path: filePath, content: data };
}

async function t_fs_write(args = {}) {
  const { path: filePath, content, overwrite } = args;
  assertPathAllowed(filePath, 'fs_write.path');
  const writeTarget = await resolveWriteTarget(filePath, {
    overwrite: overwrite === true,
    content: String(content || ''),
  });
  await fsp.mkdir(path.dirname(writeTarget.path), { recursive: true });
  if (!writeTarget.reusedExisting) {
    await fsp.writeFile(writeTarget.path, String(content || ''), 'utf8');
  }
  return {
    ok: true,
    path: writeTarget.path,
    requestedPath: writeTarget.requestedPath,
    collisionResolved: writeTarget.collisionResolved,
    reusedExisting: writeTarget.reusedExisting,
  };
}

async function t_write_file(args = {}) {
  const rawPath = args.path;
  const filePath = resolveSafePath(rawPath, "write_file.path");
  const writeTarget = await resolveWriteTarget(filePath, {
    overwrite: args.overwrite === true,
    content: String(args.content || ''),
  });
  await fsp.mkdir(path.dirname(writeTarget.path), { recursive: true });
  if (!writeTarget.reusedExisting) {
    await fsp.writeFile(writeTarget.path, String(args.content || ''), 'utf8');
  }
  return {
    ok: true,
    path: writeTarget.path,
    requestedPath: writeTarget.requestedPath,
    collisionResolved: writeTarget.collisionResolved,
    reusedExisting: writeTarget.reusedExisting,
  };
}

async function t_fs_list(args = {}) {
  const { path: dirPath } = args;
  assertPathAllowed(dirPath, 'fs_list.path');
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  const items = entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
  return { ok: true, path: dirPath, items };
}

async function t_fs_stat(args = {}) {
  const { path: p } = args;
  assertPathAllowed(p, 'fs_stat.path');
  const st = await fsp.stat(p);
  return {
    ok: true,
    path: p,
    isFile: st.isFile(),
    isDirectory: st.isDirectory(),
    size: st.size,
    mtime: st.mtimeMs,
    ctime: st.ctimeMs
  };
}

async function t_fs_delete(args = {}) {
  const { path: p } = args;
  assertPathAllowed(p, 'fs_delete.path');
  assertDeleteGuards(p, args);
  if (!fsSync.existsSync(p)) {
    return { ok: true, deleted: false, reason: 'not_exists', path: p };
  }
  const st = await fsp.stat(p);
  if (st.isDirectory()) {
    await fsp.rm(p, { recursive: true, force: true });
  } else {
    await fsp.unlink(p);
  }
  return { ok: true, deleted: true, path: p };
}

async function t_fs_move(args = {}) {
  const { from, to } = args;
  assertPathAllowed(from, 'fs_move.from');
  assertPathAllowed(to, 'fs_move.to');
  await fsp.mkdir(path.dirname(to), { recursive: true });
  await fsp.rename(from, to);
  return { ok: true, from, to };
}

function buildZipEntryName(candidatePath, usedEntries) {
  const rawBase = path.basename(candidatePath) || `entry-${usedEntries.size + 1}`;
  const ext = path.extname(rawBase);
  const name = path.basename(rawBase, ext);
  let entryName = rawBase;
  let suffix = 2;
  while (usedEntries.has(entryName.toLowerCase())) {
    entryName = `${name}-${suffix}${ext}`;
    suffix += 1;
  }
  usedEntries.add(entryName.toLowerCase());
  return entryName;
}

async function createZipBundle(args = {}) {
  const rawInputPaths = Array.isArray(args.inputPaths)
    ? args.inputPaths
    : Array.isArray(args.paths)
      ? args.paths
      : [];
  if (!rawInputPaths.length) {
    throw new Error('zip_create: inputPaths must be a non-empty array');
  }

  const outputPath = args.outputPath
    ? resolveManagedPath(args.outputPath, 'zip_create.outputPath')
    : buildGeneratedAssetPath(`bundle-${Date.now()}.zip`, 'zip_create.outputPath');
  const inputPaths = rawInputPaths.map((candidate, index) => resolveManagedPath(candidate, `zip_create.inputPaths[${index}]`));
  const zip = new AdmZip();
  const usedEntries = new Set();

  for (const inputPath of inputPaths) {
    const stats = fsSync.statSync(inputPath);
    if (stats.isDirectory()) {
      zip.addLocalFolder(inputPath, buildZipEntryName(inputPath, usedEntries));
    } else {
      zip.addLocalFile(inputPath, '', buildZipEntryName(inputPath, usedEntries));
    }
  }

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  zip.writeZip(outputPath);
  const written = fsSync.statSync(outputPath);

  return {
    ok: true,
    outputPath,
    inputPaths,
    inputCount: inputPaths.length,
    sizeBytes: written.size,
  };
}

async function t_zip_create(args = {}) {
  return createZipBundle(args);
}

async function t_unzip_extract(args = {}) {
  const zipPath = resolveManagedPath(args.zipPath, 'unzip_extract.zipPath');
  const outputDir = args.outputDir
    ? resolveManagedPath(args.outputDir, 'unzip_extract.outputDir')
    : buildGeneratedAssetPath(`unzip-${Date.now()}`, 'unzip_extract.outputDir');
  const zip = new AdmZip(zipPath);
  await fsp.mkdir(outputDir, { recursive: true });
  zip.extractAllTo(outputDir, true);
  return { ok: true, zipPath, outputDir };
}

async function t_zip_and_email(args = {}) {
  const zipResult = await createZipBundle({
    inputPaths: Array.isArray(args.inputPaths) ? args.inputPaths : args.paths,
    outputPath: args.outputPath || args.zipPath || args.path || null,
  });

  const emailResult = await t_send_email({
    ...args,
    path: zipResult.outputPath,
    paths: null,
    attachments: null,
    filename: args.filename || path.basename(zipResult.outputPath),
    subject: args.subject || args.emailSubject || 'A11 — archive ZIP',
    message: args.message || args.emailMessage || args.body || 'Archive ZIP prête.',
  });

  return {
    ok: emailResult?.ok === true,
    zip: zipResult,
    mail: emailResult,
  };
}

// SHELL
async function t_shell_exec(args = {}) {
  const { command, cwd } = args;
  if (!isShellAllowed(command)) {
    throw new Error(`shell_exec: command not allowed by whitelist: "${command}"`);
  }
  if (cwd) assertPathAllowed(cwd, 'shell_exec.cwd');
  return new Promise((resolve) => {
    exec(command, { cwd: cwd || undefined }, (err, stdout, stderr) => {
      if (err) {
        return resolve({
          ok: false,
          command,
          exitCode: err.code ?? -1,
          stdout: stdout?.toString() || '',
          stderr: stderr?.toString() || err.message
        });
      }
      resolve({
        ok: true,
        command,
        exitCode: 0,
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || ''
      });
    });
  });
}

// WEB (via QFLUSH flow)
async function t_web_fetch(args = {}) {
  const { url } = args;
  if (!url || typeof url !== 'string') {
    throw new Error('web_fetch: missing "url"');
  }
  try {
    return await runQflushFlow('web_fetch', { url });
  } catch (error_) {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    const html = String(response.data || '');
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();

    return {
      ok: true,
      url,
      status: Number(response.status || 0) || 200,
      title: titleMatch?.[1]?.replace(/\s+/g, ' ').trim() || undefined,
      content: text.slice(0, 8000),
      fetchedVia: 'http-fallback',
      warning: `web_fetch fallback utilise (QFLUSH indisponible: ${error_?.message || error_})`,
    };
  }
}

// WEB SEARCH (DuckDuckGo minimal)
async function t_web_search(args = {}) {
  const { query, limit } = args;
  const q = (query || "").toString().trim();
  const max = typeof limit === "number" && limit > 0 && limit <= 10 ? limit : 5;

  if (!q) {
    throw new Error("web_search: missing 'query'");
  }

  const url = "https://duckduckgo.com/html/?q=" + encodeURIComponent(q);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  let html = "";
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      signal: controller.signal,
    });
    html = await resp.text();
  } finally {
    clearTimeout(timeoutId);
  }

  const results = [];
  // Extraction des liens classiques
  const regex = /<a[^>]+class=\"result__a\"[^>]*href=\"([^\"]+)\"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]+class=\"result__snippet\"[^>]*>(.*?)<\/a>/gi;

  let match;
  while ((match = regex.exec(html)) && results.length < max) {
    const href = match[1];
    const rawTitle = match[2] || "";
    const rawSnippet = match[3] || "";
    const decodedHref = decodeDuckDuckGoResultUrl(href);

    const title = rawTitle.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const snippet = rawSnippet.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

    results.push({
      title,
      url: decodedHref,
      snippet,
      isImage: false
    });
  }

  // Extraction des liens directs d'images (png, jpg, jpeg, gif, webp)
  const imgRegex = /https?:\/\/(?:[\w.-]+)\/(?:[\w\/-]+)\.(?:png|jpg|jpeg|gif|webp)/gi;
  const imgUrls = html.match(imgRegex) || [];
  for (const imgUrl of imgUrls) {
    // Éviter les doublons
    if (!results.some(r => r.url === imgUrl)) {
      results.push({
        title: 'Image',
        url: imgUrl,
        snippet: '',
        isImage: true
      });
    }
  }

  // Prioriser les images dans le tableau results
  results.sort((a, b) => (a.isImage === b.isImage ? 0 : a.isImage ? -1 : 1));

  return {
    ok: true,
    query: q,
    results
  };
}

function decodeDuckDuckGoResultUrl(rawUrl) {
  const candidate = String(rawUrl || '').trim();
  if (!candidate) return '';

  const normalized = candidate.startsWith('//') ? `https:${candidate}` : candidate;
  try {
    const url = new URL(normalized);
    const uddg = url.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : normalized;
  } catch {
    return normalized;
  }
}

// FS SEARCH (via QFlush)
async function t_fs_search(args = {}) {
  // Appelle QFlush pour effectuer la recherche de fichiers
  return await runQflushFlow('fs.search', args);
}

// LLM ANALYSE (stub)
async function t_llm_analyze_text(args = {}) {
  const { text, task } = args;
  if (!text || typeof text !== 'string') {
    throw new Error('llm_analyze_text: missing "text"');
  }
  return {
    ok: true,
    task: task || 'none',
    textPreview: text.slice(0, 400)
  };
}

// Helper pour charger une image (URL, path, ou ressource de conversation)
async function loadImageBuffer(ref, options = {}) {
  if (!ref || typeof ref !== 'string') {
    return {
      ok: false,
      ref: String(ref || '').trim(),
      error: 'image_ref_missing',
    };
  }

  // URL HTTP/HTTPS
  if (/^https?:\/\//i.test(ref)) {
    try {
      const r = await fetch(ref);
      if (!r.ok) {
        console.warn('[generate_pdf] image URL failed:', ref, r.status);
        return {
          ok: false,
          ref,
          error: 'image_url_unavailable',
          status: Number(r.status || 0) || null,
        };
      }
      const ab = await r.arrayBuffer();
      return {
        ok: true,
        ref,
        source: 'url',
        buffer: Buffer.from(ab),
      };
    } catch (e) {
      console.warn('[generate_pdf] image URL error:', ref, e && e.message);
      return {
        ok: false,
        ref,
        error: 'image_url_fetch_failed',
        detail: e && e.message ? String(e.message) : String(e || ''),
      };
    }
  }

  if (/^\/api\//i.test(ref)) {
    const downloaded = await fetchInternalBuffer(ref, { method: 'GET' }, options.context || {});
    if (downloaded?.ok && downloaded.buffer) {
      return {
        ok: true,
        ref,
        source: 'api',
        buffer: downloaded.buffer,
      };
    }
    return {
      ok: false,
      ref,
      error: 'image_api_unavailable',
      detail: String(downloaded?.error || downloaded?.status || 'unknown'),
    };
  }

  // Chemin local
  let filePath = String(ref).trim();
  if (!path.isAbsolute(filePath)) {
    filePath = resolveSafePath(filePath, 'generate_pdf.image');
  }

  try {
    return {
      ok: true,
      ref,
      source: 'path',
      resolvedPath: filePath,
      buffer: await fsp.readFile(filePath),
    };
  } catch (e) {
    const matchedResource = await resolveStoredConversationResource(ref, options).catch(() => null);
    if (matchedResource?.id) {
      const downloaded = await fetchInternalBuffer(`/api/resources/${matchedResource.id}/download`, {
        method: 'GET',
      }, options.context || {});
      if (downloaded?.ok && downloaded.buffer) {
        return {
          ok: true,
          ref,
          source: 'conversation_resource',
          resourceId: matchedResource.id,
          resolvedPath: `/api/resources/${matchedResource.id}/download`,
          buffer: downloaded.buffer,
        };
      }
      console.warn('[generate_pdf] stored image download failed:', matchedResource.id, downloaded?.error || downloaded?.status || 'unknown');
    }
    const matchedFile = await resolveStoredUserFile(ref, options).catch(() => null);
    if (matchedFile?.url) {
      try {
        const remote = await fetch(String(matchedFile.url));
        if (remote.ok) {
          const arrayBuffer = await remote.arrayBuffer();
          return {
            ok: true,
            ref,
            source: 'stored_file_url',
            resolvedPath: String(matchedFile.url),
            buffer: Buffer.from(arrayBuffer),
          };
        }
        console.warn('[generate_pdf] stored file image URL failed:', matchedFile.url, remote.status);
      } catch (remoteError) {
        console.warn('[generate_pdf] stored file image URL error:', matchedFile.url, remoteError?.message || remoteError);
      }
    }
    console.warn('[generate_pdf] image file not found:', filePath);
    return {
      ok: false,
      ref,
      error: 'image_not_found',
      resolvedPath: filePath,
      detail: e && e.message ? String(e.message) : '',
    };
  }
}

// PDF (generate)
async function t_generate_pdf(args = {}) {
  let { outputPath, title, content, sections, author, date } = args;
  const context = args._context || {};
  const conversationId = String(
    args.conversationId ||
    args.convId ||
    args.sessionId ||
    context.conversationId ||
    context.convId ||
    context.sessionId ||
    ''
  ).trim();
  const resourceCache = {
    resolvedByRef: new Map(),
    resolvedStoredFilesByRef: new Map(),
    resourcesPromise: null,
    storedFilesPromise: null,
  };

  outputPath = outputPath
    ? resolveSafePath(outputPath, 'generate_pdf.outputPath')
    : buildGeneratedAssetPath(`expose_${Date.now()}.pdf`, 'generate_pdf.outputPath');

  // Securise la création du dossier avant d'écrire le PDF
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  title = title || "Exposé de Lycéen";
  author = author || "Auteur: Anonyme";
  date = date || new Date().toLocaleDateString();
  sections = Array.isArray(sections) ? sections : [];
  const failOnMissingImages = (
    args.allowMissingImages !== true
    && args.skipMissingImages !== true
    && args.strictImages !== false
    && args.strictAssets !== false
  );
  const missingAssets = [];
  const preparedSections = [];

  for (let idx = 0; idx < sections.length; idx++) {
    const section = sections[idx] || {};
    const heading = section.heading || section.title || `Section ${idx + 1}`;
    const text = section.text || section.content || "";
    const images = Array.isArray(section.images) ? section.images : [];
    const resolvedImages = [];

    for (const ref of images) {
      const imageResult = await loadImageBuffer(ref, {
        context,
        conversationId,
        resourceCache,
      });
      if (!imageResult?.ok || !Buffer.isBuffer(imageResult.buffer)) {
        missingAssets.push({
          sectionIndex: idx,
          heading,
          ref: String(ref || '').trim(),
          error: String(imageResult?.error || 'image_not_found'),
          resolvedPath: String(imageResult?.resolvedPath || '').trim() || null,
          detail: String(imageResult?.detail || '').trim() || null,
        });
        continue;
      }
      resolvedImages.push(imageResult);
    }

    preparedSections.push({
      heading,
      text,
      images: resolvedImages,
    });
  }

  if (missingAssets.length && failOnMissingImages) {
    const error = new Error(`generate_pdf_missing_assets: ${missingAssets.map((entry) => entry.ref).join(', ')}`);
    error.code = 'generate_pdf_missing_assets';
    error.missingAssets = missingAssets;
    throw error;
  }

  const doc = new PDFDocument({ margin: 50 });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  // ----------- Page de garde -----------
  doc
    .fontSize(28)
    .fillColor('#2563eb')
    .font("Helvetica-Bold")
    .text(title, { align: "center" })
    .moveDown(2)
    .fontSize(18)
    .fillColor('#111827')
    .font("Helvetica")
    .text(author, { align: "center" })
    .moveDown(1)
    .text(date, { align: "center" })
    .moveDown(4);
  doc.addPage();

  // ----------- Sommaire -----------
  doc.fontSize(20).fillColor('#22c55e').font("Helvetica-Bold").text("Sommaire", { align: "left" }).moveDown(1);
  for (let idx = 0; idx < sections.length; idx++) {
    const section = sections[idx];
    const heading = section.heading || section.title || `Section ${idx + 1}`;
    doc.fontSize(14).fillColor('#0ea5e9').font("Helvetica").text(`${idx + 1}. ${heading}`, { align: "left" });
  }
  doc.moveDown(2);
  doc.addPage();

  // ----------- Sections -----------
  for (let idx = 0; idx < preparedSections.length; idx++) {
    const section = preparedSections[idx];
    const heading = section.heading;
    const text = section.text;
    const images = Array.isArray(section.images) ? section.images : [];

    doc.fontSize(18).fillColor('#2563eb').font("Helvetica-Bold").text(heading, { align: "left" }).moveDown(1);
    if (text) {
      doc.fontSize(12).fillColor('#111827').font("Helvetica").text(text, { align: "left" }).moveDown(1);
    }
    // Images centrées
    for (const image of images) {
      const buf = image.buffer;
      const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      doc.moveDown(0.5).image(buf, {
        fit: [maxWidth * 0.8, 250],
        align: "center",
        valign: "center"
      }).moveDown(1);
    }
    doc.addPage();
  }

  // ----------- Conclusion -----------
  doc.fontSize(20).fillColor('#eab308').font("Helvetica-Bold").text("Conclusion", { align: "left" }).moveDown(1);
  doc.fontSize(12).fillColor('#111827').font("Helvetica").text("Merci d'avoir lu cet exposé !", { align: "left" }).moveDown(2);

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return {
    ok: true,
    outputPath,
    imageCount: preparedSections.reduce((total, section) => total + (Array.isArray(section.images) ? section.images.length : 0), 0),
    missingAssets,
  };
}

function isTruthyFlag(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function shouldAllowPlaceholderPng(args = {}) {
  if (args.allowPlaceholder !== undefined) return isTruthyFlag(args.allowPlaceholder);
  if (args.placeholder !== undefined) return isTruthyFlag(args.placeholder);
  if (String(args.fallback || '').trim().toLowerCase() === 'placeholder') return true;
  return isTruthyFlag(process.env.A11_ALLOW_PLACEHOLDER_PNG || process.env.A11_DEV_ALLOW_PLACEHOLDER_PNG);
}

// PNG generation with optional placeholder fallback.
async function t_generate_png(args = {}) {
  const title = String(
    args.text ||
    args.prompt ||
    args.imageDescription ||
    args.imageType ||
    'Illustration A11'
  ).trim() || 'Illustration A11';
  const hasExplicitCanvas = hasExplicitImageCanvasArgs(args);
  const requestedCanvas = hasExplicitCanvas
    ? parseImageSize(args.imageSize, Number(args.width || 1024), Number(args.height || 1024))
    : inferAutoImageCanvas(title);
  let width = Math.max(64, Math.min(2048, Number(args.width || requestedCanvas.width || 1024)));
  let height = Math.max(64, Math.min(2048, Number(args.height || requestedCanvas.height || 1024)));
  const subtitle = String(args.subtitle || 'Image de secours generee par A11').trim();
  const baseName = `${slugifyAssetSegment(title, 'image', 64)}-${Date.now()}.png`;
  const outputPath = args.outputPath || args.path || args.imagePath
    ? resolveSafePath(args.outputPath || args.path || args.imagePath, 'generate_png.outputPath')
    : buildGeneratedAssetPath(baseName, 'generate_png.outputPath');

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const allowPlaceholder = shouldAllowPlaceholderPng(args);
  let lastFailure = null;
  const promptAlreadyCompiled = args.prompt_prebuilt === true || args.skip_prompt_enrichment === true;
  const numInferenceSteps = Math.max(1, Number(args.numInferenceSteps || args.num_inference_steps || 35) || 35);
  const guidanceScale = Number(args.guidanceScale || args.guidance_scale || 8.0) || 8.0;
  const seed = args.seed !== undefined && args.seed !== null && String(args.seed).trim() !== ''
    ? String(args.seed).trim()
    : '';

  let compiledState = null;
  if (!promptAlreadyCompiled) {
    const maskResolution = await buildCanonicalImageMaskFromText(title, {
      allowCompatFallback: true,
      maskOptions: {
        ...(hasExplicitCanvas ? { width, height } : {}),
        steps: numInferenceSteps,
        guidance_scale: guidanceScale,
        ...(seed ? { seed: Number(seed) } : {}),
      },
    });
    if (maskResolution?.rawMask && !hasExplicitCanvas) {
      const inferredCanvas = inferAutoImageCanvas(title, maskResolution.rawMask);
      width = Math.max(64, Math.min(2048, Number(inferredCanvas.width || width || 1024)));
      height = Math.max(64, Math.min(2048, Number(inferredCanvas.height || height || 1024)));
      maskResolution.rawMask.options = maskResolution.rawMask.options && typeof maskResolution.rawMask.options === 'object'
        ? maskResolution.rawMask.options
        : {};
      maskResolution.rawMask.options.width = width;
      maskResolution.rawMask.options.height = height;
    }
    if (maskResolution?.rawMask) {
      compiledState = await compileMaskImageGenerateRuntime(maskResolution.rawMask, {
        callStructuredLlmJson,
      });
    }
  }

  const promptBundle = compiledState || promptAlreadyCompiled
    ? null
    : buildSdPromptBundle(title, {
      preferLiteralColor: true,
    });
  const finalPrompt = compiledState
    ? String(compiledState.sdBody?.prompt || title).trim() || title
    : String(promptBundle?.prompt || title).trim() || title;
  const finalNegativePrompt = String(
    args.negative_prompt
    || compiledState?.sdBody?.negative_prompt
    || (Array.isArray(promptBundle?.negativeHints) ? promptBundle.negativeHints.join(', ') : '')
    || ''
  ).trim();

  const proxyUrl = resolveSdProxyUrl();
  if (proxyUrl) {
    const proxyPayload = {
      prompt: finalPrompt,
      prompt_prebuilt: true,
      ...(finalNegativePrompt ? { negative_prompt: finalNegativePrompt, negative_prompt_prebuilt: true } : {}),
      num_inference_steps: numInferenceSteps,
      guidance_scale: guidanceScale,
      width,
      height,
      ...(seed ? { seed } : {}),
    };

    const proxyResult = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proxyPayload),
    })
      .then(async (response) => {
        const text = await response.text();
        let body = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch {
          body = null;
        }
        return { ok: response.ok, status: response.status, body, text };
      })
      .catch((error_) => ({ ok: false, error: String(error_?.message || error_) }));

    const remoteImageUrl = String(
      proxyResult?.body?.image_url ||
      proxyResult?.body?.url ||
      ''
    ).trim();

    if (proxyResult?.ok && remoteImageUrl) {
      try {
        const remoteImage = await axios.get(remoteImageUrl, {
          responseType: 'arraybuffer',
          timeout: 60000,
        });
        await fsp.writeFile(outputPath, Buffer.from(remoteImage.data));
        return {
          ok: true,
          outputPath,
          width,
          height,
          mode: 'stable-diffusion-proxy',
          prompt: finalPrompt,
          promptRefiner: compiledState?.promptRefiner || null,
          compilerTarget: compiledState?.compiled?.meta?.compilerTarget || null,
          executionPlan: compiledState?.compiled?.value || null,
          sourceUrl: remoteImageUrl,
        };
      } catch (error_) {
        console.warn('[A11][generate_png] proxy image download failed:', error_?.message);
        lastFailure = {
          ok: false,
          error: 'sd_proxy_download_failed',
          message: String(error_?.message || error_),
          prompt: finalPrompt,
          outputPath,
        };
      }
    } else if (proxyResult?.status) {
      console.warn('[A11][generate_png] proxy failed:', proxyResult.status, proxyResult.text || proxyResult.error || '');
      lastFailure = {
        ok: false,
        error: String(proxyResult?.body?.error || 'sd_proxy_failed'),
        message: String(
          proxyResult?.body?.message
          || proxyResult?.text
          || proxyResult?.error
          || `sd_proxy_status_${proxyResult.status}`
        ),
        statusCode: Number(proxyResult.status || 0) || undefined,
        prompt: finalPrompt,
        outputPath,
      };
    } else if (proxyResult?.error) {
      lastFailure = {
        ok: false,
        error: 'sd_proxy_unreachable',
        message: String(proxyResult.error),
        prompt: finalPrompt,
        outputPath,
      };
    }
  }

  const enableSd = String(process.env.ENABLE_SD || '').trim().toLowerCase() === 'true';
  const scriptPath = resolveSdScriptPath();
  if (enableSd && scriptPath && fsSync.existsSync(scriptPath)) {
    const sdResult = await runSdScript({
      prompt: finalPrompt,
      ...(finalNegativePrompt ? { negative_prompt: finalNegativePrompt } : {}),
      num_inference_steps: numInferenceSteps,
      guidance_scale: guidanceScale,
      width,
      height,
      ...(seed ? { seed } : {}),
      output: outputPath,
    }, { scriptPath });

    if (sdResult && sdResult.ok && sdResult.output_path && fsSync.existsSync(sdResult.output_path)) {
      return {
        ok: true,
        outputPath: sdResult.output_path,
        width,
        height,
        mode: 'stable-diffusion',
        prompt: finalPrompt,
        promptRefiner: compiledState?.promptRefiner || null,
        compilerTarget: compiledState?.compiled?.meta?.compilerTarget || null,
        executionPlan: compiledState?.compiled?.value || null,
        numInferenceSteps,
        guidanceScale,
        seed: seed ? Number(seed) : undefined,
      };
    }

    if (sdResult && sdResult.ok === false) {
      lastFailure = {
        ok: false,
        error: String(sdResult.error || 'python_failed'),
        message: String(sdResult.message || sdResult.stderr || sdResult.stdout || 'stable_diffusion_failed'),
        stderr: sdResult.stderr,
        stdout: sdResult.stdout,
        scriptPath: sdResult.scriptPath || scriptPath,
        pythonBin: sdResult.pythonBin,
        prompt: finalPrompt,
        outputPath,
      };
    }
  } else if (!proxyUrl) {
    lastFailure = {
      ok: false,
      error: 'sd_unavailable',
      message: enableSd
        ? 'Stable Diffusion est active mais le script Python est introuvable.'
        : 'Stable Diffusion n est pas disponible pour cette action.',
      scriptPath,
      prompt: finalPrompt,
      outputPath,
    };
  }

  if (!allowPlaceholder) {
    return {
      ok: false,
      ...(lastFailure || {
        error: 'image_generation_unavailable',
        message: 'Aucune generation d image reelle n est disponible.',
        prompt: finalPrompt,
        outputPath,
      }),
    };
  }

  const sharp = require('sharp');

  const safeTitle = title
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const safeSubtitle = subtitle
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="100%" stop-color="#1d4ed8"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" rx="28" fill="url(#bg)"/>
      <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.22)}" r="${Math.round(Math.min(width, height) * 0.09)}" fill="#38bdf8" fill-opacity="0.22"/>
      <circle cx="${Math.round(width * 0.18)}" cy="${Math.round(height * 0.76)}" r="${Math.round(Math.min(width, height) * 0.11)}" fill="#f59e0b" fill-opacity="0.18"/>
      <text x="50%" y="42%" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.max(28, Math.round(Math.min(width, height) * 0.08))}" font-weight="700" fill="#f8fafc">${safeTitle}</text>
      <text x="50%" y="58%" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.max(16, Math.round(Math.min(width, height) * 0.035))}" fill="#cbd5e1">${safeSubtitle}</text>
      <text x="50%" y="84%" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.max(12, Math.round(Math.min(width, height) * 0.024))}" fill="#93c5fd">A11 placeholder PNG</text>
    </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);

  return {
    ok: true,
    outputPath,
    width,
    height,
    mode: 'placeholder',
    placeholder: true,
    fallbackReason: String(lastFailure?.error || 'placeholder_requested'),
    prompt: title,
  };
}

async function t_vision_analyze(args = {}) {
  const context = args._context || {};
  const conversationId = String(
    args.conversationId ||
    args.convId ||
    args.sessionId ||
    context.conversationId ||
    context.convId ||
    context.sessionId ||
    ''
  ).trim();
  const resourceCache = {
    resolvedByRef: new Map(),
    resolvedStoredFilesByRef: new Map(),
    resourcesPromise: null,
    storedFilesPromise: null,
  };

  const source = await resolveVisionImageSource(args, {
    context,
    conversationId,
    resourceCache,
  });
  const analysis = await analyzeUploadedResource({
    filename: source.filename,
    contentType: source.contentType,
    buffer: source.buffer,
  });

  let remoteDescription = '';
  remoteDescription = String(await describeImageWithConfiguredVision(source, args) || '').trim();

  return {
    ok: true,
    task: String(args.task || 'describe').trim() || 'describe',
    summary: buildVisionSummary(source, analysis, remoteDescription, args.task),
    description: remoteDescription || null,
    analysis,
    source: {
      kind: source.source,
      filename: source.filename,
      contentType: source.contentType,
      path: source.path || null,
      url: source.url || source.resource?.url || source.file?.url || null,
      resourceId: source.resourceId || source.resource?.id || null,
    },
  };
}

// VS / A11Host
async function t_vs_status() {
  return await getA11HostStatus();
}

async function requireA11HostCapability(capabilityKey, unavailableError) {
  const status = await getA11HostStatus();
  if (!status.capabilities?.[capabilityKey]) {
    return {
      ok: false,
      error: unavailableError,
      mode: status.mode,
      bridgeAvailable: status.bridgeAvailable,
      capabilities: status.capabilities
    };
  }
  return status;
}

function parseA11HostPayload(payload, fallbackKey) {
  if (typeof payload !== 'string') {
    return fallbackKey ? { [fallbackKey]: payload } : payload;
  }

  try {
    return JSON.parse(payload);
  } catch {
    return fallbackKey ? { [fallbackKey]: payload } : payload;
  }
}

async function t_vs_workspace_root() {
  const status = await requireA11HostCapability('workspaceRoot', 'vs_workspace_root unavailable');
  if (!status.ok) return status;

  const root = await callA11Host('GetWorkspaceRoot');
  return {
    ok: true,
    root,
    mode: status.mode
  };
}

async function t_vs_compilation_errors() {
  const status = await requireA11HostCapability('compilationErrors', 'vs_compilation_errors unavailable');
  if (!status.ok) return status;

  const payload = await callA11Host('GetCompilationErrors');
  const parsed = parseA11HostPayload(payload, 'errors');
  const errors = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.errors) ? parsed.errors : []);
  return {
    ok: true,
    errors,
    raw: parsed,
    mode: status.mode
  };
}

async function t_vs_project_structure() {
  const status = await requireA11HostCapability('projectStructure', 'vs_project_structure unavailable');
  if (!status.ok) return status;

  const payload = await callA11Host('GetProjectStructure');
  const parsed = parseA11HostPayload(payload, 'projectStructure');
  return {
    ok: true,
    projectStructure: parsed,
    mode: status.mode
  };
}

async function t_vs_solution_info() {
  const status = await requireA11HostCapability('solutionInfo', 'vs_solution_info unavailable');
  if (!status.ok) return status;

  const payload = await callA11Host('GetSolutionInfo');
  const parsed = parseA11HostPayload(payload, 'solutionInfo');
  return {
    ok: true,
    solutionInfo: parsed,
    mode: status.mode
  };
}

async function t_vs_active_document() {
  const status = await requireA11HostCapability('activeDocument', 'vs_active_document unavailable');
  if (!status.ok) return status;

  const payload = await callA11Host('GetActiveDocument');
  const parsed = parseA11HostPayload(payload, 'document');
  return {
    ok: true,
    document: parsed,
    mode: status.mode
  };
}

async function t_vs_current_selection() {
  const status = await requireA11HostCapability('currentSelection', 'vs_current_selection unavailable');
  if (!status.ok) return status;

  const payload = await callA11Host('GetCurrentSelection');
  const parsed = parseA11HostPayload(payload, 'text');
  const text = typeof parsed === 'string'
    ? parsed
    : (typeof parsed?.text === 'string' ? parsed.text : String(parsed?.text || ''));
  return {
    ok: true,
    text,
    raw: parsed,
    mode: status.mode
  };
}

async function t_vs_open_file(args = {}) {
  const filePath = String(args.path || '').trim();
  if (!filePath) {
    throw new Error('vs_open_file: missing "path"');
  }

  const status = await requireA11HostCapability('openFile', 'vs_open_file unavailable');
  if (!status.ok) return status;

  const success = await callA11Host('OpenFile', filePath);
  return {
    ok: true,
    success,
    path: filePath,
    mode: status.mode
  };
}

async function t_vs_goto_line(args = {}) {
  const filePath = String(args.path || '').trim();
  const line = Number(args.line);
  if (!filePath) {
    throw new Error('vs_goto_line: missing "path"');
  }
  if (!Number.isInteger(line) || line < 1) {
    throw new Error('vs_goto_line: invalid "line"');
  }

  const status = await requireA11HostCapability('gotoLine', 'vs_goto_line unavailable');
  if (!status.ok) return status;

  const success = await callA11Host('GotoLine', filePath, line);
  return {
    ok: true,
    success,
    path: filePath,
    line,
    mode: status.mode
  };
}

async function t_vs_open_documents() {
  const status = await requireA11HostCapability('openDocuments', 'vs_open_documents unavailable');
  if (!status.ok) return status;

  const docs = await callA11Host('GetOpenDocuments');
  let documents = docs;
  if (typeof docs === 'string') {
    try {
      documents = JSON.parse(docs);
    } catch {
      documents = [docs];
    }
  }

  return {
    ok: true,
    documents,
    mode: status.mode
  };
}

async function t_vs_execute_shell(args = {}) {
  const command = String(args.command || '').trim();
  if (!command) {
    throw new Error('vs_execute_shell: missing "command"');
  }
  if (!isShellAllowed(command)) {
    return {
      ok: false,
      error: `vs_execute_shell: command not allowed by whitelist: "${command}"`,
      command
    };
  }

  const status = await requireA11HostCapability('executeShell', 'vs_execute_shell unavailable');
  if (!status.ok) return status;

  try {
    const rawResult = await callA11Host('ExecuteShell', command);
    const normalized =
      rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
        ? rawResult
        : {
            ok: true,
            command,
            exitCode: 0,
            stdout: String(rawResult || ''),
            stderr: '',
            output: String(rawResult || ''),
            unavailable: false,
            message: null,
          };
    const output = String(
      normalized.output ||
      [normalized.stdout, normalized.stderr].filter(Boolean).join('\n')
    ).trim();
    const unavailable =
      normalized.unavailable === true ||
      Number(normalized.exitCode) === 127 ||
      /not found|is not recognized|command not found|enoent/i.test(String(normalized.stderr || normalized.message || ''));
    const message = String(
      normalized.message ||
      (unavailable
        ? `La commande "${getShellToolName(command) || command.split(/\s+/)[0]}" n'est pas disponible sur ce runtime A11.`
        : normalized.stderr || '')
    ).trim();
    return {
      ok: normalized.ok !== false && Number(normalized.exitCode || 0) === 0,
      command,
      output,
      stdout: String(normalized.stdout || ''),
      stderr: String(normalized.stderr || ''),
      exitCode: Number.isFinite(normalized.exitCode) ? Number(normalized.exitCode) : 0,
      unavailable,
      message: message || null,
      mode: status.mode
    };
  } catch (err) {
    return {
      ok: false,
      command,
      mode: status.mode,
      error: err?.message || String(err)
    };
  }
}

async function t_vs_build_solution() {
  const status = await requireA11HostCapability('buildSolution', 'vs_build_solution unavailable');
  if (!status.ok) return status;

  const success = await callA11Host('BuildSolution');
  return {
    ok: true,
    success,
    mode: status.mode
  };
}

async function t_a11_env_snapshot(_args = {}) {
  const tools = Object.keys(TOOL_IMPL || {}).sort();
  const roots = WORKSPACE_ROOTS.map(r => path.resolve(r));
  const qflushInfo = {
    available: !!globalThis.__QFLUSH_AVAILABLE,
    module: !!globalThis.__QFLUSH_MODULE,
    exePath: globalThis.__QFLUSH_PATH || null
  };
  let llmStats = null;
  try {
    const routerUrl = (process.env.LLM_ROUTER_URL && process.env.LLM_ROUTER_URL.trim()) || 'http://127.0.0.1:4545';
    const url = String(routerUrl).replace(/\/$/, '') + '/api/stats';
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1000);
    const r = await fetch(url, { method: 'GET', signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) {
      llmStats = await r.json();
    } else {
      llmStats = { ok: false, status: r.status };
    }
  } catch (e) {
    llmStats = { ok: false, error: String(e && e.message) };
  }
  const SAFE_ENV_KEYS = [
    'NODE_ENV','BACKEND','LLAMA_BASE','LLAMA_PORT','LLM_ROUTER_URL','PORT','HOST_SERVER'
  ];
  const safeEnv = {};
  for (const k of SAFE_ENV_KEYS) {
    if (process.env[k] !== undefined) safeEnv[k] = process.env[k];
  }
  const workspaces = [];
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      const entries = await fsp.readdir(root, { withFileTypes: true });
      workspaces.push({
        root,
        entries: entries.filter(e => e.isDirectory()).slice(0, 20).map(e => e.name)
      });
    } catch (e) {
      workspaces.push({ root, error: String(e && e.message) });
    }
  }
  const snapshot = {
    timestamp: Date.now(),
    mode: process.env.NODE_ENV || 'development',
    tools,
    roots,
    qflush: qflushInfo,
    llm: llmStats,
    env: safeEnv,
    workspaces
  };
  return { ok: true, snapshot };
}

async function t_a11_debug_echo(args = {}) {
  return { ok: true, echo: args, type: typeof args };
}

// --- KV store pour a11_memory_* ---
const A11_KV_ROOT = path.resolve((WORKSPACE_ROOTS[1] || WORKSPACE_ROOTS[0]), 'a11_memory');
const A11_KV_STORE_PATH = path.join(A11_KV_ROOT, 'kv-store.json');

function ensureKvDir() {
  try {
    fsSync.mkdirSync(A11_KV_ROOT, { recursive: true });
  } catch (e) {
    console.warn('[A11][kv] mkdir failed:', e && e.message);
  }
}

function loadKvStore() {
  try {
    ensureKvDir();
    if (!fsSync.existsSync(A11_KV_STORE_PATH)) return {};
    const raw = fsSync.readFileSync(A11_KV_STORE_PATH, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[A11][kv] load failed:', e && e.message);
    return {};
  }
}

function saveKvStore(store) {
  try {
    ensureKvDir();
    fsSync.writeFileSync(
      A11_KV_STORE_PATH,
      JSON.stringify(store, null, 2),
      'utf8'
    );
  } catch (e) {
    console.warn('[A11][kv] save failed:', e && e.message);
  }
}

async function t_a11_memory_write(args = {}) {
  const key = (args.key || '').toString().trim();
  const value = args.value;

  if (!key) {
    throw new Error('a11_memory_write: missing "key"');
  }

  // 1. Enregistrement dans le KV store
  const store = loadKvStore();
  store[key] = {
    value,
    updatedAt: new Date().toISOString()
  };
  saveKvStore(store);

  // 2. Enregistrement dans le fichier de log (conversations)
  // Si la clé est "conversations" ou "log", on écrit aussi dans le fichier texte
  if (key === 'conversations' || key === 'log') {
    const convDir = path.join(A11_KV_ROOT, 'conversations');
    try {
      fsSync.mkdirSync(convDir, { recursive: true });
      const logPath = path.join(convDir, 'log.txt');
      fsSync.appendFileSync(logPath, String(value) + '\n', 'utf8');
    } catch (e) {
      console.warn('[A11][kv] log.txt write failed:', e && e.message);
    }
  }

  return {
    ok: true,
    key,
    value
  };
}

async function t_a11_memory_read(args = {}) {
  const key = (args.key || '').toString().trim();
  if (!key) {
    throw new Error('a11_memory_read: missing "key"');
  }

  const store = loadKvStore();
  const exists = Object.prototype.hasOwnProperty.call(store, key);

  return {
    ok: true,
    key,
    exists,
    value: exists ? store[key].value : null,
    meta: exists ? store[key] : null
  };
}

// Nouveau: historique simple
async function t_a11_memory_history(args = {}) {
  const prefix = (args.prefix || '').toString().trim();

  // --- KV store ---
  const kv = loadKvStore();
  const kvKeys = Object.keys(kv).sort();
  const kvFiltered = prefix ? kvKeys.filter(k => k.startsWith(prefix)) : kvKeys;
  const kvItems = kvFiltered.map(k => ({
    type: 'kv',
    key: k,
    updatedAt: kv[k].updatedAt,
    summary: (typeof kv[k].value === 'string'
      ? kv[k].value.slice(0, 80)
      : JSON.stringify(kv[k].value).slice(0, 80))
  }));

  // --- Conversations ---
  const convDir = path.join(A11_MEMORY_ROOT, 'conversations');
  let convItems = [];
  try {
    if (fsSync.existsSync(convDir)) {
      const files = fsSync.readdirSync(convDir)
        .filter(f => f.endsWith('.jsonl'))
        .sort();
      for (const file of files) {
        const fullPath = path.join(convDir, file);
        const stat = fsSync.statSync(fullPath);
        let preview = '';
        try {
          const raw = fsSync.readFileSync(fullPath, 'utf8');
          const lines = raw.split('\n').filter(Boolean);
          preview = lines.slice(0, 2).join('\n');
          if (preview.length > 400) preview = preview.slice(0, 400) + '...';
        } catch {}
        convItems.push({
          type: 'conversation',
          file,
          updatedAt: stat.mtime.toISOString?.() || new Date(stat.mtime).toISOString(),
          summary: preview
        });
      }
    }
  } catch (e) {
    console.warn('[A11][memory_history] conv error:', e && e.message);
  }

  // --- Memos ---
  const memoDir = path.join(A11_MEMORY_ROOT, 'memos');
  let memoItems = [];
  try {
    if (fsSync.existsSync(memoDir)) {
      const files = fsSync.readdirSync(memoDir)
        .filter(f => f.endsWith('.json'))
        .sort();
      for (const file of files) {
        const fullPath = path.join(memoDir, file);
        const stat = fsSync.statSync(fullPath);
        let preview = '';
        let type = 'memo';
        try {
          const raw = fsSync.readFileSync(fullPath, 'utf8');
          const obj = JSON.parse(raw);
          type = obj.type || 'memo';
          preview = JSON.stringify(obj.data || obj, null, 2).slice(0, 400);
        } catch {}
        memoItems.push({
          type,
          file,
          updatedAt: stat.mtime.toISOString?.() || new Date(stat.mtime).toISOString(),
          summary: preview
        });
      }
    }
  } catch (e) {
    console.warn('[A11][memory_history] memo error:', e && e.message);
  }

  // --- Fusion ---
  const items = [...kvItems, ...convItems, ...memoItems];

  return {
    ok: true,
    total: kvKeys.length + convItems.length + memoItems.length,
    filtered: items.length,
    items
  };
}

// --- TTS stubs (en attendant le vrai câblage) ---
async function t_tts_basic(args = {}) {
  return {
    ok: false,
    error: 't_tts_basic not wired yet',
    args
  };
}

async function t_tts_advanced(args = {}) {
  return {
    ok: false,
    error: 't_tts_advanced not wired yet',
    args
  };
}

function normalizeDispatchActionName(name) {
  const normalized = String(name || '').trim();
  const lowered = normalized.toLowerCase();
  if (!lowered) return normalized;

  if (lowered === 'generate_image') return 'generate_png';
  if (lowered === 'vision' || lowered === 'image_analyze' || lowered === 'analyze_image' || lowered === 'analyse_image') {
    return 'vision_analyze';
  }
  if (lowered === 'zip') return 'zip_create';
  if (lowered === 'unzip') return 'unzip_extract';
  if (lowered === 'ocr' || lowered === 'ocr-file') return 'ocr_file';
  if (lowered === 'websearch') return 'web_search';
  if (lowered === 'share-file' || lowered === 'sharefile' || lowered === 'upload_file' || lowered === 'publish_file') {
    return 'share_file';
  }
  if (lowered === 'list-stored-files' || lowered === 'list_files' || lowered === 'stored_files' || lowered === 'listfiles') {
    return 'list_stored_files';
  }
  if (lowered === 'list_resources' || lowered === 'list-resource' || lowered === 'list_resource' || lowered === 'list_conversation_resources') {
    return 'list_resources';
  }
  if (lowered === 'get_latest_resource' || lowered === 'latest_resource' || lowered === 'get-latest-resource') {
    return 'get_latest_resource';
  }
  if (lowered === 'send-email' || lowered === 'send_mail' || lowered === 'mail_user' || lowered === 'email_user') {
    return 'send_email';
  }
  if (lowered === 'email_latest_resource' || lowered === 'send_latest_resource_email' || lowered === 'latest_resource_email') {
    return 'email_latest_resource';
  }
  if (lowered === 'email-resource' || lowered === 'emailresource' || lowered === 'send_resource_email' || lowered === 'resource_email') {
    return 'email_resource';
  }
  if (lowered === 'schedule-email' || lowered === 'schedule_mail' || lowered === 'mail_later' || lowered === 'delayed_email') {
    return 'schedule_email';
  }
  if (lowered === 'schedule_resource_email' || lowered === 'schedule-resource-email' || lowered === 'resource_email_later') {
    return 'schedule_resource_email';
  }
  if (lowered === 'schedule_latest_resource_email' || lowered === 'latest_resource_email_later') {
    return 'schedule_latest_resource_email';
  }
  if (lowered === 'list_scheduled_emails' || lowered === 'scheduled_emails' || lowered === 'list-mail-jobs') {
    return 'list_scheduled_emails';
  }
  if (lowered === 'cancel_scheduled_email' || lowered === 'cancel-mail-job' || lowered === 'cancel_scheduled_mail') {
    return 'cancel_scheduled_email';
  }
  if (lowered === 'zip_and_email' || lowered === 'zip-email' || lowered === 'bundle_and_email') {
    return 'zip_and_email';
  }
  if (lowered === 'email_file' || lowered === 'mail_file' || lowered === 'share_and_email_file') {
    return 'share_file';
  }
  if (lowered === 'qflush_memory_write' || lowered === 'qflush_memory_set' || lowered === 'memory_ephemeral_write') {
    return 'qflush_memory_write';
  }
  if (lowered === 'qflush_memory_read' || lowered === 'qflush_memory_get' || lowered === 'memory_ephemeral_read') {
    return 'qflush_memory_read';
  }
  if (lowered === 'qflush_memory_list' || lowered === 'memory_ephemeral_list') {
    return 'qflush_memory_list';
  }
  if (lowered === 'qflush_memory_delete' || lowered === 'memory_ephemeral_delete') {
    return 'qflush_memory_delete';
  }
  if (lowered === 'qflush_memory_clear' || lowered === 'memory_ephemeral_clear') {
    return 'qflush_memory_clear';
  }

  return normalized;
}

function normalizeDispatchActionArgs(actionName, rawArgs = {}) {
  const args = rawArgs && typeof rawArgs === 'object' ? { ...rawArgs } : {};

  if (actionName === 'share_file') {
    if (!args.path) {
      args.path = args.outputPath || args.filePath || args.attachmentPath || null;
    }
    if (!args.conversationId) {
      args.conversationId = args.convId || args.sessionId || args?._context?.conversationId || null;
    }
    if (!args.emailTo) {
      args.emailTo = args.to || args.email || args.recipient || args.recipients || '';
    }
    if (!args.emailSubject) {
      args.emailSubject = args.subject || '';
    }
    if (!args.emailMessage) {
      args.emailMessage = args.message || args.body || args.text || '';
    }
    if (args.attachToEmail == null && args.asAttachment != null) {
      args.attachToEmail = args.asAttachment;
    }
  }

  if (actionName === 'send_email') {
    if (!args.to) {
      args.to = args.emailTo || args.email || args.recipient || args.recipients || '';
    }
    if (!args.subject) {
      args.subject = args.emailSubject || '';
    }
    if (!args.message) {
      args.message = args.emailMessage || args.body || args.text || args.content || '';
    }
    if (!args.path) {
      args.path = args.outputPath || args.filePath || args.attachmentPath || null;
    }
    if (!Array.isArray(args.paths) && Array.isArray(args.attachments)) {
      const attachmentPaths = args.attachments
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') return item.path || '';
          return '';
        })
        .filter(Boolean);
      if (attachmentPaths.length) {
        args.paths = attachmentPaths;
      }
    }
  }

  if (actionName === 'email_resource') {
    if (!args.resourceId) {
      args.resourceId = args.resource_id || args.id || args.conversationResourceId || null;
    }
    if (!args.to) {
      args.to = args.emailTo || args.email || args.recipient || args.recipients || '';
    }
    if (!args.subject) {
      args.subject = args.emailSubject || '';
    }
    if (!args.message) {
      args.message = args.emailMessage || args.body || args.text || args.content || '';
    }
    if (args.attachToEmail == null && args.asAttachment != null) {
      args.attachToEmail = args.asAttachment;
    }
  }

  if (actionName === 'email_latest_resource') {
    if (!args.to) {
      args.to = args.emailTo || args.email || args.recipient || args.recipients || '';
    }
    if (!args.subject) {
      args.subject = args.emailSubject || '';
    }
    if (!args.message) {
      args.message = args.emailMessage || args.body || args.text || args.content || '';
    }
    if (!args.kind) {
      args.kind = args.resourceKind || args.type || '';
    }
    if (!args.conversationId) {
      args.conversationId = args.convId || args.sessionId || null;
    }
  }

  if (actionName === 'list_resources') {
    if (!args.conversationId) {
      args.conversationId = args.convId || args.sessionId || null;
    }
    if (!args.kind) {
      args.kind = args.resourceKind || args.type || '';
    }
  }

  if (actionName === 'get_latest_resource') {
    if (!args.conversationId) {
      args.conversationId = args.convId || args.sessionId || null;
    }
    if (!args.kind) {
      args.kind = args.resourceKind || args.type || '';
    }
  }

  if (actionName === 'schedule_email') {
    if (!args.to) {
      args.to = args.emailTo || args.email || args.recipient || args.recipients || '';
    }
    if (!args.subject) {
      args.subject = args.emailSubject || '';
    }
    if (!args.message) {
      args.message = args.emailMessage || args.body || args.text || args.content || '';
    }
    if (!args.path) {
      args.path = args.outputPath || args.filePath || args.attachmentPath || null;
    }
  }

  if (actionName === 'schedule_resource_email') {
    if (!args.resourceId) {
      args.resourceId = args.resource_id || args.id || args.conversationResourceId || null;
    }
    if (!args.to) {
      args.to = args.emailTo || args.email || args.recipient || args.recipients || '';
    }
    if (!args.subject) {
      args.subject = args.emailSubject || '';
    }
    if (!args.message) {
      args.message = args.emailMessage || args.body || args.text || args.content || '';
    }
  }

  if (actionName === 'schedule_latest_resource_email') {
    if (!args.to) {
      args.to = args.emailTo || args.email || args.recipient || args.recipients || '';
    }
    if (!args.subject) {
      args.subject = args.emailSubject || '';
    }
    if (!args.message) {
      args.message = args.emailMessage || args.body || args.text || args.content || '';
    }
    if (!args.kind) {
      args.kind = args.resourceKind || args.type || '';
    }
    if (!args.conversationId) {
      args.conversationId = args.convId || args.sessionId || null;
    }
  }

  if (actionName === 'cancel_scheduled_email' && !args.jobId) {
    args.jobId = args.id || args.scheduledId || args.job || null;
  }

  if (actionName === 'zip_and_email' && !args.inputPaths) {
    args.inputPaths = Array.isArray(args.paths) ? args.paths : [];
  }

  if (actionName === 'list_stored_files' && !args.limit) {
    args.limit = args.max || args.count || args.top || args.n || undefined;
  }

  if ((actionName === 'vision_analyze' || actionName === 'ocr_file') && !args.task) {
    args.task = actionName === 'ocr_file' ? 'ocr' : (args.mode || 'describe');
  }

  return args;
}

const TOOL_IMPL = {
  // QFlush
  qflush_flow: t_qflush_flow,
  qflush_memory_write: t_qflush_memory_write,
  qflush_memory_read: t_qflush_memory_read,
  qflush_memory_list: t_qflush_memory_list,
  qflush_memory_delete: t_qflush_memory_delete,
  qflush_memory_clear: t_qflush_memory_clear,

  // FS
  fs_read: t_fs_read,
  fs_write: t_fs_write,
  write_file: t_write_file,
  fs_list: t_fs_list,
  fs_stat: t_fs_stat,
  fs_delete: t_fs_delete,
  fs_move: t_fs_move,

  // ZIP (stubs)
  zip_create: t_zip_create,
  zip: t_zip_create,
  unzip_extract: t_unzip_extract,
  unzip: t_unzip_extract,

  // SHELL
  shell_exec: t_shell_exec,

  // WEB
  web_fetch: t_web_fetch,
  web_search: t_web_search,

  // FS via QFlush
  fs_search: t_fs_search,

  // LLM
  llm_analyze_text: t_llm_analyze_text,

  // VS / A11Host
  vs_status: t_vs_status,
  vs_workspace_root: t_vs_workspace_root,
  vs_compilation_errors: t_vs_compilation_errors,
  vs_project_structure: t_vs_project_structure,
  vs_solution_info: t_vs_solution_info,
  vs_active_document: t_vs_active_document,
  vs_current_selection: t_vs_current_selection,
  vs_open_file: t_vs_open_file,
  vs_goto_line: t_vs_goto_line,
  vs_open_documents: t_vs_open_documents,
  vs_execute_shell: t_vs_execute_shell,
  vs_build_solution: t_vs_build_solution,

  // PDF / PNG
  generate_pdf: t_generate_pdf,
  generate_png: t_generate_png,
  vision_analyze: t_vision_analyze,
  ocr_file: t_vision_analyze,

  // Download direct d’image/fichier
  download_file: t_download_file,

  // Stockage / mail
  share_file: t_share_file,
  list_stored_files: t_list_stored_files,
  list_resources: t_list_resources,
  get_latest_resource: t_get_latest_resource,
  email_resource: t_email_resource,
  email_latest_resource: t_email_latest_resource,
  send_email: t_send_email,
  schedule_email: t_schedule_email,
  schedule_resource_email: t_schedule_resource_email,
  schedule_latest_resource_email: t_schedule_latest_resource_email,
  list_scheduled_emails: t_list_scheduled_emails,
  cancel_scheduled_email: t_cancel_scheduled_email,
  zip_and_email: t_zip_and_email,

  // TTS (stubs pour l’instant)
  tts_basic: t_tts_basic,
  tts_advanced: t_tts_advanced,

  // Mémoire A-11 (KV + historique)
  a11_memory_write: t_a11_memory_write,
  a11_memory_read: t_a11_memory_read,
  a11_memory_history: t_a11_memory_history,
  a11_env_snapshot: t_a11_env_snapshot,
  a11_debug_echo: t_a11_debug_echo,
  agent_log: async (args = {}) => {
    const level = String(args.level || 'info').trim().toLowerCase() || 'info';
    const message = String(args.message || '').trim() || '(vide)';
    console.log(`[A11][agent_log][${level}] ${message}`);
    return { ok: true, level, message };
  }
};

// --- Ajout: Validation stricte des noms d'actions ---
const ALLOWED_ACTIONS = new Set(Object.keys(TOOL_IMPL));
function validateActionName(name) {
  if (!ALLOWED_ACTIONS.has(name)) {
    return { ok: false, error: `UNKNOWN_ACTION:${name}`, available: [...ALLOWED_ACTIONS] };
  }
  return { ok: true };
}

function getAllowedActionNames() {
  return Object.keys(TOOL_IMPL).sort();
}

async function runAction(name, args = {}) {
  const normalizedName = normalizeDispatchActionName(name);
  const normalizedArgs = normalizeDispatchActionArgs(normalizedName, args);
  if (!TOOL_IMPL[normalizedName]) {
    return {
      ok: false,
      error: `Unknown tool: ${normalizedName}`,
      available: Object.keys(TOOL_IMPL)
    };
  }
  const spec = ensureToolAvailable(normalizedName);
  const impl = TOOL_IMPL[normalizedName];
  console.log(`[Cerbère][tool] ${normalizedName} (danger=${spec.dangerLevel || 'unknown'})`, normalizedArgs);
  try {
    const result = await impl(normalizedArgs);
    return { tool: normalizedName, ok: true, result };
  } catch (err) {
    return {
      tool: normalizedName,
      ok: false,
      error: err?.message || String(err),
      stack: err?.stack || null
    };
  }
}

function isIgnoredMemoryKey(actionName, args) {
  if (actionName !== "a11_memory_write" && actionName !== "a11_memory_read") {
    return false;
  }
  const key = args?.key || args?.input?.key || args?.arguments?.key;
  if (!key) return false;
  const k = String(key);
  if (
    k === "workspace" ||
    k === "conversation" ||
    k === "conversation_path" ||
    k.startsWith("conversation_")
  ) {
    return true;
  }
  return false;
}

// --- PATCH: Normalize envelope (result -> actions) and sequential execution with validation ---
async function runActionsEnvelope(envelope, context = {}) {
  // Normalize: accept legacy {result: {...}} as {actions: [result]}
  if (!envelope.actions && envelope.result) {
    envelope.actions = [envelope.result];
  }
  if (!Array.isArray(envelope.actions)) {
    throw new Error("runActionsEnvelope: envelope must have actions[] array");
  }
  const results = [];
  const contextualAllowedActions = Array.isArray(context.allowedActions)
    ? new Set(context.allowedActions.map((entry) => String(entry || '').trim()).filter(Boolean))
    : null;
  const executionContext = {
    ...context,
    conversationId: String(
      context.conversationId ||
      envelope.conversationId ||
      envelope.convId ||
      envelope.sessionId ||
      ''
    ).trim() || context.conversationId || null,
  };
  let lastArtifactPath = '';

  const extractArtifactPathFromResult = (result) => String(
    result?.outputPath
    || result?.path
    || result?.filePath
    || result?.savedAs
    || result?.zip?.outputPath
    || result?.file?.path
    || ''
  ).trim();

  for (const a of envelope.actions) {
    const rawName = a.action || a.name;
    const name = normalizeDispatchActionName(rawName);
    const args = normalizeDispatchActionArgs(name, {
      ...(a.arguments || a.input || {}),
      _context: executionContext,
    });
    if ((name === 'share_file' || name === 'send_email' || name === 'schedule_email') && !args.path && lastArtifactPath) {
      args.path = lastArtifactPath;
    }
    // Validation stricte du nom d'action
    const valid = validateActionName(name);
    if (!valid.ok) {
      results.push({
        action: rawName,
        normalizedAction: name,
        ok: false,
        error: valid.error,
        available: valid.available
      });
      break; // Stop batch on invalid action
    }
    if (contextualAllowedActions && contextualAllowedActions.size && !contextualAllowedActions.has(name)) {
      results.push({
        action: rawName,
        normalizedAction: name,
        ok: false,
        error: `ACTION_NOT_ALLOWED:${name}`,
        allowed: [...contextualAllowedActions]
      });
      break;
    }
    if (isIgnoredMemoryKey(name, args)) {
      console.log("[A11][memory] Ignoring", name, "for reserved key:", args.key || args.input?.key);
      results.push({ action: name, ignored: true, reason: "reserved-memory-key" });
      continue;
    }
    // Validation download_file: url obligatoire
    if (name === "download_file") {
      const url = String(args.url || "").trim();
      if (!url) {
        results.push({
          action: name,
          ok: false,
          error: "download_file: missing url (must be filled after websearch result)",
          arguments: args
        });
        break; // Stop batch if download_file is incomplete
      }
    }
    if (name === 'fs_delete') {
      if (SAFE_MODE) {
        results.push({
          action: name,
          ok: false,
          error: 'fs_delete: SAFE_MODE is enabled',
          arguments: args
        });
        break;
      }
      if (!hasDeleteConfirmation(args)) {
        results.push({
          action: name,
          ok: false,
          error: 'fs_delete: explicit confirmation required (confirmDelete=true and confirm="DELETE")',
          arguments: args
        });
        break;
      }
      if (isProtectedPath(args.path)) {
        results.push({
          action: name,
          ok: false,
          error: `fs_delete: protected path denied (${args.path})`,
          arguments: args
        });
        break;
      }
    }
    try {
      const result = await TOOL_IMPL[name](args);
      const nextArtifactPath = extractArtifactPathFromResult(result);
      if (nextArtifactPath) {
        lastArtifactPath = nextArtifactPath;
      }
      results.push({ action: name, ok: true, result });
    } catch (err) {
      results.push({
        action: name,
        ok: false,
        error: err?.message || String(err),
        stack: err?.stack || null
      });
    }
    // Si l'action est websearch, on s'arrête là pour reprompt LLM avec TOOL_RESULTS
    if (name === "websearch" || name === "web_search") break;
  }
  return { ok: true, results };
}

module.exports = {
  t_a11_save_memo,
  t_a11_memory_write,
  t_a11_memory_read,
  t_a11_memory_history,
  t_download_file,
  t_qflush_flow,
  t_qflush_memory_write,
  t_qflush_memory_read,
  t_qflush_memory_list,
  t_qflush_memory_delete,
  t_qflush_memory_clear,
  t_fs_read,
  t_fs_write,
  t_write_file,
  t_fs_list,
  t_fs_stat,
  t_fs_delete,
  t_fs_move,
  t_zip_create,
  t_unzip_extract,
  t_shell_exec,
  t_web_fetch,
  t_web_search,
  t_fs_search,
  t_llm_analyze_text,
  t_generate_pdf,
  t_generate_png,
  t_vision_analyze,
  t_share_file,
  t_list_stored_files,
  t_list_resources,
  t_get_latest_resource,
  t_email_resource,
  t_email_latest_resource,
  t_send_email,
  t_schedule_email,
  t_schedule_resource_email,
  t_schedule_latest_resource_email,
  t_list_scheduled_emails,
  t_cancel_scheduled_email,
  t_zip_and_email,
  t_vs_status,
  t_vs_workspace_root,
  t_vs_compilation_errors,
  t_vs_project_structure,
  t_vs_solution_info,
  t_vs_active_document,
  t_vs_current_selection,
  t_vs_open_file,
  t_vs_goto_line,
  t_vs_open_documents,
  t_vs_execute_shell,
  t_vs_build_solution,
  t_a11_env_snapshot,
  t_a11_debug_echo,
  runAction,
  runActionsEnvelope,
  isIgnoredMemoryKey,
  getAllowedActionNames
};
