'use strict';

/**
 * routes/droid.cjs
 * Router Express exposant les 6 endpoints REST du Droid A11.
 *
 * Endpoints :
 *   POST   /api/droid/tasks                  → addDroidTask({ goal, meta })
 *   GET    /api/droid/status                 → getDroidStatus() (< 200ms)
 *   GET    /api/droid/tasks                  → listTasks(filter?)
 *   GET    /api/droid/tasks/:taskId          → getTaskById(taskId) (404 si non trouvé)
 *   DELETE /api/droid/tasks/:taskId          → cancelTask(taskId)
 *   POST   /api/droid/tasks/:taskId/rollback → rollbackTask(taskId) (400 si non suspendue)
 *
 * Export : module.exports = createDroidRouter (factory function recevant { droid })
 *
 * Exigences : 8.5, 5.3, 6.3
 */

const express = require('express');

const MAX_GOAL_LENGTH = 2000;
const MAX_PENDING_RUNNING = 10;

/**
 * Factory function qui crée le router Droid.
 *
 * @param {{ droid: object }} options - Options contenant le module a11-droid
 * @returns {express.Router}
 */
function createDroidRouter({ droid }) {
  if (!droid) {
    throw new Error('createDroidRouter: le paramètre { droid } est requis');
  }

  const router = express.Router();

  // ---------------------------------------------------------------------------
  // POST /api/droid/tasks — Créer une nouvelle Task
  // Valide : goal ≤ 2000 chars, max 10 tasks pending/running
  // ---------------------------------------------------------------------------
  router.post('/tasks', async (req, res) => {
    try {
      const { goal, meta } = req.body || {};

      // Validation : goal requis
      if (!goal || typeof goal !== 'string') {
        return res.status(400).json({
          error: 'validation_error',
          message: 'Le champ "goal" est requis et doit être une string.',
        });
      }

      const trimmedGoal = goal.trim();

      // Validation : goal ≤ 2000 chars
      if (trimmedGoal.length > MAX_GOAL_LENGTH) {
        return res.status(400).json({
          error: 'goal_too_long',
          message: `Le goal dépasse la limite de ${MAX_GOAL_LENGTH} caractères (longueur : ${trimmedGoal.length}).`,
          maxLength: MAX_GOAL_LENGTH,
          actualLength: trimmedGoal.length,
        });
      }

      // Validation : max 10 tasks pending/running
      // On vérifie via listTasks avant d'appeler addDroidTask
      const activeTasks = await droid.listTasks();
      const activeCount = activeTasks.filter(
        (t) => t.status === 'pending' || t.status === 'running'
      ).length;

      if (activeCount >= MAX_PENDING_RUNNING) {
        return res.status(429).json({
          error: 'too_many_active_tasks',
          message: `Trop de Tasks actives : ${activeCount} (max ${MAX_PENDING_RUNNING}). Attendez qu'une Task se termine.`,
          activeCount,
          maxActive: MAX_PENDING_RUNNING,
        });
      }

      const task = await droid.addDroidTask({
        goal: trimmedGoal,
        meta: meta && typeof meta === 'object' ? meta : {},
        userId: req.user ? req.user.id : undefined,
      });

      return res.status(201).json({
        ok: true,
        task,
      });
    } catch (err) {
      // addDroidTask peut lever une erreur si les validations internes échouent
      if (err.message && (err.message.includes('trop long') || err.message.includes('Trop de Tasks'))) {
        return res.status(400).json({
          error: 'validation_error',
          message: err.message,
        });
      }
      console.error('[DROID ROUTE] POST /tasks error:', err.message);
      return res.status(500).json({
        error: 'internal_error',
        message: err.message,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/droid/status — État global du Droid (< 200ms)
  // Inclut karma: { current, stats }
  // ---------------------------------------------------------------------------
  router.get('/status', async (req, res) => {
    try {
      const status = await droid.getDroidStatus();

      // Enrichir avec karma si non présent (getDroidStatus peut ne pas l'inclure)
      if (!status.karma) {
        // Tenter de récupérer le karma depuis karma-engine
        let karmaData = { current: 2.0, stats: {} };
        try {
          const karmaEngine = require('../lib/karma-engine.cjs');
          const [current, stats] = await Promise.all([
            karmaEngine.getCurrentKarma(),
            karmaEngine.getStats(),
          ]);
          karmaData = { current, stats };
        } catch (_e) {
          // karma-engine indisponible : valeurs par défaut
        }
        status.karma = karmaData;
      }

      return res.status(200).json({
        ok: true,
        status,
      });
    } catch (err) {
      console.error('[DROID ROUTE] GET /status error:', err.message);
      return res.status(500).json({
        error: 'internal_error',
        message: err.message,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/droid/tasks — Lister les Tasks (filtre optionnel par statut)
  // ---------------------------------------------------------------------------
  router.get('/tasks', async (req, res) => {
    try {
      const { status } = req.query;

      const filter = status ? { status: String(status) } : undefined;
      const tasks = await droid.listTasks(filter);

      return res.status(200).json({
        ok: true,
        tasks,
        count: tasks.length,
        filter: filter || null,
      });
    } catch (err) {
      console.error('[DROID ROUTE] GET /tasks error:', err.message);
      return res.status(500).json({
        error: 'internal_error',
        message: err.message,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/droid/tasks/:taskId — Récupérer une Task par ID (404 si non trouvée)
  // ---------------------------------------------------------------------------
  router.get('/tasks/:taskId', async (req, res) => {
    try {
      const { taskId } = req.params;

      if (!taskId || typeof taskId !== 'string') {
        return res.status(400).json({
          error: 'validation_error',
          message: 'Le paramètre taskId est requis.',
        });
      }

      const task = await droid.getTaskById(taskId);

      if (!task) {
        return res.status(404).json({
          error: 'task_not_found',
          message: `Task introuvable : ${taskId}`,
          taskId,
        });
      }

      return res.status(200).json({
        ok: true,
        task,
      });
    } catch (err) {
      console.error('[DROID ROUTE] GET /tasks/:taskId error:', err.message);
      return res.status(500).json({
        error: 'internal_error',
        message: err.message,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // DELETE /api/droid/tasks/:taskId — Annuler une Task
  // ---------------------------------------------------------------------------
  router.delete('/tasks/:taskId', async (req, res) => {
    try {
      const { taskId } = req.params;

      if (!taskId || typeof taskId !== 'string') {
        return res.status(400).json({
          error: 'validation_error',
          message: 'Le paramètre taskId est requis.',
        });
      }

      // Vérifier que la task existe
      const task = await droid.getTaskById(taskId);
      if (!task) {
        return res.status(404).json({
          error: 'task_not_found',
          message: `Task introuvable : ${taskId}`,
          taskId,
        });
      }

      const cancelled = await droid.cancelTask(taskId);

      if (!cancelled) {
        return res.status(409).json({
          error: 'cancel_failed',
          message: `Impossible d'annuler la Task ${taskId} (statut actuel : ${task.status}).`,
          taskId,
          currentStatus: task.status,
        });
      }

      return res.status(200).json({
        ok: true,
        message: `Task ${taskId} annulée avec succès.`,
        taskId,
      });
    } catch (err) {
      console.error('[DROID ROUTE] DELETE /tasks/:taskId error:', err.message);
      return res.status(500).json({
        error: 'internal_error',
        message: err.message,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/droid/tasks/:taskId/rollback — Rollback d'une Task (400 si non suspendue)
  // ---------------------------------------------------------------------------
  router.post('/tasks/:taskId/rollback', async (req, res) => {
    try {
      const { taskId } = req.params;

      if (!taskId || typeof taskId !== 'string') {
        return res.status(400).json({
          error: 'validation_error',
          message: 'Le paramètre taskId est requis.',
        });
      }

      // Vérifier que la task existe
      const task = await droid.getTaskById(taskId);
      if (!task) {
        return res.status(404).json({
          error: 'task_not_found',
          message: `Task introuvable : ${taskId}`,
          taskId,
        });
      }

      // 400 si la Task n'est pas suspendue
      if (task.status !== 'suspended') {
        return res.status(400).json({
          error: 'task_not_suspended',
          message: `Le rollback n'est possible que sur une Task suspendue. Statut actuel : "${task.status}".`,
          taskId,
          currentStatus: task.status,
          requiredStatus: 'suspended',
        });
      }

      const rolled = await droid.rollbackTask(taskId);

      if (!rolled) {
        return res.status(409).json({
          error: 'rollback_failed',
          message: `Rollback impossible pour la Task ${taskId} (aucun checkpoint disponible).`,
          taskId,
        });
      }

      // Récupérer la task mise à jour
      const updatedTask = await droid.getTaskById(taskId);

      return res.status(200).json({
        ok: true,
        message: `Task ${taskId} restaurée depuis le dernier checkpoint.`,
        taskId,
        task: updatedTask,
      });
    } catch (err) {
      console.error('[DROID ROUTE] POST /tasks/:taskId/rollback error:', err.message);
      return res.status(500).json({
        error: 'internal_error',
        message: err.message,
      });
    }
  });

  return router;
}

module.exports = createDroidRouter;
