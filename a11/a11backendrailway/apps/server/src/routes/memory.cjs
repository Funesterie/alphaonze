const express = require('express');

function createMemoryRouter({
  verifyJWT,
  db,
  normalizeConversationId,
  getLogicalUserMemory,
  getUserFacts,
  getUserTasks,
  getUserFilesMemory,
  listConversationPhantomMemory,
  listUserPhantomMemory,
  mergePhantomMemoryEntries,
  listGhostMemory,
  restoreGhostMemory,
  purgeExpiredGhostMemory,
  purgeConversationPhantomMemory,
  pruneStructuredMemory,
  isAdminRequest,
  FACT_MEMORY_LIMIT,
  TASK_MEMORY_LIMIT,
  FILE_MEMORY_LIMIT,
  PHANTOM_MEMORY_LIST_LIMIT,
  PHANTOM_MEMORY_STATES,
  PHANTOM_MEMORY_STATE_ACTIVE,
  PHANTOM_MEMORY_STATE_USEFUL,
  PHANTOM_MEMORY_STATE_GHOST,
  FACT_RETENTION_DAYS,
  TASK_RETENTION_DAYS,
  FILE_RETENTION_DAYS,
  FACT_MIN_RELEVANCE,
} = {}) {
  const router = express.Router();

  async function getStructuredMemoryCounts(userId) {
    const normalizedUserId = String(userId || '').trim();
    if (!db || !normalizedUserId) {
      return { facts: 0, tasks: 0, files: 0 };
    }

    const [factsRes, tasksRes, filesRes] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS count FROM user_facts WHERE user_id=$1', [normalizedUserId]),
      db.query('SELECT COUNT(*)::int AS count FROM user_tasks WHERE user_id=$1', [normalizedUserId]),
      db.query('SELECT COUNT(*)::int AS count FROM user_files WHERE user_id=$1', [normalizedUserId]),
    ]);

    return {
      facts: Number(factsRes.rows[0]?.count || 0),
      tasks: Number(tasksRes.rows[0]?.count || 0),
      files: Number(filesRes.rows[0]?.count || 0),
    };
  }

  async function getStructuredMemoryPurgeCandidates(userId) {
    const normalizedUserId = String(userId || '').trim();
    if (!db || !normalizedUserId) {
      return { facts: 0, tasks: 0, files: 0 };
    }

    const factRetentionDays = Math.max(7, FACT_RETENTION_DAYS);
    const taskRetentionDays = Math.max(14, TASK_RETENTION_DAYS);
    const fileRetentionDays = Math.max(14, FILE_RETENTION_DAYS);

    const [factsRes, tasksRes, filesRes] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM user_facts
         WHERE user_id = $1
           AND (
             relevance_score < $2
             OR updated_at < NOW() - ($3 * INTERVAL '1 day')
           )
           AND COALESCE(last_used_at, updated_at) < NOW() - (GREATEST(7, $3 / 2) * INTERVAL '1 day')`,
        [normalizedUserId, FACT_MIN_RELEVANCE, factRetentionDays]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM user_tasks
         WHERE user_id = $1
           AND status = 'done'
           AND COALESCE(closed_at, updated_at) < NOW() - ($2 * INTERVAL '1 day')`,
        [normalizedUserId, taskRetentionDays]
      ),
      db.query(
        `SELECT COUNT(*)::int AS count
         FROM user_files
         WHERE user_id = $1
           AND created_at < NOW() - ($2 * INTERVAL '1 day')`,
        [normalizedUserId, fileRetentionDays]
      ),
    ]);

    return {
      facts: Number(factsRes.rows[0]?.count || 0),
      tasks: Number(tasksRes.rows[0]?.count || 0),
      files: Number(filesRes.rows[0]?.count || 0),
    };
  }

  router.get('/api/memory', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });
      if (!db) return res.status(503).json({ ok: false, error: 'database_unavailable' });
      const conversationId = normalizeConversationId(req.query.conversationId);

      const [summary, facts, tasks, files, fantome] = await Promise.all([
        getLogicalUserMemory(userId),
        getUserFacts(userId, FACT_MEMORY_LIMIT),
        getUserTasks(userId, TASK_MEMORY_LIMIT),
        getUserFilesMemory(userId, FILE_MEMORY_LIMIT),
        listConversationPhantomMemory(userId, conversationId, {
          states: [PHANTOM_MEMORY_STATE_ACTIVE, PHANTOM_MEMORY_STATE_USEFUL, PHANTOM_MEMORY_STATE_GHOST],
          limit: PHANTOM_MEMORY_LIST_LIMIT,
        }),
      ]);

      return res.json({
        ok: true,
        userId,
        conversationId,
        memory: {
          summary,
          facts,
          tasks,
          files,
          fantome,
        },
        limits: {
          facts: FACT_MEMORY_LIMIT,
          tasks: TASK_MEMORY_LIMIT,
          files: FILE_MEMORY_LIMIT,
          fantome: PHANTOM_MEMORY_LIST_LIMIT,
        },
      });
    } catch (e) {
      console.error('[MEMORY] read failed:', e?.message);
      return res.status(500).json({ ok: false, error: 'memory_read_failed', message: String(e?.message) });
    }
  });

  router.post('/api/memory/purge-now', verifyJWT, express.json(), async (req, res) => {
    try {
      if (!isAdminRequest(req)) {
        return res.status(403).json({ ok: false, error: 'admin_required' });
      }

      const targetUserId = String(req.body?.userId || req.query.userId || req.user?.id || '').trim();
      const dryRunRaw = req.body?.dryRun ?? req.query?.dryRun;
      const dryRun = dryRunRaw === true || dryRunRaw === 'true' || dryRunRaw === '1' || dryRunRaw === 1;
      if (!targetUserId) {
        return res.status(400).json({ ok: false, error: 'missing_user_id' });
      }
      if (!db) return res.status(503).json({ ok: false, error: 'database_unavailable' });

      const before = await getStructuredMemoryCounts(targetUserId);
      let after = before;
      let removed = { facts: 0, tasks: 0, files: 0 };
      let wouldRemove = null;

      if (dryRun) {
        wouldRemove = await getStructuredMemoryPurgeCandidates(targetUserId);
      } else {
        await pruneStructuredMemory(targetUserId);
        after = await getStructuredMemoryCounts(targetUserId);
        removed = {
          facts: Math.max(0, before.facts - after.facts),
          tasks: Math.max(0, before.tasks - after.tasks),
          files: Math.max(0, before.files - after.files),
        };
      }

      return res.json({
        ok: true,
        userId: targetUserId,
        dryRun,
        purgeTriggeredAt: new Date().toISOString(),
        before,
        after,
        removed,
        wouldRemove,
      });
    } catch (e) {
      console.error('[MEMORY] purge-now failed:', e?.message);
      return res.status(500).json({ ok: false, error: 'memory_purge_failed', message: String(e?.message) });
    }
  });

  router.get('/api/memory/fantome', verifyJWT, async (req, res) => {
    try {
      const sessionUserId = String(req.user?.id || '').trim();
      const requestedUserId = String(req.query.userId || sessionUserId || '').trim();
      if (!requestedUserId) return res.status(401).json({ ok: false, error: 'missing_user' });
      if (requestedUserId !== sessionUserId && !isAdminRequest(req)) {
        return res.status(403).json({ ok: false, error: 'admin_required' });
      }

      const conversationId = normalizeConversationId(req.query.conversationId);
      const stateQuery = String(req.query.state || '').trim();
      const memoryTypeQuery = String(req.query.memoryType || '').trim();
      const includeUserScope = ['1', 'true', 'yes', 'on'].includes(String(req.query.includeUser || '').trim().toLowerCase());
      const states = stateQuery
        ? stateQuery.split(',').map((value) => String(value || '').trim().toLowerCase()).filter((value) => PHANTOM_MEMORY_STATES.has(value))
        : [];
      const memoryTypes = memoryTypeQuery
        ? memoryTypeQuery.split(',').map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
        : [];
      const limit = Math.max(1, Math.min(100, Number(req.query.limit || PHANTOM_MEMORY_LIST_LIMIT)));
      const entries = await listConversationPhantomMemory(requestedUserId, conversationId, {
        states,
        memoryTypes,
        limit,
      });
      const userEntries = includeUserScope
        ? await listUserPhantomMemory(requestedUserId, {
          states,
          memoryTypes,
          limit,
        })
        : [];
      const mergedEntries = includeUserScope ? mergePhantomMemoryEntries([entries, userEntries], limit) : entries;

      return res.json({
        ok: true,
        userId: requestedUserId,
        conversationId,
        entries: mergedEntries,
        ...(includeUserScope ? {
          conversationEntries: entries,
          userEntries,
          scope: 'merged',
        } : {
          scope: 'conversation',
        }),
        states: states.length ? states : [...PHANTOM_MEMORY_STATES],
        memoryTypes,
      });
    } catch (e) {
      console.error('[MEMORY][FANTOME] list failed:', e?.message);
      return res.status(500).json({ ok: false, error: 'phantom_memory_list_failed', message: String(e?.message) });
    }
  });

  router.get('/api/memory/fantome/ghost', verifyJWT, async (req, res) => {
    try {
      const sessionUserId = String(req.user?.id || '').trim();
      const requestedUserId = String(req.query.userId || sessionUserId || '').trim();
      if (!requestedUserId) return res.status(401).json({ ok: false, error: 'missing_user' });
      if (requestedUserId !== sessionUserId && !isAdminRequest(req)) {
        return res.status(403).json({ ok: false, error: 'admin_required' });
      }

      const conversationId = normalizeConversationId(req.query.conversationId);
      const limit = Math.max(1, Math.min(100, Number(req.query.limit || PHANTOM_MEMORY_LIST_LIMIT)));
      const entries = await listGhostMemory(requestedUserId, conversationId, limit);
      return res.json({
        ok: true,
        userId: requestedUserId,
        conversationId,
        count: entries.length,
        entries,
      });
    } catch (e) {
      console.error('[MEMORY][FANTOME] ghost list failed:', e?.message);
      return res.status(500).json({ ok: false, error: 'ghost_memory_list_failed', message: String(e?.message) });
    }
  });

  router.post('/api/memory/fantome/ghost/restore', verifyJWT, express.json(), async (req, res) => {
    try {
      const sessionUserId = String(req.user?.id || '').trim();
      const requestedUserId = String(req.body?.userId || sessionUserId || '').trim();
      if (!requestedUserId) return res.status(401).json({ ok: false, error: 'missing_user' });
      if (requestedUserId !== sessionUserId && !isAdminRequest(req)) {
        return res.status(403).json({ ok: false, error: 'admin_required' });
      }

      const conversationId = normalizeConversationId(req.body?.conversationId);
      const id = String(req.body?.id || req.body?.key || '').trim();
      const targetState = String(req.body?.targetState || PHANTOM_MEMORY_STATE_ACTIVE).trim().toLowerCase();
      if (!id) {
        return res.status(400).json({ ok: false, error: 'missing_memory_id' });
      }

      const result = await restoreGhostMemory(requestedUserId, conversationId, id, targetState);
      if (!result?.ok) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (e) {
      console.error('[MEMORY][FANTOME] ghost restore failed:', e?.message);
      return res.status(500).json({ ok: false, error: 'ghost_restore_failed', message: String(e?.message) });
    }
  });

  router.post('/api/memory/fantome/ghost/purge-expired', verifyJWT, express.json(), async (req, res) => {
    try {
      const sessionUserId = String(req.user?.id || '').trim();
      const requestedUserId = String(req.body?.userId || sessionUserId || '').trim();
      if (!requestedUserId) return res.status(401).json({ ok: false, error: 'missing_user' });
      if (requestedUserId !== sessionUserId && !isAdminRequest(req)) {
        return res.status(403).json({ ok: false, error: 'admin_required' });
      }

      const conversationId = normalizeConversationId(req.body?.conversationId);
      const result = await purgeExpiredGhostMemory(requestedUserId, conversationId);
      return res.json({
        ok: true,
        userId: requestedUserId,
        conversationId,
        removed: Number(result?.removed || 0),
      });
    } catch (e) {
      console.error('[MEMORY][FANTOME] ghost purge failed:', e?.message);
      return res.status(500).json({ ok: false, error: 'ghost_purge_failed', message: String(e?.message) });
    }
  });

  router.post('/api/memory/fantome/purge-conversation', verifyJWT, express.json(), async (req, res) => {
    try {
      const sessionUserId = String(req.user?.id || '').trim();
      const requestedUserId = String(req.body?.userId || sessionUserId || '').trim();
      if (!requestedUserId) return res.status(401).json({ ok: false, error: 'missing_user' });
      if (requestedUserId !== sessionUserId && !isAdminRequest(req)) {
        return res.status(403).json({ ok: false, error: 'admin_required' });
      }

      const conversationId = normalizeConversationId(req.body?.conversationId);
      const result = await purgeConversationPhantomMemory(requestedUserId, conversationId);
      if (!result?.ok) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (e) {
      console.error('[MEMORY][FANTOME] conversation purge failed:', e?.message);
      return res.status(500).json({ ok: false, error: 'conversation_purge_failed', message: String(e?.message) });
    }
  });

  return router;
}

module.exports = createMemoryRouter;
