const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const r2Defaults = require('../config/r2-config.cjs');

async function streamToBuffer(stream) {
  if (!stream) return Buffer.alloc(0);
  if (Buffer.isBuffer(stream)) return stream;
  if (typeof stream.transformToByteArray === 'function') {
    const bytes = await stream.transformToByteArray();
    return Buffer.from(bytes);
  }

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sanitizeFileName(name) {
  const base = String(name || '').trim() || 'file.bin';
  const cleaned = base.replaceAll(/[^a-zA-Z0-9._-]/g, '_').replaceAll(/_+/g, '_');
  return cleaned.slice(0, 180) || 'file.bin';
}

function normalizePublicAppUrl(rawUrl) {
  let url = String(rawUrl || '').trim();
  if (!url) url = 'https://a11.funesterie.me';
  url = url.replace(/^\/+/, '');
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url.replace(/\/+$/, '');
}

function normalizeStorageEndpoint(rawEndpoint, bucket = '') {
  let endpoint = String(rawEndpoint || '').trim();
  if (!endpoint) return '';
  if (!/^https?:\/\//i.test(endpoint)) {
    endpoint = `https://${endpoint.replace(/^\/+/, '')}`;
  }

  try {
    const url = new URL(endpoint);
    url.hash = '';
    url.search = '';

    const normalizedBucket = String(bucket || '').trim().toLowerCase();
    const normalizedHost = String(url.hostname || '').trim().toLowerCase();

    if (
      normalizedBucket &&
      normalizedHost.startsWith(`${normalizedBucket}.`) &&
      normalizedHost.includes('.r2.cloudflarestorage.com')
    ) {
      url.hostname = url.hostname.slice(normalizedBucket.length + 1);
    }

    const normalizedPathname = String(url.pathname || '').replace(/\/+$/, '');
    if (normalizedBucket && normalizedPathname.toLowerCase() === `/${normalizedBucket}`) {
      url.pathname = '';
    }

    return url.toString().replace(/\/+$/, '');
  } catch {
    return endpoint.replace(/\/+$/, '');
  }
}

function createFileStorage(config = {}) {
  const r2Config = {
    endpoint: normalizeStorageEndpoint(config.endpoint, config.bucket),
    accessKeyId: String(config.accessKeyId || '').trim(),
    secretAccessKey: String(config.secretAccessKey || '').trim(),
    bucket: String(config.bucket || '').trim(),
    publicBaseUrl: String(config.publicBaseUrl || '').trim(),
  };

  let clientSingleton = null;

  function isConfigured() {
    return !!(r2Config.endpoint && r2Config.accessKeyId && r2Config.secretAccessKey && r2Config.bucket);
  }

  function getClient() {
    if (clientSingleton) return clientSingleton;
    if (!isConfigured()) return null;

    clientSingleton = new S3Client({
      region: 'auto',
      endpoint: r2Config.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: r2Config.accessKeyId,
        secretAccessKey: r2Config.secretAccessKey,
      },
    });
    return clientSingleton;
  }

  function buildStorageKey(userId, filename) {
    const normalizedUserId = String(userId || 'anonymous').replaceAll(/[^a-zA-Z0-9_-]/g, '_');
    return `users/${normalizedUserId}/${Date.now()}-${sanitizeFileName(filename)}`;
  }

  function getPublicUrl(storageKey) {
    if (!r2Config.publicBaseUrl) {
      return '';
    }
    return `${r2Config.publicBaseUrl.replace(/\/$/, '')}/${storageKey}`;
  }

  async function uploadBuffer({ userId, filename, buffer, contentType, storageKey }) {
    const client = getClient();
    if (!client) {
      throw new Error('R2 is not configured');
    }

    const safeFilename = sanitizeFileName(filename);
    const resolvedStorageKey = String(storageKey || '').trim() || buildStorageKey(userId, safeFilename);
    try {
      await client.send(new PutObjectCommand({
        Bucket: r2Config.bucket,
        Key: resolvedStorageKey,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream',
      }));
    } catch (error) {
      const message = String(error?.message || error || '').trim();
      if (/signature/i.test(message)) {
        error.message = `${message} (verifie R2_ENDPOINT, R2_BUCKET et les cles d'acces)`;
      }
      throw error;
    }

    return {
      filename: safeFilename,
      storageKey: resolvedStorageKey,
      url: getPublicUrl(resolvedStorageKey),
      contentType: contentType || 'application/octet-stream',
      sizeBytes: Buffer.isBuffer(buffer) ? buffer.length : Number(buffer?.length || 0),
    };
  }

  async function downloadBuffer(storageKey) {
    const client = getClient();
    if (!client) {
      throw new Error('R2 is not configured');
    }

    const normalizedStorageKey = String(storageKey || '').trim();
    if (!normalizedStorageKey) {
      throw new Error('missing_storage_key');
    }

    const response = await client.send(new GetObjectCommand({
      Bucket: r2Config.bucket,
      Key: normalizedStorageKey,
    }));

    return {
      buffer: await streamToBuffer(response.Body),
      contentType: String(response.ContentType || '').trim() || null,
      contentLength: Number(response.ContentLength || 0) || null,
      metadata: response.Metadata || null,
    };
  }

  async function deleteObject(storageKey) {
    const client = getClient();
    if (!client) {
      throw new Error('R2 is not configured');
    }

    const normalizedStorageKey = String(storageKey || '').trim();
    if (!normalizedStorageKey) {
      throw new Error('missing_storage_key');
    }

    await client.send(new DeleteObjectCommand({
      Bucket: r2Config.bucket,
      Key: normalizedStorageKey,
    }));

    return {
      ok: true,
      storageKey: normalizedStorageKey,
    };
  }

  return {
    isConfigured,
    getClient,
    buildStorageKey,
    getPublicUrl,
    uploadBuffer,
    uploadBufferToR2: uploadBuffer, // Alias for compatibility
    downloadBuffer,
    deleteObject,
    sanitizeFileName,
    normalizePublicAppUrl,
  };
}

let defaultFileStorage = null;
let defaultFileStorageSignature = '';

function buildDefaultStorageConfig() {
  return {
    endpoint: String(process.env.R2_ENDPOINT || r2Defaults.endpoint || '').trim(),
    accessKeyId: String(process.env.R2_ACCESS_KEY || process.env.R2_ACCESS_KEY_ID || process.env.Access_Key_ID || r2Defaults.accessKeyId || '').trim(),
    secretAccessKey: String(process.env.R2_SECRET_KEY || process.env.R2_SECRET_ACCESS_KEY || process.env.Secret_Access_Key || r2Defaults.secretAccessKey || '').trim(),
    bucket: String(process.env.R2_BUCKET || process.env.R2_BUCKET_NAME || process.env.R2_BUCKET_ID || r2Defaults.bucket || '').trim(),
    publicBaseUrl: String(
      process.env.R2_PUBLIC_BASE_URL
      || process.env.A11_R2_PUBLIC_BASE_URL
      || process.env.R2_PUBLIC_URL
      || r2Defaults.publicBaseUrl
      || ''
    ).trim(),
  };
}

function getDefaultFileStorage() {
  const config = buildDefaultStorageConfig();
  const signature = JSON.stringify(config);
  if (!defaultFileStorage || defaultFileStorageSignature !== signature) {
    defaultFileStorage = createFileStorage(config);
    defaultFileStorageSignature = signature;
  }
  return defaultFileStorage;
}

async function uploadBufferToR2(payload) {
  return getDefaultFileStorage().uploadBuffer(payload);
}

module.exports = {
  createFileStorage,
  getDefaultFileStorage,
  uploadBufferToR2,
  sanitizeFileName,
  normalizePublicAppUrl,
  normalizeStorageEndpoint,
};
