'use strict';

const path = require('node:path');

const ZEN_EXTENSION = '.zen';
const ZEN_CONTENT_TYPE = 'application/vnd.funesterie.zen';
const ZEN_UPLOAD_MAX_BYTES_DEFAULT = 64 * 1024 * 1024;
const ZEN_PUBLIC_HEADER_MAX_BYTES = 64 * 1024;
const ZEN_UPLOAD_MIME_TYPES = new Set([
  ZEN_CONTENT_TYPE,
  'application/x-zen',
  'application/zen',
  'application/octet-stream',
  'binary/octet-stream',
]);

function normalizeZenMime(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split(';')[0]
    .trim();
}

function isZenFilename(filename = '') {
  return path.extname(String(filename || '').trim().toLowerCase()) === ZEN_EXTENSION;
}

function isZenMime(contentType = '') {
  const mime = normalizeZenMime(contentType);
  return mime === ZEN_CONTENT_TYPE || mime === 'application/x-zen' || mime === 'application/zen';
}

function isZenUploadCandidate({ filename = '', contentType = '' } = {}) {
  return isZenFilename(filename) || isZenMime(contentType);
}

function toPositiveSafeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveZenUploadMaxBytes(value, globalMaxBytes = Number.POSITIVE_INFINITY) {
  const requested = toPositiveSafeInteger(value, ZEN_UPLOAD_MAX_BYTES_DEFAULT);
  const globalLimit = toPositiveSafeInteger(globalMaxBytes, requested);
  return Math.min(requested, globalLimit);
}

function createZenUploadError(code, message, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function cleanHeaderValue(value, maxLength = 80) {
  return String(value || '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, maxLength);
}

function resolveKdfName(kdf) {
  if (kdf && typeof kdf === 'object' && !Array.isArray(kdf)) return cleanHeaderValue(kdf.name);
  return cleanHeaderValue(kdf);
}

/**
 * Inspecte uniquement la structure et le header public d'un conteneur ZEN.
 * Cette fonction n'accepte aucune cle, ne dechiffre pas le payload et ne
 * retourne ni sel, IV, tag, checksum ni metadata interne.
 */
function inspectZenPublicHeader(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    throw createZenUploadError('zen_header_invalid', 'Invalid ZEN public header');
  }

  const maxContainerBytes = resolveZenUploadMaxBytes(options.maxContainerBytes, buffer.length);
  if (buffer.length > maxContainerBytes) {
    throw createZenUploadError('zen_file_too_large', 'ZEN file exceeds the upload limit', {
      maxBytes: maxContainerBytes,
      actualBytes: buffer.length,
    });
  }

  let inspected;
  try {
    const { inspectZen } = require('@nossen/zen');
    inspected = inspectZen(buffer, {
      maxContainerBytes,
      maxHeaderBytes: toPositiveSafeInteger(options.maxHeaderBytes, ZEN_PUBLIC_HEADER_MAX_BYTES),
      maxPayloadBytes: maxContainerBytes,
      // inspectZen never expands the payload; this positive value only satisfies
      // the package's bounded-limit contract.
      maxRawBytes: 1,
    });
  } catch (error) {
    if (error?.code === 'ZEN_ERR_LIMIT') {
      throw createZenUploadError('zen_header_invalid', 'ZEN public header exceeds the safe inspection limit');
    }
    throw createZenUploadError('zen_header_invalid', 'Invalid ZEN public header');
  }

  const header = inspected?.header && typeof inspected.header === 'object' ? inspected.header : {};
  const mode = cleanHeaderValue(header.mode);
  const encrypted = inspected?.encrypted === true && header.cipher !== 'none';

  if (!encrypted && options.allowPlaintext !== true) {
    throw createZenUploadError('zen_plaintext_not_allowed', 'Plaintext ZEN containers are not accepted');
  }

  return {
    format: cleanHeaderValue(header.format, 40) || 'zen',
    version: Number.isSafeInteger(Number(header.version)) ? Number(header.version) : null,
    mode,
    codec: cleanHeaderValue(header.codec),
    cipher: cleanHeaderValue(header.cipher),
    kdf: resolveKdfName(header.kdf),
    encrypted,
    headerBytes: buffer.readUInt32BE(8),
    payloadBytes: Number(inspected?.bodyBytes || 0),
    payloadDecoded: false,
  };
}

function prepareZenUpload({
  filename = '',
  contentType = '',
  buffer,
  maxBytes,
  globalMaxBytes,
  allowPlaintext = false,
} = {}) {
  if (!isZenUploadCandidate({ filename, contentType })) {
    return {
      isZen: false,
      contentType: String(contentType || 'application/octet-stream').trim() || 'application/octet-stream',
      publicHeader: null,
    };
  }

  if (!isZenFilename(filename)) {
    throw createZenUploadError('zen_extension_required', 'A ZEN container must use the .zen extension');
  }

  const normalizedMime = normalizeZenMime(contentType) || 'application/octet-stream';
  if (!ZEN_UPLOAD_MIME_TYPES.has(normalizedMime)) {
    throw createZenUploadError('zen_content_type_invalid', 'Unsupported MIME type for a ZEN container', {
      contentType: normalizedMime,
    });
  }

  const resolvedMaxBytes = resolveZenUploadMaxBytes(maxBytes, globalMaxBytes);
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw createZenUploadError('zen_header_invalid', 'Empty ZEN container');
  }
  if (buffer.length > resolvedMaxBytes) {
    throw createZenUploadError('zen_file_too_large', 'ZEN file exceeds the upload limit', {
      maxBytes: resolvedMaxBytes,
      actualBytes: buffer.length,
    });
  }

  const publicHeader = inspectZenPublicHeader(buffer, {
    maxContainerBytes: resolvedMaxBytes,
    maxHeaderBytes: ZEN_PUBLIC_HEADER_MAX_BYTES,
    allowPlaintext,
  });

  return {
    isZen: true,
    contentType: ZEN_CONTENT_TYPE,
    publicHeader,
    maxBytes: resolvedMaxBytes,
  };
}

module.exports = {
  ZEN_CONTENT_TYPE,
  ZEN_EXTENSION,
  ZEN_PUBLIC_HEADER_MAX_BYTES,
  ZEN_UPLOAD_MAX_BYTES_DEFAULT,
  ZEN_UPLOAD_MIME_TYPES,
  inspectZenPublicHeader,
  isZenFilename,
  isZenMime,
  isZenUploadCandidate,
  normalizeZenMime,
  prepareZenUpload,
  resolveZenUploadMaxBytes,
};
