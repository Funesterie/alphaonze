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

  let effectiveResourceMetadata = resourceMetadata;
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
      const normalizedMetadata = resourceMetadata && typeof resourceMetadata === 'object'
        ? resourceMetadata
        : {};
      effectiveResourceMetadata = {
        ...normalizedMetadata,
        analysis,
      };
    }
  }

  const uploaded = await uploadBufferToR2({
    userId: normalizedUserId,
    filename: safeFilename,
    buffer,
    contentType: normalizedContentType,
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
  };
}

module.exports = {
  decodeBase64Content,
  ingestUploadedFile,
};
