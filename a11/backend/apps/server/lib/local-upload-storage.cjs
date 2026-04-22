const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LOCAL_UPLOAD_STORAGE_PREFIX = 'local/uploads/';

function fallbackSanitizeFileName(name = '') {
  const base = String(name || '').trim() || 'file.bin';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return cleaned.slice(0, 180) || 'file.bin';
}

function sanitizeWithFallback(filename = '', sanitizeFileName = null) {
  if (typeof sanitizeFileName === 'function') {
    return String(sanitizeFileName(filename) || '').trim() || fallbackSanitizeFileName(filename);
  }
  return fallbackSanitizeFileName(filename);
}

function isLocalUploadStorageKey(storageKey = '') {
  return String(storageKey || '').trim().toLowerCase().startsWith(LOCAL_UPLOAD_STORAGE_PREFIX);
}

function getLocalUploadFilenameFromStorageKey(storageKey = '') {
  if (!isLocalUploadStorageKey(storageKey)) return '';
  const suffix = String(storageKey || '').trim().slice(LOCAL_UPLOAD_STORAGE_PREFIX.length);
  return path.basename(suffix);
}

function resolveLocalUploadPath({
  storageKey = '',
  uploadsRoot = '',
} = {}) {
  const filename = getLocalUploadFilenameFromStorageKey(storageKey);
  const normalizedRoot = path.resolve(String(uploadsRoot || '').trim() || '.');
  if (!filename) return '';
  return path.join(normalizedRoot, filename);
}

function saveBufferToLocalUploadStorage({
  uploadsRoot = '',
  filename = '',
  buffer = Buffer.alloc(0),
  contentType = 'application/octet-stream',
  sanitizeFileName = null,
} = {}) {
  const normalizedRoot = path.resolve(String(uploadsRoot || '').trim() || '.');
  fs.mkdirSync(normalizedRoot, { recursive: true });

  const safeFilename = sanitizeWithFallback(filename || 'file.bin', sanitizeFileName);
  const outputFilename = `upload_${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safeFilename}`;
  const outputPath = path.join(normalizedRoot, outputFilename);
  fs.writeFileSync(outputPath, buffer);

  return {
    filename: safeFilename,
    storageKey: `${LOCAL_UPLOAD_STORAGE_PREFIX}${outputFilename}`,
    url: `/files/runtime/files/uploads/${encodeURIComponent(outputFilename)}`,
    contentType: String(contentType || 'application/octet-stream').trim() || 'application/octet-stream',
    sizeBytes: Buffer.isBuffer(buffer) ? buffer.length : Number(buffer?.length || 0),
    outputPath,
  };
}

function readLocalUploadBuffer({
  storageKey = '',
  uploadsRoot = '',
} = {}) {
  const outputPath = resolveLocalUploadPath({ storageKey, uploadsRoot });
  if (!outputPath || !fs.existsSync(outputPath)) {
    const error = new Error('local_upload_not_found');
    error.code = 'local_upload_not_found';
    throw error;
  }
  const buffer = fs.readFileSync(outputPath);
  return {
    buffer,
    contentType: null,
    contentLength: buffer.length,
    outputPath,
  };
}

function deleteLocalUploadObject({
  storageKey = '',
  uploadsRoot = '',
} = {}) {
  const outputPath = resolveLocalUploadPath({ storageKey, uploadsRoot });
  if (outputPath && fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }
  return {
    ok: true,
    storageKey: String(storageKey || '').trim(),
    outputPath,
  };
}

module.exports = {
  LOCAL_UPLOAD_STORAGE_PREFIX,
  deleteLocalUploadObject,
  getLocalUploadFilenameFromStorageKey,
  isLocalUploadStorageKey,
  readLocalUploadBuffer,
  resolveLocalUploadPath,
  saveBufferToLocalUploadStorage,
};
