/**
 * TTS API Routes - Text-to-Speech Service
 * Endpoints pour service TTS supervisé (Piper)
 */

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { spawn } = require('child_process');

/**
 * Register TTS API routes
 * @param {express.Router} router - Express router instance
 */
function registerTTSRoutes(router) {
  console.log('[TTS] Registering TTS API routes...');

  const PIPER_DIR = process.env.PIPER_DIR || path.resolve(__dirname, '../../../piper');
  const PIPER_EXE = path.join(PIPER_DIR, 'piper.exe');
  const MODELS_DIR = path.join(PIPER_DIR, 'models');

  // Health check
  router.get('/tts/health', (req, res) => {
    const piperExists = fsSync.existsSync(PIPER_EXE);
    const modelExists = fsSync.existsSync(path.join(MODELS_DIR, 'fr_FR-siwis-medium.onnx'));

    res.json({
      ok: piperExists && modelExists,
      available: piperExists,
      piper_path: PIPER_EXE,
      piper_exists: piperExists,
      model_exists: modelExists,
      models_dir: MODELS_DIR
    });
  });

  // TTS stats endpoint
  router.get('/tts/stats', (req, res) => {
    try {
      const piperExists = fsSync.existsSync(PIPER_EXE);
      if (!piperExists) {
        return res.json({ available: false, provider: 'piper', error: 'Piper not installed' });
      }

      // List available models
      const voices = [];
      if (fsSync.existsSync(MODELS_DIR)) {
        const files = fsSync.readdirSync(MODELS_DIR);
        files.forEach(file => {
          if (file.endsWith('.onnx')) {
            voices.push(file.replace('.onnx', ''));
          }
        });
      }

      res.json({
        available: true,
        provider: 'piper',
        voices,
        piper_path: PIPER_EXE,
        models_dir: MODELS_DIR
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Main TTS speak endpoint (already exists in server.cjs, this is a complement)
  // This route provides additional features or can be used independently
  router.post('/tts/synthesize', async (req, res) => {
    try {
      const { text, voice = 'fr_FR-siwis-medium', format = 'wav' } = req.body;
      if (!text) {
        return res.status(400).json({ error: 'text required' });
      }

      if (!fsSync.existsSync(PIPER_EXE)) {
        return res.status(503).json({ error: 'Piper not installed', path: PIPER_EXE });
      }

      const modelName = voice.endsWith('.onnx') ? voice : `${voice}.onnx`;
      const modelPath = path.join(MODELS_DIR, modelName);

      if (!fsSync.existsSync(modelPath)) {
        return res.status(404).json({ error: 'Model not found', model: modelPath });
      }

      const outputFile = path.join(PIPER_DIR, `out_${Date.now()}.wav`);
      const pitch = String(process.env.TTS_SPEAKER_PITCH || '-20');

      const args = [
        '--model', modelPath,
        '--output_file', outputFile,
        '--speaker-pitch', pitch
      ];

      console.log('[TTS] Synthesizing:', { text: text.substring(0, 50), voice, output: outputFile });

      const proc = spawn(PIPER_EXE, args, { cwd: PIPER_DIR, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

      let stderrBuf = '';
      let responded = false;

      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write(text);
        proc.stdin.end();
      }

      proc.stderr?.on('data', (d) => {
        stderrBuf += d.toString();
        const s = String(d).trim();
        if (s && s.length < 300) console.error('[TTS][Piper][stderr]', s);
      });

      proc.on('error', (err) => {
        if (responded) return;
        responded = true;
        console.error('[TTS] Spawn error:', err.message);
        return res.status(500).json({ error: 'piper_spawn_error', message: err.message, stderr: stderrBuf.slice(0, 1000) });
      });

      proc.on('close', async (code) => {
        if (responded) return;
        responded = true;

        if (code !== 0) {
          console.error('[TTS] Piper exited with code', code);
          return res.status(500).json({ error: 'piper_failed', code, stderr: stderrBuf.slice(0, 2000) });
        }

        try {
          const data = await fs.readFile(outputFile);
          res.setHeader('Content-Type', 'audio/wav');
          res.setHeader('Content-Disposition', 'inline; filename="tts.wav"');
          res.send(data);

          // Cleanup after sending
          setTimeout(() => {
            fs.unlink(outputFile).catch(() => {});
          }, 1000);
        } catch (err) {
          console.error('[TTS] Failed to read output file:', err.message);
          return res.status(500).json({ error: 'output_read_failed', message: err.message });
        }
      });
    } catch (err) {
      console.error('[TTS] Synthesize error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // List available voices
  router.get('/tts/voices', (req, res) => {
    try {
      const voices = [];
      if (fsSync.existsSync(MODELS_DIR)) {
        const files = fsSync.readdirSync(MODELS_DIR);
        files.forEach(file => {
          if (file.endsWith('.onnx')) {
            const name = file.replace('.onnx', '');
            voices.push({
              id: name,
              name: name,
              language: name.split('-')[0] || 'unknown',
              provider: 'piper'
            });
          }
        });
      }
      res.json({ voices });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  console.log('[TTS] ✓ TTS API routes registered');
}

module.exports = { registerTTSRoutes };
