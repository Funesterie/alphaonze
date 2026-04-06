function normalizeArtifactKind(kind) {
  const normalized = String(kind || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return normalized || 'generated';
}

function buildArtifactOrigin(kind) {
  return `artifact:${normalizeArtifactKind(kind)}`;
}

async function createArtifact({
  userId,
  filename,
  contentBase64,
  contentType,
  kind,
  conversationId,
  description,
  maxBytes,
  emailTo,
  emailSubject,
  emailMessage,
  attachToEmail,
  ingestUploadedFile,
  sanitizeFileName,
  sendFileEmail,
  appendConversationLog,
  normalizeConversationId,
}) {
  const normalizedKind = normalizeArtifactKind(kind);
  const safeFilename = sanitizeFileName(filename || `a11-${normalizedKind}.bin`);
  const normalizedConversationId = normalizeConversationId ? normalizeConversationId(conversationId) : 'default';
  const normalizedDescription = String(description || '').trim() || null;

  const ingestion = await ingestUploadedFile({
    userId,
    filename: safeFilename,
    contentType,
    contentBase64,
    maxBytes,
    origin: buildArtifactOrigin(normalizedKind),
    conversationId: normalizedConversationId,
    resourceKind: 'artifact',
    resourceMetadata: {
      kind: normalizedKind,
      description: normalizedDescription,
    },
  });

  let mail = null;
  if (emailTo && sendFileEmail) {
    mail = await sendFileEmail({
      to: emailTo,
      subject: emailSubject || `A11 — artefact ${normalizedKind}`,
      message: emailMessage || 'Ton artefact A11 est prêt.',
      fileUrl: ingestion.file.url,
      attachment: attachToEmail ? {
        filename: ingestion.file.filename,
        buffer: ingestion.buffer,
      } : null,
    });
  }

  if (appendConversationLog) {
    appendConversationLog({
      type: 'artifact_created',
      userId: String(userId || '').trim() || null,
      conversationId: normalizedConversationId,
      artifact: {
        kind: normalizedKind,
        description: normalizedDescription,
        filename: ingestion.file.filename,
        storageKey: ingestion.file.storageKey,
        url: ingestion.file.url,
        contentType: ingestion.file.contentType,
        sizeBytes: ingestion.file.sizeBytes,
      },
      mail,
    });
  }

  return {
    artifact: {
      kind: normalizedKind,
      conversationId: normalizedConversationId,
      description: normalizedDescription,
      ...ingestion.file,
    },
    record: ingestion.record,
    mail,
    conversationResource: ingestion.conversationResource || null,
  };
}

module.exports = {
  normalizeArtifactKind,
  buildArtifactOrigin,
  createArtifact,
};
