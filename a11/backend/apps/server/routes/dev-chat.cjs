const fs = require('node:fs');
const path = require('node:path');
const {
  resolveSdProxyUrl,
  resolveSdScriptPath,
  runSdScript,
} = require('../lib/sd-runtime.cjs');
const express = require('express');

function validatePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') return false;
  const trimmed = prompt.trim();
  if (trimmed.length < 5 || trimmed.length > 300) return false;
  if (/script|<|>|\{|\}|\[|\]|\$|\`|\"|\'|\//i.test(trimmed)) return false;
  return true;
}

function fallbackIsAdminRequest(req) {
  const configuredAdminToken = String(process.env.NEZ_ADMIN_TOKEN || '').trim();
  const adminHeaders = [
    req?.headers?.['x-nez-admin-token'],
    req?.headers?.['x-admin-token'],
  ].map((value) => String(value || '').trim()).filter(Boolean);

  if (configuredAdminToken && adminHeaders.includes(configuredAdminToken)) {
    return true;
  }

  const rawTokens = [
    process.env.NEZ_ALLOWED_TOKEN,
    process.env.NEZ_TOKENS,
  ].filter(Boolean).join(',');

  const allowedTokens = rawTokens
    .split(/[,\s]+/)
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (allowedTokens.length === 0) {
    return false;
  }

  const bearer = String(req?.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return allowedTokens.includes(bearer);
}

module.exports = function({ app, openaiClient, uploadBufferToR2, detectImageIntent, isAdminRequest = fallbackIsAdminRequest }) {
  app.post('/api/chat/dev', express.json({ limit: '2mb' }), async (req, res) => {
    const userMessage = String(req.body?.message || '').trim();
    if (!userMessage) return res.status(400).json({ ok: false, error: 'missing_message' });

    // 1. Détection d’intention image
    if (detectImageIntent(userMessage)) {
      const prompt = userMessage.slice(0, 300);
      if (!validatePrompt(prompt)) {
        return res.status(400).json({ ok: false, error: 'invalid_prompt' });
      }
      const proxyUrl = resolveSdProxyUrl();
      const scriptPath = resolveSdScriptPath();
      const hasLocalScript = !!scriptPath && fs.existsSync(scriptPath);

      if (proxyUrl) {
        try {
          const proxyResponse = await fetch(proxyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(typeof req.headers?.authorization === 'string' ? { authorization: req.headers.authorization } : {}),
              ...(typeof req.headers?.['x-nez-admin-token'] === 'string' ? { 'x-nez-admin-token': req.headers['x-nez-admin-token'] } : {}),
              ...(typeof req.headers?.['x-qflush-token'] === 'string' ? { 'x-qflush-token': req.headers['x-qflush-token'] } : {}),
              ...(typeof req.headers?.['x-dragon-token'] === 'string' ? { 'x-dragon-token': req.headers['x-dragon-token'] } : {}),
            },
            body: JSON.stringify({ prompt }),
          });
          const proxyText = await proxyResponse.text();
          let proxyJson = null;
          try {
            proxyJson = proxyText ? JSON.parse(proxyText) : null;
          } catch {
            proxyJson = null;
          }
          if (proxyResponse.ok && proxyJson) {
            return res.status(proxyResponse.status).json(proxyJson);
          }
          if (!hasLocalScript) {
            return res.status(proxyResponse.status || 502).json({
              ok: false,
              error: proxyJson?.error || 'sd_proxy_failed',
              message: proxyJson?.message || proxyText || `Proxy SD indisponible (${proxyUrl})`,
            });
          }
          console.warn('[A11][chat/dev] SD proxy failed, fallback to local script:', proxyResponse.status, proxyText);
        } catch (error_) {
          if (!hasLocalScript) {
            return res.status(502).json({ ok: false, error: 'sd_proxy_failed', message: String(error_?.message || error_) });
          }
          console.warn('[A11][chat/dev] SD proxy unreachable, fallback to local script:', error_?.message);
        }
      }

      const enableSd = String(process.env.ENABLE_SD || '').toLowerCase() === 'true';
      const isAdmin = typeof isAdminRequest === 'function' ? isAdminRequest(req) : false;
      if (!enableSd && !isAdmin) {
        return res.status(503).json({ ok: false, error: 'sd_disabled', message: 'Stable Diffusion désactivé sur cet environnement' });
      }
      if (!hasLocalScript) {
        const tempDir = String(process.env.SD_OUTPUT_DIR || (process.env.NODE_ENV === 'production' ? '/tmp/a11-images' : path.join(process.cwd(), 'tmp', 'generated')));
        fs.mkdirSync(tempDir, { recursive: true });
        const outputName = `sd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
        const outputPath = path.join(tempDir, outputName);
        const openAiFallback = await tryGeneratePngWithOpenAI({
          prompt,
          outputPath,
          width: 1024,
          height: 1024,
          userId: req.user?.id || 'image-tool',
        });
        if (openAiFallback?.ok) {
          return res.json({
            ok: true,
            assistant: 'Image générée avec succès.',
            tool: 'generate_sd',
            artifact_type: 'image',
            image_url: openAiFallback.sourceUrl || null,
            filename: path.basename(openAiFallback.outputPath || outputPath),
            prompt,
            mode: openAiFallback.mode || 'openai-image',
          });
        }
        return res.status(503).json({
          ok: false,
          error: openAiFallback?.error || 'sd_unavailable',
          message: openAiFallback?.message || 'Stable Diffusion indisponible sur cet environnement',
        });
      }
      const tempDir = String(process.env.SD_OUTPUT_DIR || (process.env.NODE_ENV === 'production' ? '/tmp/a11-images' : path.join(process.cwd(), 'tmp', 'generated')));
      fs.mkdirSync(tempDir, { recursive: true });
      const outputName = `sd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
      const outputPath = path.join(tempDir, outputName);
      const outputJson = await runSdScript({
        prompt,
        output: outputPath,
      }, { scriptPath });

      if (!outputJson?.ok || !outputJson?.output_path || !fs.existsSync(outputJson.output_path)) {
        const openAiFallback = await tryGeneratePngWithOpenAI({
          prompt,
          outputPath,
          width: 1024,
          height: 1024,
          userId: req.user?.id || 'image-tool',
        });
        if (openAiFallback?.ok) {
          return res.json({
            ok: true,
            assistant: 'Image générée avec succès.',
            tool: 'generate_sd',
            artifact_type: 'image',
            image_url: openAiFallback.sourceUrl || null,
            filename: path.basename(openAiFallback.outputPath || outputPath),
            prompt,
            mode: openAiFallback.mode || 'openai-image',
          });
        }
        console.error('[no_image] stdout:', outputJson?.stdout || '');
        console.error('[no_image] stderr:', outputJson?.stderr || '');
        console.error('[no_image] outputJson:', outputJson);
        console.error('[no_image] output_path:', outputJson?.output_path);
        console.error('[no_image] existsSync:', outputJson?.output_path ? fs.existsSync(outputJson.output_path) : 'no path');
        return res.status(500).json({
          ok: false,
          error: openAiFallback?.error || outputJson?.error || 'no_image',
          message: openAiFallback?.message || outputJson?.message || 'Aucune image générée',
          raw: outputJson,
        });
      }
      try {
        const buffer = fs.readFileSync(outputJson.output_path);
        const filename = `sd_${Date.now()}.png`;
        const userId = req.user?.id || 'image-tool';
        const uploadResult = await uploadBufferToR2({
          userId, filename, buffer, contentType: 'image/png'
        });
        try { fs.unlinkSync(outputJson.output_path); } catch {}
        return res.json({
          ok: true,
          assistant: 'Image générée avec succès.',
          tool: 'generate_sd',
          artifact_type: 'image',
          image_url: uploadResult.url || null,
          filename,
          prompt,
          mode: 'stable-diffusion-local'
        });
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'upload_failed', message: String(e?.message) });
      }
      return;
    }

    // 2. Sinon, laisse le LLM répondre normalement
    if (!openaiClient) return res.status(500).json({ ok: false, error: 'llm_unavailable' });
    const completion = await openaiClient.chat.completions.create({
      model: process.env.A11_OPENAI_MODEL || 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Tu es l’assistant A11 en mode DEV. Si la demande est une génération d’image, ne réponds pas en texte, laisse le routeur déclencher le tool.' },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 512
    });
    const text = completion?.choices?.[0]?.message?.content || '';
    return res.json({ ok: true, mode: 'llm', assistant: text });
  });
};
