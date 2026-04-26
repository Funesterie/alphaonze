/**
 * Routes API pour le Tool-Calling Layer
 * 
 * Endpoints:
 * - GET  /api/tools/capabilities - Capacités disponibles
 * - POST /api/tools/call - Appeler un outil
 * - GET  /api/tools/jobs/:jobId - Statut d'un job
 * - GET  /api/tools/jobs - Liste des jobs
 * - GET  /api/tools/circuit-breaker - Statut du circuit breaker
 */

const express = require('express');

function createToolsRouter({ toolCallingLayer } = {}) {
  const router = express.Router();

  if (!toolCallingLayer) {
    throw new Error('toolCallingLayer is required');
  }

  // GET /api/tools/capabilities - Capacités disponibles
  router.get('/capabilities', (req, res) => {
    try {
      const capabilities = toolCallingLayer.getCapabilities();
      
      return res.json({
        ok: true,
        capabilities,
      });
    } catch (error) {
      console.error('[TOOLS] capabilities failed:', error.message);
      return res.status(500).json({
        ok: false,
        error: 'capabilities_failed',
        message: error.message,
      });
    }
  });

  // POST /api/tools/call - Appeler un outil
  router.post('/call', express.json({ limit: '10mb' }), async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      
      if (!userId) {
        return res.status(401).json({
          ok: false,
          error: 'missing_user',
        });
      }

      const toolName = String(req.body?.tool || req.body?.toolName || '').trim();
      
      if (!toolName) {
        return res.status(400).json({
          ok: false,
          error: 'missing_tool_name',
        });
      }

      const params = req.body?.params || req.body?.parameters || {};

      // Validation des paramètres selon l'outil
      if (toolName === 'generate_visual') {
        if (!params.prompt) {
          return res.status(400).json({
            ok: false,
            error: 'missing_prompt',
          });
        }
      } else if (toolName === 'generate_video') {
        if (!params.prompt) {
          return res.status(400).json({
            ok: false,
            error: 'missing_prompt',
          });
        }
      } else if (toolName === 'generate_audio') {
        if (!params.text_prompt) {
          return res.status(400).json({
            ok: false,
            error: 'missing_text_prompt',
          });
        }
      } else if (toolName === 'translate_text') {
        if (!params.source_text || !params.target_language) {
          return res.status(400).json({
            ok: false,
            error: 'missing_translation_params',
          });
        }
      } else if (toolName === 'search_web') {
        if (!params.query) {
          return res.status(400).json({
            ok: false,
            error: 'missing_query',
          });
        }
      } else {
        return res.status(400).json({
          ok: false,
          error: 'unknown_tool',
          availableTools: [
            'generate_visual',
            'generate_video',
            'generate_audio',
            'translate_text',
            'search_web',
          ],
        });
      }

      const result = await toolCallingLayer.callTool(toolName, params, userId);

      if (!result.ok) {
        if (result.error === 'circuit_breaker_open') {
          return res.status(503).json(result);
        }
        return res.status(500).json(result);
      }

      return res.json(result);
    } catch (error) {
      console.error('[TOOLS] call failed:', error.message);
      return res.status(500).json({
        ok: false,
        error: 'tool_call_failed',
        message: error.message,
      });
    }
  });

  // GET /api/tools/jobs/:jobId - Statut d'un job
  router.get('/jobs/:jobId', (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      
      if (!userId) {
        return res.status(401).json({
          ok: false,
          error: 'missing_user',
        });
      }

      const jobId = String(req.params?.jobId || '').trim();
      
      if (!jobId) {
        return res.status(400).json({
          ok: false,
          error: 'missing_job_id',
        });
      }

      const job = toolCallingLayer.getJobStatus(jobId);

      if (!job) {
        return res.status(404).json({
          ok: false,
          error: 'job_not_found',
        });
      }

      // Vérifier que le job appartient à l'utilisateur
      if (job.userId !== userId) {
        return res.status(403).json({
          ok: false,
          error: 'forbidden',
        });
      }

      return res.json({
        ok: true,
        job,
      });
    } catch (error) {
      console.error('[TOOLS] job status failed:', error.message);
      return res.status(500).json({
        ok: false,
        error: 'job_status_failed',
        message: error.message,
      });
    }
  });

  // GET /api/tools/jobs - Liste des jobs
  router.get('/jobs', (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      
      if (!userId) {
        return res.status(401).json({
          ok: false,
          error: 'missing_user',
        });
      }

      const filters = {};
      
      if (req.query.status) {
        filters.status = String(req.query.status).trim();
      }
      
      if (req.query.tool || req.query.toolName) {
        filters.toolName = String(req.query.tool || req.query.toolName).trim();
      }

      const jobs = toolCallingLayer.listJobs(userId, filters);

      return res.json({
        ok: true,
        count: jobs.length,
        jobs,
      });
    } catch (error) {
      console.error('[TOOLS] list jobs failed:', error.message);
      return res.status(500).json({
        ok: false,
        error: 'list_jobs_failed',
        message: error.message,
      });
    }
  });

  // GET /api/tools/circuit-breaker - Statut du circuit breaker
  router.get('/circuit-breaker', (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      
      if (!userId) {
        return res.status(401).json({
          ok: false,
          error: 'missing_user',
        });
      }

      const capabilities = toolCallingLayer.getCapabilities();

      return res.json({
        ok: true,
        circuitBreaker: capabilities.circuitBreaker || {},
      });
    } catch (error) {
      console.error('[TOOLS] circuit breaker status failed:', error.message);
      return res.status(500).json({
        ok: false,
        error: 'circuit_breaker_status_failed',
        message: error.message,
      });
    }
  });

  return router;
}

module.exports = createToolsRouter;
