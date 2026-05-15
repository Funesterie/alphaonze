'use strict';
/**
 * Vision Dev Route â€” endpoint sans auth pour Janus en mode dev local.
 * Permet aux agents MCP d'analyser des images sans JWT.
 *
 * POST /api/dev/vision
 * Body: { image: "data:image/png;base64,...", prompt: "..." }
 * Response: { ok: true, text: "..." }
 */

const express = require('express');
const { Router } = express;
const path = require('path');
const { spawn } = require('child_process');

function createVisionDevRouter() {
  const router = Router();
  router.use(express.json({ limit: process.env.A11_DEV_VISION_BODY_LIMIT || '20mb' }));

  const JANUS_PYTHON = process.env.A11_JANUS_PYTHON_PATH || 'python';
  const JANUS_MODEL = process.env.A11_JANUS_MODEL_DIR || path.resolve(__dirname, '../../tools/vision/models/Janus-Pro-7B');
  const JANUS_MODEL_1B = process.env.A11_JANUS_MODEL_DIR_1B || path.resolve(__dirname, '../../tools/vision/models/Janus-Pro-1B');
  const JANUS_DEVICE = process.env.A11_JANUS_DEVICE || 'cpu';
  const JANUS_DTYPE = process.env.A11_JANUS_TORCH_DTYPE || 'float32';
  const TIMEOUT_MS = parseInt(process.env.A11_JANUS_TIMEOUT_MS || '20000', 10);

  function resolveRequestedModel(body = {}) {
    const requested = String(body.modelVariant || body.variant || body.model || '').trim().toLowerCase();
    if (requested === '1b' || requested === 'janus-pro-1b' || requested.endsWith('/janus-pro-1b')) {
      return JANUS_MODEL_1B;
    }
    return JANUS_MODEL;
  }

  router.post('/', async (req, res) => {
    const { image, prompt } = req.body || {};
    if (!image || !prompt) {
      return res.status(400).json({ ok: false, error: 'missing image or prompt' });
    }

    // Extraire le base64 du data URI
    const b64Match = String(image).match(/^data:image\/\w+;base64,(.+)$/);
    const imageBase64 = b64Match ? b64Match[1] : String(image);

    const workerPath = path.resolve(__dirname, '../../tools/vision/janus_vision_worker.py');
    const modelPath = resolveRequestedModel(req.body || {});
    const timeoutMs = Math.min(120000, Math.max(1000, Number(req.body?.timeoutMs || TIMEOUT_MS) || TIMEOUT_MS));
    const request = JSON.stringify({
      id: Date.now(),
      action: 'vision_text',
      image_base64: imageBase64,
      prompt,
      max_new_tokens: Math.min(512, Math.max(32, Number(req.body?.maxNewTokens || req.body?.max_new_tokens || 320) || 320)),
      temperature: 0.0,
    });

    try {
      const result = await new Promise((resolve, reject) => {
        const proc = spawn(JANUS_PYTHON, [
          workerPath,
          '--model', modelPath,
          '--device', JANUS_DEVICE,
          '--dtype', JANUS_DTYPE,
        ]);

        let output = '';
        let ready = false;
        const timer = setTimeout(() => {
          proc.kill();
          reject(new Error('timeout'));
        }, timeoutMs);

        proc.stdout.on('data', (chunk) => {
          output += chunk.toString();
          const lines = output.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line.trim());
              if (parsed.type === 'ready') {
                ready = true;
                proc.stdin.write(request + '\n');
              } else if (parsed.ok !== undefined) {
                clearTimeout(timer);
                proc.kill();
                resolve(parsed);
              }
            } catch (e) {}
          }
          output = lines[lines.length - 1] || '';
        });

        proc.stderr.on('data', () => {});
        proc.on('error', (err) => { clearTimeout(timer); reject(err); });
        proc.on('close', (code) => {
          clearTimeout(timer);
          if (!ready) reject(new Error(`worker exited with code ${code}`));
        });
      });

      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = createVisionDevRouter;
