
const path = require('path');
const express = require('express');
const WORKSPACE_ROOT = process.env.A11_WORKSPACE_ROOT || path.resolve(__dirname, '..');

function createA11HistoryRouter({
  verifyJWT,
  db,
  normalizeConversationId,
  purgeConversationLogEntries,
  purgeConversationPhantomMemory,
  listConversationResources,
  readConversationLogEntries,
  buildConversationActivityEntry,
} = {}) {
  const router = express.Router();

  function normalizeHistorySurface(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'k44' || normalized === 'kaen44') return 'kaen44';
    if (normalized === 'vivy') return 'vivy';
    if (normalized === 'a11' || normalized === 'a-11') return 'a11';
    return '';
  }

  function getRequestSurface(req) {
    return normalizeHistorySurface(req?.query?.surface || req?.headers?.['x-a11-surface'] || req?.headers?.['x-funesterie-surface']);
  }

  function scopeConversationIdForSurface(conversationId, surface = '') {
    const normalizedConversationId = normalizeConversationId(conversationId || 'default');
    const normalizedSurface = normalizeHistorySurface(surface);
    if (!normalizedSurface) return normalizedConversationId;
    if (/^(a11|kaen44|vivy):/i.test(normalizedConversationId)) return normalizedConversationId;
    return `${normalizedSurface}:${normalizedConversationId}`;
  }

  function stripSurfaceConversationId(conversationId) {
    return String(conversationId || '').trim().replace(/^(a11|kaen44|vivy):/i, '');
  }

  function conversationNameFromId(conversationId) {
    const stripped = stripSurfaceConversationId(conversationId) || 'default';
    return stripped === 'default' ? 'Session par défaut' : stripped;
  }

  router.get('/api/a11/history', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!db || !userId) return res.json([]);
      const surface = getRequestSurface(req);
      const surfaceFilter = surface ? "AND COALESCE(conversation_id, 'default') LIKE $2" : '';
      const queryParams = surface ? [userId, `${surface}:%`] : [userId];

      const summary = await db.query(
        `WITH message_conversations AS (
           SELECT COALESCE(conversation_id, 'default') AS conversation_id,
                  COUNT(*)::int AS message_count,
                  MAX(created_at) AS updated_at
           FROM messages
           WHERE user_id=$1
             ${surfaceFilter}
           GROUP BY COALESCE(conversation_id, 'default')
         ),
         resource_conversations AS (
           SELECT conversation_id,
                  0::int AS message_count,
                  MAX(updated_at) AS updated_at
           FROM conversation_resources
           WHERE user_id=$1
             AND (expires_at IS NULL OR expires_at > NOW())
             ${surfaceFilter}
           GROUP BY conversation_id
         ),
         merged AS (
           SELECT conversation_id,
                  SUM(message_count)::int AS message_count,
                  MAX(updated_at) AS updated_at
           FROM (
             SELECT * FROM message_conversations
             UNION ALL
             SELECT * FROM resource_conversations
           ) grouped
           GROUP BY conversation_id
         )
         SELECT conversation_id, message_count, updated_at
         FROM merged
         ORDER BY updated_at DESC, conversation_id ASC`,
        queryParams
      );

      const conversations = summary.rows.map((row) => ({
        id: String(row.conversation_id || 'default'),
        name: conversationNameFromId(row.conversation_id || 'default'),
        updated: row.updated_at || new Date().toISOString(),
        messageCount: Number(row.message_count || 0),
      }));

      return res.json(conversations);
    } catch (e) {
      console.error('[A11][History] List error:', e?.message);
      return res.status(500).json({ error: 'history_list_failed' });
    }
  });

  router.get('/api/a11/history/:id', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!db || !userId) {
        return res.json({ id: req.params.id, messages: [] });
      }

      const surface = getRequestSurface(req);
      const requestedId = String(req.params.id || '').trim();
      const legacyHistoryId = `user-${userId}`;
      const requestedConversationId = requestedId === legacyHistoryId
        ? ''
        : scopeConversationIdForSurface(requestedId, surface);

      let result;
      if (requestedConversationId) {
        result = await db.query(
          'SELECT id, role, content, created_at FROM messages WHERE user_id=$1 AND COALESCE(conversation_id, $2)=$2 ORDER BY created_at ASC, id ASC LIMIT 200',
          [userId, requestedConversationId]
        );
      } else {
        result = await db.query(
          'SELECT id, role, content, created_at FROM messages WHERE user_id=$1 ORDER BY created_at ASC, id ASC LIMIT 200',
          [userId]
        );
      }

      return res.json({
        id: requestedConversationId || legacyHistoryId,
        conversationId: requestedConversationId || null,
        messages: result.rows.map((row) => ({
          id: `msg-${row.id}`,
          role: String(row.role || 'assistant'),
          content: String(row.content || ''),
          ts: row.created_at,
        })),
      });
    } catch (e) {
      console.error('[A11][History] Conversation error:', e?.message);
      return res.status(500).json({ error: 'history_conversation_failed' });
    }
  });

  router.delete('/api/a11/history', verifyJWT, async (req, res) => {
    const userId = String(req.user?.id || '').trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'missing_user' });
    }

    let transactionStarted = false;
    try {
      const surface = getRequestSurface(req);
      const surfaceFilter = surface ? "AND COALESCE(conversation_id, 'default') LIKE $2" : '';
      const queryParams = surface ? [userId, `${surface}:%`] : [userId];
      let conversationIds = [];
      let removedConversations = 0;
      let removedMessages = 0;
      let removedResources = 0;
      let removedPhantomEntries = 0;
      let removedActivityEntries = 0;

      if (db) {
        const conversationResult = await db.query(
          `SELECT DISTINCT COALESCE(conversation_id, 'default') AS conversation_id
           FROM (
             SELECT conversation_id
             FROM messages
             WHERE user_id = $1
               ${surfaceFilter}
             UNION ALL
             SELECT conversation_id
             FROM conversation_resources
             WHERE user_id = $1
               ${surfaceFilter}
           ) conversations`,
          queryParams
        );
        conversationIds = conversationResult.rows
          .map((row) => normalizeConversationId(row?.conversation_id || 'default'))
          .filter(Boolean);
        removedConversations = conversationIds.length;

        await db.query('BEGIN');
        transactionStarted = true;

        const deletedMessages = await db.query(
          `DELETE FROM messages WHERE user_id=$1 ${surfaceFilter}`,
          queryParams
        );
        const deletedResources = await db.query(
          `DELETE FROM conversation_resources WHERE user_id=$1 ${surfaceFilter}`,
          queryParams
        );

        removedMessages = Number(deletedMessages.rowCount || 0);
        removedResources = Number(deletedResources.rowCount || 0);

        await db.query('COMMIT');
        transactionStarted = false;
      }

      if (surface) {
        for (const conversationId of conversationIds) {
          const activityPurge = purgeConversationLogEntries({ userId, conversationId });
          removedActivityEntries += Number(activityPurge.removedEntries || 0);
        }
      } else {
        const activityPurge = purgeConversationLogEntries({ userId });
        removedActivityEntries += Number(activityPurge.removedEntries || 0);
      }

      for (const conversationId of conversationIds) {
        try {
          const purgeResult = await purgeConversationPhantomMemory(userId, conversationId);
          removedPhantomEntries += Number(purgeResult?.removed || 0);
        } catch (purgeError) {
          console.warn('[A11][History] Phantom purge failed:', conversationId, purgeError?.message);
        }
      }

      return res.json({
        ok: true,
        removedConversations,
        removedMessages,
        removedResources,
        removedPhantomEntries,
        removedActivityEntries,
      });
    } catch (e) {
      if (db && transactionStarted) {
        try { await db.query('ROLLBACK'); } catch {}
      }
      console.error('[A11][History] Clear error:', e?.message);
      return res.status(500).json({
        ok: false,
        error: 'history_clear_failed',
        message: String(e?.message || e),
      });
    }
  });

  router.delete('/api/a11/history/:id', verifyJWT, async (req, res) => {
    const userId = String(req.user?.id || '').trim();
    if (!userId) {
      return res.status(401).json({ ok: false, error: 'missing_user' });
    }

    const requestedId = String(req.params.id || '').trim();
    if (!requestedId) {
      return res.status(400).json({ ok: false, error: 'missing_conversation_id' });
    }

    const surface = getRequestSurface(req);
    const legacyHistoryId = `user-${userId}`;
    const targetConversationId = requestedId === legacyHistoryId
      ? 'default'
      : scopeConversationIdForSurface(requestedId, surface);

    let transactionStarted = false;
    try {
      let removedMessages = 0;
      let removedResources = 0;
      let removedPhantomEntries = 0;

      if (db) {
        await db.query('BEGIN');
        transactionStarted = true;

        const deletedMessages = await db.query(
          `DELETE FROM messages
           WHERE user_id = $1
             AND COALESCE(conversation_id, 'default') = $2`,
          [userId, targetConversationId]
        );
        const deletedResources = await db.query(
          `DELETE FROM conversation_resources
           WHERE user_id = $1
             AND COALESCE(conversation_id, 'default') = $2`,
          [userId, targetConversationId]
        );

        removedMessages = Number(deletedMessages.rowCount || 0);
        removedResources = Number(deletedResources.rowCount || 0);

        await db.query('COMMIT');
        transactionStarted = false;
      }

      const activityPurge = purgeConversationLogEntries({
        userId,
        conversationId: targetConversationId,
      });
      try {
        const purgeResult = await purgeConversationPhantomMemory(userId, targetConversationId);
        removedPhantomEntries = Number(purgeResult?.removed || 0);
      } catch (purgeError) {
        console.warn('[A11][History] Conversation phantom purge failed:', targetConversationId, purgeError?.message);
      }
      const removed = removedMessages > 0
        || removedResources > 0
        || removedPhantomEntries > 0
        || Number(activityPurge.removedEntries || 0) > 0;

      return res.json({
        ok: true,
        removed,
        id: targetConversationId,
        removedMessages,
        removedResources,
        removedPhantomEntries,
        removedActivityEntries: Number(activityPurge.removedEntries || 0),
      });
    } catch (e) {
      if (db && transactionStarted) {
        try { await db.query('ROLLBACK'); } catch {}
      }
      console.error('[A11][History] Delete error:', e?.message);
      return res.status(500).json({
        ok: false,
        error: 'history_delete_failed',
        message: String(e?.message || e),
      });
    }
  });

  router.get('/api/a11/history/:id/resources', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const surface = getRequestSurface(req);
      const requestedId = String(req.params.id || '').trim();
      const legacyHistoryId = `user-${userId}`;
      const queryConversationId = String(req.query.conversationId || '').trim();
      const requestedConversationId = requestedId && requestedId !== legacyHistoryId
        ? scopeConversationIdForSurface(requestedId, surface)
        : (queryConversationId ? scopeConversationIdForSurface(queryConversationId, surface) : '');
      const requestedKind = String(req.query.kind || '').trim();
      const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
      const resources = db && typeof listConversationResources === 'function'
        ? await listConversationResources(userId, {
            conversationId: requestedConversationId,
            resourceKind: requestedKind,
            limit,
          })
        : [];

      return res.json({
        ok: true,
        id: requestedId || legacyHistoryId,
        conversationId: requestedConversationId || null,
        resources,
        count: resources.length,
      });
    } catch (e) {
      console.error('[A11][History] Resource list error:', e?.message);
      return res.status(500).json({ ok: false, error: 'history_resource_list_failed' });
    }
  });

  router.get('/api/a11/history/:id/activity', verifyJWT, async (req, res) => {
    try {
      const userId = String(req.user?.id || '').trim();
      if (!userId) return res.status(401).json({ ok: false, error: 'missing_user' });

      const surface = getRequestSurface(req);
      const requestedId = String(req.params.id || '').trim();
      const legacyHistoryId = `user-${userId}`;
      const queryConversationId = String(req.query.conversationId || '').trim();
      const requestedConversationId = requestedId && requestedId !== legacyHistoryId
        ? scopeConversationIdForSurface(requestedId, surface)
        : (queryConversationId ? scopeConversationIdForSurface(queryConversationId, surface) : '');
      const limit = Math.max(1, Math.min(50, Number(req.query.limit || 12)));

      if (!requestedConversationId) {
        return res.json({
          ok: true,
          id: requestedId || legacyHistoryId,
          conversationId: null,
          entries: [],
          count: 0,
        });
      }

      const rawEntries = readConversationLogEntries({
        userId,
        conversationId: requestedConversationId,
        limit,
      });
      const entries = rawEntries.map((entry, index) => buildConversationActivityEntry(entry, index));

      return res.json({
        ok: true,
        id: requestedId || legacyHistoryId,
        conversationId: requestedConversationId,
        entries,
        count: entries.length,
      });
    } catch (e) {
      console.error('[A11][History] Activity list error:', e?.message);
      return res.status(500).json({ ok: false, error: 'history_activity_list_failed' });
    }
  });

  return router;
}

module.exports = createA11HistoryRouter;
