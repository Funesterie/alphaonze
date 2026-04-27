// reflection.cjs
// Routes API pour la boucle de réflexion (Self-Correction)

const express = require('express');
const { createReflectionLoop, generateWithChainOfThought, generateWithTreeOfThought, verifySelfCorrect } = require('../../lib/reflection-loop.cjs');

function createReflectionRouter({ verifyJWT } = {}) {
  const router = express.Router();

  // POST /api/reflection/cot - Chain-of-Thought
  router.post('/api/reflection/cot', verifyJWT, express.json(), async (req, res) => {
    try {
      const prompt = String(req.body?.prompt || '').trim();
      const maxSteps = Math.max(1, Math.min(10, Number(req.body?.maxSteps || 3)));

      if (!prompt) {
        return res.status(400).json({
          ok: false,
          error: 'missing_prompt',
          message: 'prompt is required',
        });
      }

      const result = await generateWithChainOfThought(prompt, { maxSteps });

      return res.json(result);
    } catch (error) {
      req.logger?.error('Chain-of-Thought failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'cot_failed',
        message: String(error?.message || error),
      });
    }
  });

  // POST /api/reflection/tot - Tree-of-Thought
  router.post('/api/reflection/tot', verifyJWT, express.json(), async (req, res) => {
    try {
      const prompt = String(req.body?.prompt || '').trim();
      const numBranches = Math.max(2, Math.min(5, Number(req.body?.numBranches || 3)));

      if (!prompt) {
        return res.status(400).json({
          ok: false,
          error: 'missing_prompt',
          message: 'prompt is required',
        });
      }

      const result = await generateWithTreeOfThought(prompt, { numBranches });

      return res.json(result);
    } catch (error) {
      req.logger?.error('Tree-of-Thought failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'tot_failed',
        message: String(error?.message || error),
      });
    }
  });

  // POST /api/reflection/verify - Self-Correction
  router.post('/api/reflection/verify', verifyJWT, express.json(), async (req, res) => {
    try {
      const prompt = String(req.body?.prompt || '').trim();
      const response = String(req.body?.response || '').trim();

      if (!prompt || !response) {
        return res.status(400).json({
          ok: false,
          error: 'missing_parameters',
          message: 'prompt and response are required',
        });
      }

      const result = await verifySelfCorrect(prompt, response);

      return res.json(result);
    } catch (error) {
      req.logger?.error('Self-correction failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'verify_failed',
        message: String(error?.message || error),
      });
    }
  });

  // POST /api/reflection/generate - Génération avec vérification automatique
  router.post('/api/reflection/generate', verifyJWT, express.json(), async (req, res) => {
    try {
      const prompt = String(req.body?.prompt || '').trim();
      const mode = String(req.body?.mode || 'cot').trim();
      const maxSteps = Math.max(1, Math.min(10, Number(req.body?.maxSteps || 3)));

      if (!prompt) {
        return res.status(400).json({
          ok: false,
          error: 'missing_prompt',
          message: 'prompt is required',
        });
      }

      const reflectionLoop = createReflectionLoop({ mode });
      const result = await reflectionLoop.generateWithVerification(prompt, { maxSteps });

      return res.json(result);
    } catch (error) {
      req.logger?.error('Reflection generation failed', { error });
      return res.status(500).json({
        ok: false,
        error: 'generation_failed',
        message: String(error?.message || error),
      });
    }
  });

  return router;
}

module.exports = createReflectionRouter;
