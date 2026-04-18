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
  parsePdfEmailIntent,
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

function resolvePublicWorkspaceRoot() {
  const configuredRoot = String(
    process.env.A11_WORKSPACE_ROOT
    || process.env.WORKSPACE_ROOT
    || path.resolve(__dirname, '..', '..', '..', '..', '..')
  ).trim();
  return path.resolve(configuredRoot || path.resolve(__dirname, '..', '..', '..', '..', '..'));
}

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

function normalizeErrorText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeHtmlUpstreamError(value = '') {
  const raw = String(value || '');
  if (!/<!doctype html|<html/i.test(raw)) return '';
  if (/error code 524|a timeout occurred/i.test(raw)) {
    return 'Upstream timeout (Cloudflare 524)';
  }
  const titleMatch = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = normalizeErrorText(titleMatch?.[1] || '');
  if (title) return title;
  return 'Upstream HTML error response';
}

function sanitizeProxyMessage(value = '') {
  const htmlSummary = summarizeHtmlUpstreamError(value);
  if (htmlSummary) return htmlSummary;
  return normalizeErrorText(value);
}

function sanitizeUpstreamPayload(upstream = null) {
  if (!upstream || typeof upstream !== 'object') return upstream;
  const next = { ...upstream };
  if ('body' in next) {
    next.body = sanitizeProxyMessage(next.body);
  }
  return next;
}

function summarizeProxyError(error_, fallbackError = 'proxy_error') {
  const candidate = error_?.payload?.message || error_?.message || error_?.upstream?.body || fallbackError;
  return sanitizeProxyMessage(candidate) || String(fallbackError);
}

function attachIntentDebug(payload, _resolution, _body = {}) {
  return payload;
}

function resolveImageRequestCacheTtlMs(env = process.env) {
  const numeric = Number(env.A11_IMAGE_REQUEST_CACHE_TTL_MS || 60000);
  if (!Number.isFinite(numeric)) return 60000;
  return Math.max(5000, Math.min(300000, Math.floor(numeric)));
}

const IMAGE_REQUEST_CACHE_TTL_MS = resolveImageRequestCacheTtlMs();

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
  const fingerprintSource = {
    userId,
    conversationId,
    kind,
    latestUserMessage: String(latestUserMessage || '').trim(),
    provider: String(req?.body?.provider || '').trim(),
    model: String(req?.body?.model || '').trim(),
  };
  return crypto
    .createHash('sha1')
    .update(stableStringify(fingerprintSource))
    .digest('hex');
}

function normalizeIntentRequestText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildResolvedRequestKeys(req, latestUserMessage, resolution) {
  const strictKey = buildResolvedRequestKey(req, latestUserMessage, resolution);
  const userId = String(req?.user?.id || req?.body?._user || 'anonymous').trim();
  const kind = String(resolution?.kind || 'unknown').trim();
  const normalizedMessage = normalizeIntentRequestText(latestUserMessage);
  const semanticKey = crypto
    .createHash('sha1')
    .update(stableStringify({
      userId,
      kind,
      latestUserMessage: normalizedMessage,
    }))
    .digest('hex');
  return [...new Set([strictKey, semanticKey].filter(Boolean))];
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
      message: summarizeProxyError(error_, fallbackError),
    };
  }

  const payload = {
    ok: false,
    error: String(error_?.error || fallbackError),
    requestId,
    message: summarizeProxyError(error_, fallbackError),
  };

  if (error_?.upstream && typeof error_.upstream === 'object') {
    payload.upstream = sanitizeUpstreamPayload(error_.upstream);
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

  const workspaceRoot = resolvePublicWorkspaceRoot();
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

function formatPdfTopicTitle(topic = '') {
  const value = String(topic || '').trim();
  if (!value) return 'Document';
  if (/^[a-z0-9]{2,5}$/i.test(value)) {
    return value.toUpperCase();
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildDocumentPdfTitle(topic = '') {
  const label = formatPdfTopicTitle(topic);
  return label ? `Document A11 - ${label}` : 'Document A11';
}

function buildIllustrationGenerationPrompt(prompt = '') {
  const value = String(prompt || '').trim();
  if (!value) return '';
  if (/\b(genere|g[eé]n[eè]re|cree|cr[eé]e|creer|dessine|dessiner|fais|fait|prepare|pr[eé]pare)\b/i.test(value)) {
    return normalizeGeneratedImagePrompt(value);
  }
  return normalizeGeneratedImagePrompt(`genere une image de ${value}`);
}

async function materializePdfSectionsWithGeneratedIllustrations({
  req,
  sections = [],
  intentResolver,
  context = {},
  downloadFile,
  maxGeneratedIllustrations = 0,
}) {
  const normalizedSections = Array.isArray(sections) ? sections : [];
  const resolvedSections = [];
  const generatedIllustrations = [];
  let generatedCount = 0;

  for (const section of normalizedSections) {
    const nextSection = {
      ...section,
      heading: String(section?.heading || section?.title || '').trim() || 'Section',
      text: String(section?.text || section?.content || '').trim(),
      images: Array.isArray(section?.images)
        ? section.images.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [],
    };

    const illustrationPrompt = buildIllustrationGenerationPrompt(section?.illustrationPrompt || '');
    if (
      !nextSection.images.length
      && illustrationPrompt
      && intentResolver
      && generatedCount < Math.max(0, Number(maxGeneratedIllustrations || 0))
    ) {
      try {
        const imageResolution = await intentResolver.resolveUserRequest({
          req,
          body: req?.body || {},
          userText: illustrationPrompt,
          messages: [{ role: 'user', content: illustrationPrompt }],
          executeRuntime: true,
        });

        if (imageResolution?.kind === 'image.generate' && imageResolution?.responsePayload) {
          const generatedPayload = imageResolution.responsePayload;
          let imageRef = extractGeneratedArtifactPath(imageResolution);
          const imageUrl = extractGeneratedImageUrl(generatedPayload);

          if (!imageRef && imageUrl && typeof downloadFile === 'function') {
            const downloadedImage = await downloadFile({ url: imageUrl, _context: context });
            if (downloadedImage?.ok) {
              imageRef = String(downloadedImage.outputPath || downloadedImage.path || '').trim();
            }
          }

          imageRef = String(imageRef || imageUrl || '').trim();
          if (imageRef) {
            nextSection.images = [imageRef];
            generatedIllustrations.push({
              heading: nextSection.heading,
              imageRef,
              image: generatedPayload,
            });
            generatedCount += 1;
          }
        }
      } catch (_error) {
        // Leave the section text-only if illustration generation fails.
      }
    }

    resolvedSections.push(nextSection);
  }

  return {
    sections: resolvedSections,
    generatedIllustrations,
  };
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
    const hasConversationImageRefs = imageRefs.length > 0;
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

    const baseSections = buildAutoPdfSections(pdfTopic || 'document');
    const enrichedPdf = await materializePdfSectionsWithGeneratedIllustrations({
      req,
      sections: baseSections,
      intentResolver,
      context,
      downloadFile,
      maxGeneratedIllustrations: hasConversationImageRefs ? 0 : 2,
    });

    const pdf = await generatePdf({
      conversationId: context.conversationId || null,
      title: buildDocumentPdfTitle(pdfTopic || 'document'),
      author: 'A11',
      sections: imageRefs.length
        ? [
            ...enrichedPdf.sections,
            {
              heading: fallbackMode === 'generated_image' ? 'Illustration' : 'Images de la conversation',
              text: fallbackMode === 'generated_image'
                ? `A11 a genere une illustration sur le theme demande pour completer ce PDF : ${pdfTopic || compound.sourceText}.`
                : compound.sourceText,
              images: imageRefs,
            },
          ]
        : [
            ...enrichedPdf.sections,
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
      generatedIllustrations: enrichedPdf.generatedIllustrations,
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
      generatedIllustrations: enrichedPdf.generatedIllustrations,
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

async function executePdfEmailIntentRequest({
  req,
  intent,
  intentResolver,
  generatePdf,
  shareFile,
  sendEmail,
  downloadFile,
}) {
  const context = buildExecutionContext(req);
  const traceId = `compound_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const resolution = {
    traceId,
    pipeline: 'intent-router-v2',
    kind: 'compound.pdf_email',
  };

  const enrichedPdf = await materializePdfSectionsWithGeneratedIllustrations({
    req,
    sections: intent.sections,
    intentResolver,
    context,
    downloadFile,
    maxGeneratedIllustrations: 2,
  });

  const pdf = await generatePdf({
    conversationId: context.conversationId || null,
    title: intent.title,
    author: 'A11',
    sections: enrichedPdf.sections,
    _context: context,
  });

  if (!pdf?.ok || !String(pdf?.outputPath || '').trim()) {
    const error = new Error(pdf?.error || 'compound_pdf_email_generate_failed');
    error.statusCode = 502;
    error.payload = {
      ok: false,
      error: 'compound_pdf_email_generate_failed',
      details: pdf,
    };
    throw error;
  }

  const shared = await shareFile({
    path: pdf.outputPath,
    conversationId: context.conversationId || null,
    filename: String(intent.filename || pdf.filename || '').trim() || 'a11-document.pdf',
    emailTo: intent.recipients,
    emailSubject: intent.emailSubject || `A11 - PDF ${intent.title || 'Document'}`,
    emailMessage: intent.emailMessage || '',
    attachToEmail: true,
    _context: context,
  });

  if (!shared?.ok) {
    const mailFallback = await sendEmail({
      to: intent.recipients,
      subject: intent.emailSubject || `A11 - PDF ${intent.title || 'Document'}`,
      message: intent.emailMessage || '',
      path: pdf.outputPath,
      filename: String(intent.filename || pdf.filename || '').trim() || 'a11-document.pdf',
      conversationId: context.conversationId || null,
      _context: context,
    });

    if (!mailFallback?.ok) {
      const error = new Error(mailFallback?.error || shared?.error || 'compound_pdf_email_send_failed');
      error.statusCode = 502;
      error.payload = {
        ok: false,
        error: 'compound_pdf_email_send_failed',
        details: {
          share: shared,
          mail: mailFallback,
        },
      };
      throw error;
    }

    const content = `C'est fait. Le PDF a ete genere puis envoye par mail a ${intent.recipients.join(', ')}.`;
    return buildCompoundPayload({
      ok: true,
      mode: 'compound_action',
      artifact_type: 'email',
      content,
      recipients: intent.recipients,
      pdf,
      shared: null,
      mail: mailFallback?.mail || null,
      attachmentPath: pdf.outputPath,
      storageFallbackReason: shared?.error || 'mail_only_fallback',
      choices: buildAssistantChoice(content),
    }, resolution);
  }

  const content = `C'est fait. Le PDF a ete genere puis envoye par mail a ${intent.recipients.join(', ')}.`;
  return buildCompoundPayload({
    ok: true,
    mode: 'compound_action',
    artifact_type: 'email',
    content,
    recipients: intent.recipients,
    pdf,
    shared: shared?.conversationResource || shared || null,
    mail: shared?.mail || null,
    file_url: String(shared?.url || shared?.conversationResource?.downloadUrl || shared?.conversationResource?.url || '').trim() || null,
    filePath: String(shared?.url || shared?.conversationResource?.downloadUrl || shared?.conversationResource?.url || '').trim() || null,
    attachmentPath: pdf.outputPath,
    generatedIllustrations: enrichedPdf.generatedIllustrations,
    choices: buildAssistantChoice(content),
  }, resolution);
}

async function executeSimplePdfIntentRequest({
  req,
  intent,
  intentResolver,
  generatePdf,
  shareFile,
  downloadFile,
}) {
  const context = buildExecutionContext(req);
  const traceId = `compound_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const resolution = {
    traceId,
    pipeline: 'intent-router-v2',
    kind: 'compound.simple_pdf',
  };

  const enrichedPdf = await materializePdfSectionsWithGeneratedIllustrations({
    req,
    sections: intent.sections,
    intentResolver,
    context,
    downloadFile,
    maxGeneratedIllustrations: 2,
  });

  const pdf = await generatePdf({
    conversationId: context.conversationId || null,
    title: intent.title,
    author: 'A11',
    sections: enrichedPdf.sections,
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
      generatedIllustrations: enrichedPdf.generatedIllustrations,
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
    generatedIllustrations: enrichedPdf.generatedIllustrations,
    choices: buildAssistantChoice(content),
  }, resolution);
}

function createProtectedChatProxyRouter({
  verifyJWT,
  proxyChatToOpenAI,
  detectImageIntent,
  detectVideoIntent,
  detectWebImageIntent,
  duckduckgoImageSearch,
  generateSd,
  generateVideo,
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
  localDefaultModel = String(process.env.LOCAL_DEFAULT_MODEL || 'gemma4:e4b'),
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
    detectVideoIntent,
    detectWebImageIntent,
    duckduckgoImageSearch,
    generateSd,
    generateVideo,
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

    const pdfEmailIntent = parsePdfEmailIntent(latestUserMessage);
    if (pdfEmailIntent) {
      const pdfEmailPayload = await executePdfEmailIntentRequest({
        req,
        intent: pdfEmailIntent,
        intentResolver,
        generatePdf,
        shareFile,
        sendEmail,
        downloadFile,
      });
      return res.status(200).json(pdfEmailPayload);
    }

    const simplePdfIntent = parseSimplePdfIntent(latestUserMessage);
    if (simplePdfIntent) {
      const simplePdfPayload = await executeSimplePdfIntentRequest({
        req,
        intent: simplePdfIntent,
        intentResolver,
        generatePdf,
        shareFile,
        downloadFile,
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
      const payload = resolution.responsePayload
        || (await intentResolver.executeResolvedRuntime(resolution, {
          req,
          body: req.body || {},
          messages: Array.isArray(req.body?.messages) ? req.body.messages : [],
        }))?.responsePayload
        || null;
      return res.status(200).json(attachIntentDebug(payload, resolution, req.body || {}));
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
    const requestKeys = buildResolvedRequestKeys(req, latestUserMessage, resolution);
    const requestKey = requestKeys[0];
    const cachedExecution = requestKeys
      .map((key) => recentImageResponses.get(key))
      .find(Boolean);
    if (cachedExecution) {
      console.log(`[A11][intent-sync] reuse recent result key=${requestKey.slice(0, 10)} kind=${resolution.kind}`);
      return res.status(200).json(attachIntentDebug(cachedExecution.result, resolution, req.body || {}));
    }

    const existing = requestKeys
      .map((key) => inFlightImageRequests.get(key))
      .find(Boolean);
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
        for (const key of requestKeys) {
          recentImageResponses.set(key, {
            expiresAt: Date.now() + IMAGE_REQUEST_CACHE_TTL_MS,
            result: payload,
          });
        }
        return payload;
      })
      .finally(() => {
        for (const key of requestKeys) {
          inFlightImageRequests.delete(key);
        }
      });
    for (const key of requestKeys) {
      inFlightImageRequests.set(key, executionPromise);
    }

    const payload = await executionPromise;
    return res.status(200).json(attachIntentDebug(payload, resolution, req.body || {}));
  }

  function applyProviderDefaults(req) {
    if (!req.body) req.body = {};
    if (!req.body.provider && shouldDefaultToLocalProvider({ hasLocalChatUpstreamConfigured })) {
      req.body.provider = 'local';
    }
    if (req.body.provider === 'local' && !String(req.body.model || '').trim()) {
      req.body.model = String(localDefaultModel || 'gemma4:e4b');
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
      console.error(`[A11][/api/llm/chat] requestId=${requestId} Error: ${summarizeProxyError(error_, 'proxy_error')}`);
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
      console.error(`[A11][AuthChat] requestId=${requestId} Proxy error: ${summarizeProxyError(error_, 'upstream_unreachable')}`);
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
      console.error(`[A11][/api/ai] requestId=${requestId} Error: ${summarizeProxyError(error_, 'proxy_error')}`);
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
      console.error(`[A11][/api/completions] requestId=${requestId} Error: ${summarizeProxyError(error_, 'proxy_error')}`);
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
