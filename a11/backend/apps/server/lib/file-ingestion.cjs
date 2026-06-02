const crypto = require('node:crypto');

function decodeBase64Content(contentBase64) {
  const rawBase64 = String(contentBase64 || '').trim();
  const cleanBase64 = rawBase64.includes(',') ? rawBase64.split(',').pop() : rawBase64;
  if (!cleanBase64) {
    const error = new Error('missing_content_base64');
    error.code = 'missing_content_base64';
    throw error;
  }

  const buffer = Buffer.from(cleanBase64, 'base64');
  if (!buffer.length) {
    const error = new Error('invalid_base64_content');
    error.code = 'invalid_base64_content';
    throw error;
  }

  return buffer;
}

function buildContentHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function buildContentAddressedStorageKey(userId, filename, buffer, contentHash = '') {
  const normalizedUserId = String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_') || 'anonymous';
  const safeFilename = String(filename || 'file.bin').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_').slice(0, 180) || 'file.bin';
  const hash = String(contentHash || '').trim() || buildContentHash(buffer);
  return `users/${normalizedUserId}/uploads/${hash}-${safeFilename}`;
}

async function ingestUploadedFile({
  userId,
  filename,
  contentType,
  contentBase64,
  maxBytes,
  origin = 'upload',
  conversationId,
  resourceKind = 'file',
  resourceMetadata = null,
  linkConversationResource,
  analyzeResourceContent,
  uploadBufferToR2,
  saveFileRecord,
  saveUserFileMemory,
  enforceAccountStorageQuota,
  findExistingResourceByHash,
  sanitizeFileName,
  expiresAt,
}) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    const error = new Error('missing_user');
    error.code = 'missing_user';
    throw error;
  }

  const safeFilename = sanitizeFileName(filename || 'generated-file.bin');
  const normalizedContentType = String(contentType || 'application/octet-stream').trim() || 'application/octet-stream';
  const buffer = decodeBase64Content(contentBase64);

  if (buffer.length > Number(maxBytes || 0)) {
    const error = new Error('file_too_large');
    error.code = 'file_too_large';
    error.maxBytes = Number(maxBytes || 0);
    throw error;
  }

  const contentHash = buildContentHash(buffer);
  const baseResourceMetadata = resourceMetadata && typeof resourceMetadata === 'object'
    ? resourceMetadata
    : {};
  const hashResourceMetadata = {
    ...baseResourceMetadata,
    contentHash,
    sha256: contentHash,
    allmight: {
      ...(baseResourceMetadata.allmight && typeof baseResourceMetadata.allmight === 'object'
        ? baseResourceMetadata.allmight
        : {}),
      triage: 'canonical-resource',
      dedupeKey: `sha256:${contentHash}`,
      storage: 'content-addressed',
    },
  };

  if (conversationId && typeof findExistingResourceByHash === 'function') {
    const existingResource = await findExistingResourceByHash({
      userId: normalizedUserId,
      conversationId,
      contentHash,
      contentType: normalizedContentType,
      resourceKind,
    });
    if (existingResource) {
      return {
        file: {
          filename: existingResource.filename || safeFilename,
          storageKey: existingResource.storageKey || '',
          url: existingResource.url || '',
          contentType: existingResource.contentType || normalizedContentType,
          sizeBytes: Number(existingResource.sizeBytes || buffer.length),
          expiresAt: existingResource.expiresAt || expiresAt || null,
        },
        record: null,
        buffer,
        analysis: existingResource.metadata?.analysis || null,
        conversationResource: existingResource,
        deduped: true,
        duplicateOf: existingResource.id || null,
        dedupe: {
          contentHash,
          strategy: 'allmight-canonical-resource',
        },
      };
    }
  }

  if (typeof enforceAccountStorageQuota === 'function') {
    await enforceAccountStorageQuota({
      userId: normalizedUserId,
      filename: safeFilename,
      contentType: normalizedContentType,
      incomingBytes: buffer.length,
      origin,
      resourceKind,
    });
  }

  let effectiveResourceMetadata = hashResourceMetadata;
  let analysis = null;
  if (typeof analyzeResourceContent === 'function') {
    analysis = await analyzeResourceContent({
      userId: normalizedUserId,
      filename: safeFilename,
      contentType: normalizedContentType,
      buffer,
      resourceKind,
      origin,
    });

    if (analysis) {
      effectiveResourceMetadata = {
        ...hashResourceMetadata,
        analysis,
      };
    }
  }

  const uploaded = await uploadBufferToR2({
    userId: normalizedUserId,
    filename: safeFilename,
    buffer,
    contentType: normalizedContentType,
    storageKey: buildContentAddressedStorageKey(normalizedUserId, safeFilename, buffer, contentHash),
  });

  const record = await saveFileRecord({
    userId: normalizedUserId,
    filename: safeFilename,
    storageKey: uploaded.storageKey,
    url: uploaded.url,
    contentType: normalizedContentType,
    sizeBytes: buffer.length,
    expiresAt,
  });

  await saveUserFileMemory({
    userId: normalizedUserId,
    filename: safeFilename,
    storageKey: uploaded.storageKey,
    url: uploaded.url,
    contentType: normalizedContentType,
    sizeBytes: buffer.length,
    origin,
    expiresAt,
  });

  let conversationResource = null;
  if (conversationId && typeof linkConversationResource === 'function') {
    conversationResource = await linkConversationResource({
      userId: normalizedUserId,
      conversationId,
      resourceKind,
      origin,
      filename: safeFilename,
      storageKey: uploaded.storageKey,
      url: uploaded.url,
      contentType: normalizedContentType,
      sizeBytes: buffer.length,
      metadata: effectiveResourceMetadata,
      expiresAt,
    });
  }

  return {
    file: {
      filename: safeFilename,
      storageKey: uploaded.storageKey,
      url: uploaded.url,
      contentType: normalizedContentType,
      sizeBytes: buffer.length,
      expiresAt: expiresAt || null,
    },
    record,
    buffer,
    analysis,
    conversationResource,
    contentHash,
    deduped: false,
  };
}

module.exports = {
  buildContentHash,
  decodeBase64Content,
  ingestUploadedFile,
};
