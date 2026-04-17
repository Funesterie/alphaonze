const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { ensureRequestId } = require('../../lib/request-context.cjs');
const { extractRequestAuthToken } = require('../middleware/jwt-auth.cjs');
const {
  extractLatestUserMessage,
} = require('../mask/image-chat-runtime.cjs');
const {
  createIntentResolver,
  isIntentRouterV2Enabled,
} = require('../resolve-user-request.cjs');
const {
  parseSimpleEmailIntent,
  parseSimplePdfIntent,
  extractIllustratedPdfTopic,
  buildAutoPdfSections,
  normalizeGeneratedImagePrompt,
} = require('../../lib/direct-safe-intent.cjs');
const {
  t_list_resources: defaultListResources,
  t_generate_pdf: defaultGeneratePdf,
  t_share_file: defaultShareFile,
  t_email_latest_resource: defaultEmailLatestResource,
  t_send_email: defaultSendEmail,
  t_download_file: defaultDownloadFile,
} = require('../a11/tools-dispatcher.cjs');

function defaultHasLocalChatUpstreamConfigured() {
  return Boolean(
    String(process.env.LOCAL_LLM_URL || '').trim()
    || String(process.env.LLAMA_BASE || '').trim()
    || String(process.env.LLM_ROUTER_URL || '').trim()
  );
}

function isTruthyEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function attachIntentDebug(payload, _resolution, _body = {}) {
  return payload;
}

const IMAGE_REQUEST_CACHE_TTL_MS = 15000;

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function cleanupExpiredImageCache(cache = new Map()) {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now) {
      cache.delete(key);
    }
  }
}

function buildResolvedRequestKey(req, latestUserMessage, resolution) {
  const userId = String(req?.user?.id || req?.body?._user || 'anonymous').trim();
  const conversationId = String(req?.body?.conversationId || req?.body?.conversation_id || 'no-conversation').trim();
  const kind = String(resolution?.kind || 'unknown').trim();
  const mask = resolution?.mask && typeof resolution.mask === 'object'
    ? resolution.mask
    : {};
  const fingerprintSource = {
    userId,
    conversationId,
    kind,
    latestUserMessage: String(latestUserMessage || '').trim(),
    mask,
  };
  return crypto
    .createHash('sha1')
    .update(stableStringify(fingerprintSource))
    .digest('hex');
}

function defaultShouldDefaultToLocalProvider({
  hasLocalChatUpstreamConfigured = defaultHasLocalChatUpstreamConfigured,
} = {}) {
  const runtimeProfile = String(process.env.A11_RUNTIME_PROFILE || '').trim().toLowerCase();
  const defaultUpstream = String(process.env.DEFAULT_UPSTREAM || '').trim().toLowerCase();
  const hasRemoteProvider = Boolean(
    String(process.env.A11_AGENT_OPENAI_API_KEY || '').trim()
    || String(process.env.OPENAI_API_KEY || '').trim()
  );

  if (defaultUpstream === 'local') return true;
  if (isTruthyEnv(process.env.A11_LOCAL_MODE) || runtimeProfile === 'local') return true;
  if (hasRemoteProvider) return false;
  return hasLocalChatUpstreamConfigured();
}

function buildProxyErrorBody(error_, requestId, fallbackError = 'proxy_error') {
  if (error_?.payload && typeof error_.payload === 'object') {
    return {
      ...error_.payload,
      requestId: String(error_.payload.requestId || requestId),
      error: String(error_.payload.error || fallbackError),
      message: String(error_.payload.message || error_?.message || error_),
    };
  }

  const payload = {
    ok: false,
    error: String(error_?.error || fallbackError),
    requestId,
    message: String(error_?.message || error_),
  };

  if (error_?.upstream && typeof error_.upstream === 'object') {
    payload.upstream = error_.upstream;
  }

  return payload;
}

function buildExecutionContext(req) {
  return {
    authToken: extractRequestAuthToken(req),
    userId: String(req?.user?.id || req?.body?._user || '').trim(),
    conversationId: String(req?.body?.conversationId || req?.body?.conversation_id || '').trim(),
    convId: String(req?.body?.conversationId || req?.body?.conversation_id || '').trim(),
    sessionId: String(req?.body?.conversationId || req?.body?.conversation_id || '').trim(),
  };
}

function extractEmailRecipientsFromText(text = '') {
  const matches = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  return [...new Set((matches || []).map((entry) => String(entry || '').trim()).filter(Boolean))];
}

function isImageLikeResource(resource) {
  const contentType = String(resource?.contentType || resource?.content_type || '').trim().toLowerCase();
  const filename = String(resource?.filename || '').trim();
  const url = String(resource?.url || '').trim();
  return contentType.startsWith('image/')
    || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(filename)
    || /\.(png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(url);
}

function extractGeneratedArtifactPath(value) {
  return String(
    value?.outputPath
    || value?.path
    || value?.filePath
    || value?.savedAs
    || value?.localPath
    || value?.result?.outputPath
    || value?.result?.path
    || value?.result?.filePath
    || value?.sdResult?.outputPath
    || value?.sdResult?.path
    || value?.runtime?.sdResult?.outputPath
    || value?.runtime?.sdResult?.path
    || ''
  ).trim();
}

function extractGeneratedImageUrl(value) {
  return String(
    value?.image_url
    || value?.imagePath
    || value?.url
    || value?.result?.image_url
    || value?.result?.url
    || value?.runtime?.sdResult?.image_url
    || value?.runtime?.sdResult?.imagePath
    || value?.runtime?.sdResult?.url
    || ''
  ).trim();
}

function getRequestOrigin(req) {
  const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http').trim() || 'http';
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').trim();
  return host ? `${proto}://${host}` : '';
}

function buildLocalWorkspaceFileUrl(req, candidatePath) {
  const raw = String(candidatePath || '').trim();
  if (!raw) return null;
  const absolutePath = path.resolve(raw);
  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) return null;
  } catch {
    return null;
  }

  const workspaceRoot = path.resolve(process.cwd());
  const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('..')) return null;

  const encodedRelativePath = relativePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const publicPath = `/files/${encodedRelativePath}`;
  const origin = getRequestOrigin(req);
  return origin ? `${origin}${publicPath}` : publicPath;
}

function detectCompoundActionRequest(text = '') {
  const sourceText = String(text || '').trim();
  const normalizedText = sourceText
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const recipients = extractEmailRecipientsFromText(sourceText);
  const hasMailAction = /\b(envoie|envoyer|envoi|mail|email|courriel)\b/.test(normalizedText);
  const hasPdfAction = /\b(pdf|document pdf|fichier pdf|rapport pdf)\b/.test(normalizedText);
  const hasImageMention = /\b(image|images|illustration|photo|photos)\b/.test(normalizedText);
  const hasGenerateImageSignal = /\b(genere|generer|cree|creer|dessine|dessiner|fabrique|produis|prepare)\b/.test(normalizedText);
  const hasWebImageSignal = /\b(cherche|chercher|trouve|trouver|montre|montrer|affiche|afficher)\b/.test(normalizedText)
    && /\b(web|internet)\b/.test(normalizedText);

  const generateThenMailMatch = sourceText.match(/^(.*?\b(?:image|illustration|photo)\b.*?)(?:\s+(?:puis|et)\s+|\s*,\s*)(?:envoie|envoyer|envoi).+?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}).*$/i);
  if (generateThenMailMatch) {
    return {
      kind: 'compound.generate_image_then_mail',
      recipients: [String(generateThenMailMatch[2] || '').trim()].filter(Boolean),
      sourceText,
      imagePromptText: String(generateThenMailMatch[1] || '').trim(),
    };
  }

  const webSearchToPdfMatch = sourceText.match(/^(.*?\b(?:image|images|photo|photos)\b.*?\b(?:web|internet)\b.*?)(?:\s+(?:puis|et)\s+|\s*,\s*)(?:fais|faire|cree|creer|genere|generer).*\bpdf\b.*$/i);
  if (webSearchToPdfMatch) {
    return {
      kind: 'compound.web_image_then_pdf',
      recipients,
      sourceText,
      imagePromptText: String(webSearchToPdfMatch[1] || '').trim(),
    };
  }

  if (hasMailAction && recipients.length && hasImageMention) {
    if (hasGenerateImageSignal) {
      return {
        kind: 'compound.generate_image_then_mail',
        recipients,
        sourceText,
        imagePromptText: sourceText.replace(/\b(?:puis|et)\s+(?:envoie|envoyer|envoi)\b[\s\S]*$/i, '').trim(),
      };
    }
    return {
      kind: 'compound.mail_with_latest_image',
      recipients,
      sourceText,
    };
  }

  if (hasPdfAction && hasImageMention) {
    if (hasWebImageSignal) {
      return {
        kind: 'compound.web_image_then_pdf',
        recipients,
        sourceText,
        imagePromptText: sourceText.replace(/\b(?:puis|et)\s+(?:fais|faire|cree|creer|genere|generer)\b[\s\S]*?\bpdf\b[\s\S]*$/i, '').trim(),
      };
    }
    return {
      kind: 'compound.pdf_with_latest_images',
      recipients,
      sourceText,
    };
  }

  return null;
}

function buildCompoundPayload(payload, resolution) {
  return {
    ...payload,
    traceId: resolution.traceId,
    pipeline: resolution.pipeline,
    kind: resolution.kind,
  };
}

function buildAssistantChoice(content) {
  return [
    {
      index: 0,
      message: {
        role: 'assistant',
        content,
      },
      finish_reason: 'stop',
    },
  ];
}

function buildIllustratedPdfFallbackPrompt(sourceText = '') {
  const topic = extractIllustratedPdfTopic(sourceText);
  if (!topic) return '';
  return normalizeGeneratedImagePrompt(`genere une image de ${topic}`);
}

async function executeCompoundActionRequest({
  req,
  compound,
  intentResolver,
  listResources,
  generatePdf,
  shareFile,
  emailLatestResource,
  sendEmail,
  downloadFile,
}) {
  const context = buildExecutionContext(req);
  const traceId = `compound_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const resolution = {
    traceId,
    pipeline: 'intent-router-v2',
    kind: compound.kind,
  };

  if (compound.kind === 'compound.mail_with_latest_image') {
    const result = await emailLatestResource({
      to: compound.recipients,
      conversationId: context.conversationId || null,
      kind: 'image',
      attachToEmail: true,
      subject: 'A11 - image',
      message: "Image jointe depuis la conversation A11.",
      _context: context,
    });

    if (!result?.ok) {
      const error = new Error(result?.error || 'compound_mail_with_image_failed');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_mail_with_image_failed',
        details: result,
      };
      throw error;
    }

    const attachedUrl = String(
      result?.resource?.url
      || result?.resource?.downloadUrl
      || ''
    ).trim() || null;
    const content = `C'est fait. Le mail a ete envoye avec la derniere image de la conversation${attachedUrl ? ` et son apercu est disponible ici: ${attachedUrl}` : '.'}`;
    return buildCompoundPayload({
      ok: true,
      mode: 'compound_action',
      artifact_type: 'email',
      content,
      recipients: compound.recipients,
      resource: result?.resource || null,
      mail: result?.mail || null,
      choices: buildAssistantChoice(content),
    }, resolution);
  }

  if (compound.kind === 'compound.generate_image_then_mail') {
    const imagePromptText = normalizeGeneratedImagePrompt(
      String(compound.imagePromptText || '').trim() || compound.sourceText
    );
    const imageResolution = await intentResolver.resolveUserRequest({
      req,
      body: req.body || {},
      userText: imagePromptText,
      messages: [{ role: 'user', content: imagePromptText }],
      executeRuntime: true,
    });

    if (imageResolution?.kind !== 'image.generate' || !imageResolution?.responsePayload) {
      const error = new Error('compound_generate_image_then_mail_failed');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_generate_image_then_mail_failed',
        details: imageResolution,
      };
      throw error;
    }

    let generatedImagePath = extractGeneratedArtifactPath(imageResolution);
    const imageUrl = extractGeneratedImageUrl(imageResolution?.responsePayload || imageResolution);

    if (!generatedImagePath && imageUrl && typeof downloadFile === 'function') {
      const downloadedImage = await downloadFile({ url: imageUrl, _context: context });
      if (downloadedImage?.ok) {
        generatedImagePath = String(downloadedImage.outputPath || downloadedImage.path || '').trim();
      }
    }

    if (!generatedImagePath) {
      const error = new Error('compound_generate_image_missing_artifact');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_generate_image_missing_artifact',
        details: imageResolution,
      };
      throw error;
    }

    const mailResult = await sendEmail({
      to: compound.recipients,
      subject: 'A11 - image generee',
      message: "Image generee et jointe depuis la conversation A11.",
      path: generatedImagePath,
      filename: 'a11-generated-image.png',
      conversationId: context.conversationId || null,
      _context: context,
    });

    if (!mailResult?.ok) {
      const error = new Error(mailResult?.error || 'compound_generate_image_mail_send_failed');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_generate_image_mail_send_failed',
        details: mailResult,
      };
      throw error;
    }

    const resolvedImageUrl = String(imageUrl || '').trim() || null;
    const content = `C'est fait. L'image a ete generee puis envoyee par mail${resolvedImageUrl ? `. [ouvrir l'image](${resolvedImageUrl})` : '.'}`;
    return buildCompoundPayload({
      ok: true,
      mode: 'compound_action',
      artifact_type: 'email',
      content,
      recipients: compound.recipients,
      image_url: resolvedImageUrl,
      imagePath: resolvedImageUrl,
      image: imageResolution?.responsePayload || null,
      mail: mailResult?.mail || null,
      attachmentPath: generatedImagePath,
      choices: buildAssistantChoice(content),
    }, resolution);
  }

  if (compound.kind === 'compound.pdf_with_latest_images') {
    const listed = await listResources({
      conversationId: context.conversationId || null,
      limit: 12,
      _context: context,
    });
    const imageResources = Array.isArray(listed?.resources)
      ? listed.resources.filter(isImageLikeResource).slice(0, 4)
      : [];
    const imageRefs = imageResources
      .map((resource) => String(resource.id || resource.url || resource.filename || '').trim())
      .filter(Boolean);
    let fallbackMode = '';
    let fallbackImagePayload = null;
    let pdfTopic = extractIllustratedPdfTopic(compound.sourceText);

    if (!imageRefs.length) {
      const fallbackPrompt = buildIllustratedPdfFallbackPrompt(compound.sourceText);
      if (fallbackPrompt) {
        const imageResolution = await intentResolver.resolveUserRequest({
          req,
          body: req.body || {},
          userText: fallbackPrompt,
          messages: [{ role: 'user', content: fallbackPrompt }],
          executeRuntime: true,
        });
        const generatedImagePayload = imageResolution?.responsePayload || imageResolution || null;
        const generatedImageUrl = extractGeneratedImageUrl(generatedImagePayload);
        let generatedImagePath = extractGeneratedArtifactPath(imageResolution);

        if (!generatedImagePath && generatedImageUrl && typeof downloadFile === 'function') {
          const downloadedImage = await downloadFile({ url: generatedImageUrl, _context: context });
          if (downloadedImage?.ok) {
            generatedImagePath = String(downloadedImage.outputPath || downloadedImage.path || '').trim();
          }
        }

        const resolvedImageRef = String(generatedImagePath || generatedImageUrl || '').trim();
        if (resolvedImageRef) {
          imageRefs.push(resolvedImageRef);
          fallbackMode = 'generated_image';
          fallbackImagePayload = generatedImagePayload;
        }
      }

      if (!imageRefs.length) {
        fallbackMode = 'text_only';
      }
    }

    const pdf = await generatePdf({
      conversationId: context.conversationId || null,
      title: pdfTopic ? `Document A11 - ${pdfTopic}` : 'Document A11',
      author: 'A11',
      sections: imageRefs.length
        ? [
            ...buildAutoPdfSections(pdfTopic || 'document'),
            {
              heading: fallbackMode === 'generated_image' ? 'Illustration' : 'Images de la conversation',
              text: fallbackMode === 'generated_image'
                ? `A11 a genere une illustration sur le theme demande pour completer ce PDF : ${pdfTopic || compound.sourceText}.`
                : compound.sourceText,
              images: imageRefs,
            },
          ]
        : [
            ...buildAutoPdfSections(pdfTopic || 'document'),
            {
              heading: 'Note',
              text: "Aucune image recente n'etait disponible dans cette conversation. A11 a donc produit une version PDF textuelle sur le theme demande.",
            },
          ],
      _context: context,
    });

    if (!pdf?.ok || !String(pdf?.outputPath || '').trim()) {
      const error = new Error(pdf?.error || 'compound_pdf_with_images_failed');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_pdf_with_images_failed',
        details: pdf,
      };
      throw error;
    }

  const shared = await shareFile({
    path: pdf.outputPath,
    conversationId: context.conversationId || null,
    filename: String(pdf.filename || '').trim() || 'a11-images.pdf',
    _context: context,
  });

  if (!shared?.ok) {
    const localPdfUrl = buildLocalWorkspaceFileUrl(req, pdf.outputPath);
    if (!localPdfUrl) {
      const error = new Error(shared?.error || 'compound_pdf_share_failed');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_pdf_share_failed',
        details: shared,
      };
      throw error;
    }

    const localContent = imageRefs.length
      ? `C'est fait. Le PDF avec illustration est pret. [ouvrir le PDF](${localPdfUrl})`
      : `C'est fait. Le PDF est pret. [ouvrir le PDF](${localPdfUrl})`;
    return buildCompoundPayload({
      ok: true,
      mode: 'compound_action',
      artifact_type: 'pdf',
      content: localContent,
      file_url: localPdfUrl,
      filePath: localPdfUrl,
      pdf,
      shared: null,
      storageFallbackReason: shared?.error || 'local_file_fallback',
      imageFallback: fallbackMode || null,
      source_image: fallbackImagePayload,
      choices: buildAssistantChoice(localContent),
    }, resolution);
  }

    const pdfUrl = String(shared?.url || shared?.conversationResource?.url || shared?.conversationResource?.downloadUrl || '').trim() || null;
    const content = pdfUrl
      ? `C'est fait. Le PDF${imageRefs.length ? ' avec illustration' : ''} est pret. [ouvrir le PDF](${pdfUrl})`
      : `C'est fait. Le PDF${imageRefs.length ? ' avec illustration' : ''} est pret.`;
    return buildCompoundPayload({
      ok: true,
      mode: 'compound_action',
      artifact_type: 'pdf',
      content,
      file_url: pdfUrl,
      filePath: pdfUrl,
      pdf,
      shared: shared?.conversationResource || shared || null,
      imageFallback: fallbackMode || null,
      source_image: fallbackImagePayload,
      choices: buildAssistantChoice(content),
    }, resolution);
  }

  if (compound.kind === 'compound.web_image_then_pdf') {
    const imagePromptText = String(compound.imagePromptText || '').trim() || compound.sourceText;
    const webImageResolution = await intentResolver.resolveUserRequest({
      req,
      body: req.body || {},
      userText: imagePromptText,
      messages: [{ role: 'user', content: imagePromptText }],
      executeRuntime: true,
    });

    if (webImageResolution?.kind !== 'web.image.search' || !webImageResolution?.responsePayload) {
      const error = new Error('compound_web_image_then_pdf_failed');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_web_image_then_pdf_failed',
        details: webImageResolution,
      };
      throw error;
    }

    const webImageUrl = String(
      webImageResolution?.responsePayload?.image_url
      || webImageResolution?.responsePayload?.imagePath
      || ''
    ).trim();
    if (!webImageUrl) {
      const error = new Error('compound_web_image_then_pdf_missing_image');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_web_image_then_pdf_missing_image',
        details: webImageResolution,
      };
      throw error;
    }

    const pdf = await generatePdf({
      conversationId: context.conversationId || null,
      title: 'Document A11',
      author: 'A11',
      sections: [
        {
          heading: 'Image web',
          text: compound.sourceText,
          images: [webImageUrl],
        },
      ],
      _context: context,
    });

    if (!pdf?.ok || !String(pdf?.outputPath || '').trim()) {
      const error = new Error(pdf?.error || 'compound_web_image_pdf_failed');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_web_image_pdf_failed',
        details: pdf,
      };
      throw error;
    }

  const shared = await shareFile({
    path: pdf.outputPath,
    conversationId: context.conversationId || null,
    filename: String(pdf.filename || '').trim() || 'a11-web-images.pdf',
    _context: context,
  });

  if (!shared?.ok) {
    const localPdfUrl = buildLocalWorkspaceFileUrl(req, pdf.outputPath);
    if (!localPdfUrl) {
      const error = new Error(shared?.error || 'compound_web_image_pdf_share_failed');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_web_image_pdf_share_failed',
        details: shared,
      };
      throw error;
    }

    const localContent = `C'est fait. J'ai trouve une image sur le web puis cree le PDF. [ouvrir le PDF](${localPdfUrl})`;
    return buildCompoundPayload({
      ok: true,
      mode: 'compound_action',
      artifact_type: 'pdf',
      content: localContent,
      file_url: localPdfUrl,
      filePath: localPdfUrl,
      source_image_url: webImageUrl,
      web_image: webImageResolution?.responsePayload || null,
      pdf,
      shared: null,
      storageFallbackReason: shared?.error || 'local_file_fallback',
      choices: buildAssistantChoice(localContent),
    }, resolution);
  }

    const pdfUrl = String(shared?.url || shared?.conversationResource?.url || shared?.conversationResource?.downloadUrl || '').trim() || null;
    const content = pdfUrl
      ? `C'est fait. J'ai trouve une image sur le web puis cree le PDF. [ouvrir le PDF](${pdfUrl})`
      : "C'est fait. J'ai trouve une image sur le web puis cree le PDF.";
    return buildCompoundPayload({
      ok: true,
      mode: 'compound_action',
      artifact_type: 'pdf',
      content,
      file_url: pdfUrl,
      filePath: pdfUrl,
      source_image_url: webImageUrl,
      web_image: webImageResolution?.responsePayload || null,
      pdf,
      shared: shared?.conversationResource || shared || null,
      choices: buildAssistantChoice(content),
    }, resolution);
  }

  return null;
}

async function executeSimpleEmailIntentRequest({
  req,
  intent,
  sendEmail,
}) {
  const context = buildExecutionContext(req);
  const traceId = `compound_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const resolution = {
    traceId,
    pipeline: 'intent-router-v2',
    kind: 'compound.simple_email',
  };

  const result = await sendEmail({
    to: intent.recipients,
    subject: intent.subject || 'A11',
    message: intent.message || '',
    conversationId: context.conversationId || null,
    _context: context,
  });

  if (!result?.ok) {
    const error = new Error(result?.error || 'compound_simple_email_failed');
    error.statusCode = result?.error === 'mail_provider_not_configured' ? 503 : 502;
    error.payload = {
      ok: false,
      error: result?.error || 'compound_simple_email_failed',
      details: result,
    };
    throw error;
  }

  const recipients = Array.isArray(result?.to) ? result.to : intent.recipients;
  const recipientLabel = recipients.join(', ');
  const content = recipientLabel
    ? `C'est fait. Le mail a bien ete envoye a ${recipientLabel}.`
    : "C'est fait. Le mail a bien ete envoye.";

  return buildCompoundPayload({
    ok: true,
    mode: 'compound_action',
    artifact_type: 'email',
    content,
    recipients,
    mail: result?.mail || null,
    choices: buildAssistantChoice(content),
  }, resolution);
}

async function executeSimplePdfIntentRequest({
  req,
  intent,
  generatePdf,
  shareFile,
}) {
  const context = buildExecutionContext(req);
  const traceId = `compound_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const resolution = {
    traceId,
    pipeline: 'intent-router-v2',
    kind: 'compound.simple_pdf',
  };

  const pdf = await generatePdf({
    conversationId: context.conversationId || null,
    title: intent.title,
    author: 'A11',
    sections: intent.sections,
    _context: context,
  });

  if (!pdf?.ok || !String(pdf?.outputPath || '').trim()) {
    const error = new Error(pdf?.error || 'compound_simple_pdf_failed');
    error.statusCode = 502;
    error.payload = {
      ok: false,
      error: 'compound_simple_pdf_failed',
      details: pdf,
    };
    throw error;
  }

  const shared = await shareFile({
    path: pdf.outputPath,
    conversationId: context.conversationId || null,
    filename: String(intent.filename || pdf.filename || '').trim() || 'a11-document.pdf',
    attachToEmail: false,
    _context: context,
  });

  if (!shared?.ok) {
    const localPdfUrl = buildLocalWorkspaceFileUrl(req, pdf.outputPath);
    if (!localPdfUrl) {
      const error = new Error(shared?.error || 'compound_simple_pdf_share_failed');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_simple_pdf_share_failed',
        details: shared,
      };
      throw error;
    }

    const localContent = `C'est fait. Le PDF est pret. [ouvrir le PDF](${localPdfUrl})`;
    return buildCompoundPayload({
      ok: true,
      mode: 'compound_action',
      artifact_type: 'pdf',
      content: localContent,
      file_url: localPdfUrl,
      filePath: localPdfUrl,
      pdf,
      shared: null,
      storageFallbackReason: shared?.error || 'local_file_fallback',
      choices: buildAssistantChoice(localContent),
    }, resolution);
  }

  const pdfUrl = String(shared?.url || shared?.conversationResource?.url || shared?.conversationResource?.downloadUrl || '').trim() || null;
  const content = pdfUrl
    ? `C'est fait. Le PDF est pret. [ouvrir le PDF](${pdfUrl})`
    : "C'est fait. Le PDF est pret.";
  return buildCompoundPayload({
    ok: true,
    mode: 'compound_action',
    artifact_type: 'pdf',
    content,
    file_url: pdfUrl,
    filePath: pdfUrl,
    pdf,
    shared: shared?.conversationResource || shared || null,
    choices: buildAssistantChoice(content),
  }, resolution);
}

function createProtectedChatProxyRouter({
  verifyJWT,
  proxyChatToOpenAI,
  detectImageIntent,
  detectWebImageIntent,
  duckduckgoImageSearch,
  generateSd,
  specialCompilerCallStructuredLlmJson,
  listResources = defaultListResources,
  generatePdf = defaultGeneratePdf,
  shareFile = defaultShareFile,
  emailLatestResource = defaultEmailLatestResource,
  sendEmail = defaultSendEmail,
  downloadFile = defaultDownloadFile,
  hasLocalChatUpstreamConfigured = defaultHasLocalChatUpstreamConfigured,
  shouldDefaultToLocalProvider = defaultShouldDefaultToLocalProvider,
  intentRouterV2Enabled = isIntentRouterV2Enabled(),
  localDefaultModel = String(process.env.LOCAL_DEFAULT_MODEL || 'llama3.2:latest'),
  remoteDefaultModel = String(
    process.env.OPENAI_MODEL
    || process.env.A11_OPENAI_MODEL
    || 'gpt-4o-mini'
  ).trim() || 'gpt-4o-mini',
} = {}) {
  if (typeof verifyJWT !== 'function') {
    throw new Error('createProtectedChatProxyRouter requires verifyJWT');
  }
  if (typeof proxyChatToOpenAI !== 'function') {
    throw new Error('createProtectedChatProxyRouter requires proxyChatToOpenAI');
  }
  const intentResolver = createIntentResolver({
    detectImageIntent,
    detectWebImageIntent,
    duckduckgoImageSearch,
    generateSd,
    specialCompilerCallStructuredLlmJson,
  });
  const inFlightImageRequests = new Map();
  const recentImageResponses = new Map();

  async function tryHandleIntentRequest(req, res) {
    const latestUserMessage = extractLatestUserMessage(req.body || {});
    if (!latestUserMessage) return false;

    const simpleEmailIntent = parseSimpleEmailIntent(latestUserMessage);
    if (simpleEmailIntent) {
      const simpleEmailPayload = await executeSimpleEmailIntentRequest({
        req,
        intent: simpleEmailIntent,
        sendEmail,
      });
      return res.status(200).json(simpleEmailPayload);
    }

    const simplePdfIntent = parseSimplePdfIntent(latestUserMessage);
    if (simplePdfIntent) {
      const simplePdfPayload = await executeSimplePdfIntentRequest({
        req,
        intent: simplePdfIntent,
        generatePdf,
        shareFile,
      });
      return res.status(200).json(simplePdfPayload);
    }

    const compoundRequest = detectCompoundActionRequest(latestUserMessage);
    if (compoundRequest) {
      const compoundPayload = await executeCompoundActionRequest({
        req,
        compound: compoundRequest,
        intentResolver,
        listResources,
        generatePdf,
        shareFile,
        emailLatestResource,
        sendEmail,
        downloadFile,
      });
      return res.status(200).json(compoundPayload);
    }

    const resolution = await intentResolver.resolveUserRequest({
      req,
      body: req.body || {},
      userText: latestUserMessage,
      messages: Array.isArray(req.body?.messages) ? req.body.messages : [],
      executeImage: false,
      executeWebSearch: false,
    });

    if (
      resolution.kind === 'chat.reply'
      || resolution.kind === 'code.python.generate'
      || resolution.kind === 'web.search'
    ) {
      return false;
    }

    if (resolution.kind === 'clarification') {
      return res.status(200).json(attachIntentDebug(resolution.responsePayload, resolution, req.body || {}));
    }

    const isCacheable = resolution.kind === 'image.generate' || resolution.kind === 'web.image.search';
    const shouldBypassCache = resolution.kind === 'image.generate' && resolution.shouldBypassImageRequestCache === true;

    if (!isCacheable) {
      return res.status(200).json(attachIntentDebug(resolution.responsePayload, resolution, req.body || {}));
    }

    if (shouldBypassCache) {
      console.log('[A11][intent-sync] bypass short cache for special image compiler');
      const payload = resolution.responsePayload
        || (await intentResolver.executeResolvedRuntime(resolution, {
          req,
          body: req.body || {},
          messages: Array.isArray(req.body?.messages) ? req.body.messages : [],
        }))?.responsePayload
        || null;
      return res.status(200).json(attachIntentDebug(payload, resolution, req.body || {}));
    }

    cleanupExpiredImageCache(recentImageResponses);
    const requestKey = buildResolvedRequestKey(req, latestUserMessage, resolution);
    const cachedExecution = recentImageResponses.get(requestKey);
    if (cachedExecution) {
      console.log(`[A11][intent-sync] reuse recent result key=${requestKey.slice(0, 10)} kind=${resolution.kind}`);
      return res.status(200).json(attachIntentDebug(cachedExecution.result, resolution, req.body || {}));
    }

    const existing = inFlightImageRequests.get(requestKey);
    if (existing) {
      console.log(`[A11][intent-sync] join in-flight request key=${requestKey.slice(0, 10)} kind=${resolution.kind}`);
      const payload = await existing;
      return res.status(200).json(attachIntentDebug(payload, resolution, req.body || {}));
    }

    const executionPromise = Promise.resolve(resolution.responsePayload)
      .then(async (payload) => {
        if (payload) return payload;
        const executed = await intentResolver.executeResolvedRuntime(resolution, {
          req,
          body: req.body || {},
          messages: Array.isArray(req.body?.messages) ? req.body.messages : [],
        });
        return executed?.responsePayload || null;
      })
      .then((payload) => {
        recentImageResponses.set(requestKey, {
          expiresAt: Date.now() + IMAGE_REQUEST_CACHE_TTL_MS,
          result: payload,
        });
        return payload;
      })
      .finally(() => {
        inFlightImageRequests.delete(requestKey);
      });
    inFlightImageRequests.set(requestKey, executionPromise);

    const payload = await executionPromise;
    return res.status(200).json(attachIntentDebug(payload, resolution, req.body || {}));
  }

  function applyProviderDefaults(req) {
    if (!req.body) req.body = {};
    if (!req.body.provider && shouldDefaultToLocalProvider({ hasLocalChatUpstreamConfigured })) {
      req.body.provider = 'local';
    }
    if (req.body.provider === 'local' && !String(req.body.model || '').trim()) {
      req.body.model = String(localDefaultModel || 'llama3.2:latest');
    }
    if (req.body.provider !== 'local' && !String(req.body.model || '').trim()) {
      req.body.model = String(remoteDefaultModel || 'gpt-4o-mini');
    }
  }

  async function handleProxy(req, res) {
    const intentHandled = await tryHandleIntentRequest(req, res);
    if (intentHandled !== false) return intentHandled;

    applyProviderDefaults(req);
    return proxyChatToOpenAI(req, res);
  }

  const router = express.Router();

  router.post('/llm/chat', verifyJWT, express.json({ limit: '10mb' }), async (req, res) => {
    const requestId = ensureRequestId(req, res);
    try {
      return await handleProxy(req, res);
    } catch (error_) {
      console.error(`[A11][/api/llm/chat] requestId=${requestId} Error:`, error_?.message || error_);
      const status = Number.isFinite(Number(error_?.status)) && Number(error_.status) >= 400
        ? Number(error_.status)
        : 502;
      return res.status(status).json(buildProxyErrorBody(error_, requestId, 'proxy_error'));
    }
  });

  router.post('/ai/chat', express.json({ limit: '10mb' }), async (req, res) => {
    const requestId = ensureRequestId(req, res);
    try {
      req.body = {
        ...(req.body || {}),
        _user: req.user?.id || req.body?._user || 'anonymous',
      };
      return await handleProxy(req, res);
    } catch (error_) {
      console.error(`[A11][AuthChat] requestId=${requestId} Proxy error:`, error_?.message || error_);
      const status = Number.isFinite(Number(error_?.status)) && Number(error_.status) >= 400
        ? Number(error_.status)
        : 502;
      return res.status(status).json(buildProxyErrorBody(error_, requestId, 'upstream_unreachable'));
    }
  });

  router.post('/ai', express.json({ limit: '10mb' }), async (req, res) => {
    const requestId = ensureRequestId(req, res);
    try {
      req.body = {
        ...(req.body || {}),
        _user: req.user?.id || req.body?._user || 'anonymous',
      };
      return await handleProxy(req, res);
    } catch (error_) {
      console.error(`[A11][/api/ai] requestId=${requestId} Error:`, error_?.message || error_);
      const status = Number.isFinite(Number(error_?.status)) && Number(error_.status) >= 400
        ? Number(error_.status)
        : 502;
      return res.status(status).json(buildProxyErrorBody(error_, requestId, 'proxy_error'));
    }
  });

  router.post('/completions', express.json({ limit: '10mb' }), async (req, res) => {
    const requestId = ensureRequestId(req, res);
    try {
      return await handleProxy(req, res);
    } catch (error_) {
      console.error(`[A11][/api/completions] requestId=${requestId} Error:`, error_?.message || error_);
      const status = Number.isFinite(Number(error_?.status)) && Number(error_.status) >= 400
        ? Number(error_.status)
        : 502;
      return res.status(status).json(buildProxyErrorBody(error_, requestId, 'proxy_error'));
    }
  });

  router.handleProxy = handleProxy;
  router.applyProviderDefaults = applyProviderDefaults;

  return router;
}

module.exports = createProtectedChatProxyRouter;
