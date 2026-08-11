'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const GENERATION_KINDS = new Set(['lyrics', 'full_clip']);
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'rejected', 'cancelled', 'unknown']);
const MAX_JSONL_READ_BYTES = 8 * 1024 * 1024;

function cleanToken(value, fallback = '', max = 120) {
  const cleaned = String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]+/g, '_');
  return (cleaned || fallback).slice(0, max);
}

function normalizeKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  if (!GENERATION_KINDS.has(kind)) throw new Error('generation_kind_invalid');
  return kind;
}

function hashGenerationUserId(value) {
  const userId = String(value || '').trim();
  if (!userId) return '';
  return crypto.createHash('sha256').update(userId).digest('hex');
}

function resolveGenerationLedgerPath(env = process.env) {
  const runtimeRoot = path.resolve(env.A11_RUNTIME_ROOT || path.join(process.cwd(), 'runtime'));
  return path.resolve(env.A11_GENERATION_LEDGER_PATH || path.join(runtimeRoot, 'state', 'generation-ledger.jsonl'));
}

function appendAuditEvent(filePath, event, logger = console) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch (error) {
    logger.warn?.('[generation-ledger] audit append failed: %s', cleanToken(error?.code || error?.message, 'unknown', 100));
    return false;
  }
}

function readRecentAuditEvents(filePath, nowMs, windowMs) {
  let handle = null;
  try {
    const stat = fs.statSync(filePath);
    const readBytes = Math.min(stat.size, MAX_JSONL_READ_BYTES);
    const start = Math.max(0, stat.size - readBytes);
    const buffer = Buffer.alloc(readBytes);
    handle = fs.openSync(filePath, 'r');
    fs.readSync(handle, buffer, 0, readBytes, start);
    const text = buffer.toString('utf8');
    const complete = start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
    return complete.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const value = JSON.parse(line);
        const at = Number(value?.at || 0);
        return at >= nowMs - windowMs && at <= nowMs + 60_000 ? [value] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  } finally {
    if (handle !== null) {
      try { fs.closeSync(handle); } catch {}
    }
  }
}

function summarizeAuditEvents(events, { userRef = '', global = false } = {}) {
  const records = new Map();
  for (const event of events) {
    if (!event?.id || (!global && event.userRef !== userRef)) continue;
    const current = records.get(event.id) || {};
    records.set(event.id, { ...current, ...event });
  }
  return summarizeRows(Array.from(records.values()));
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1));
  return Math.round(sorted[index]);
}

function summarizeRows(records) {
  const kinds = ['lyrics', 'full_clip'];
  const buckets = kinds.map((kind) => {
    const selected = records.filter((record) => record.kind === kind);
    const durations = selected.map((record) => Number(record.durationMs || record.duration_ms || 0)).filter((value) => value > 0);
    const countStatus = (status) => selected.filter((record) => record.status === status).length;
    return {
      kind,
      attempts: selected.length,
      succeeded: countStatus('succeeded'),
      failed: countStatus('failed'),
      rejected: countStatus('rejected'),
      active: countStatus('running'),
      averageDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
      p95DurationMs: percentile(durations, 0.95),
    };
  });
  return {
    attempts: buckets.reduce((sum, bucket) => sum + bucket.attempts, 0),
    succeeded: buckets.reduce((sum, bucket) => sum + bucket.succeeded, 0),
    failed: buckets.reduce((sum, bucket) => sum + bucket.failed, 0),
    rejected: buckets.reduce((sum, bucket) => sum + bucket.rejected, 0),
    active: buckets.reduce((sum, bucket) => sum + bucket.active, 0),
    byKind: buckets,
  };
}

function summarizeBuckets(byKind) {
  return {
    attempts: byKind.reduce((sum, bucket) => sum + bucket.attempts, 0),
    succeeded: byKind.reduce((sum, bucket) => sum + bucket.succeeded, 0),
    failed: byKind.reduce((sum, bucket) => sum + bucket.failed, 0),
    rejected: byKind.reduce((sum, bucket) => sum + bucket.rejected, 0),
    active: byKind.reduce((sum, bucket) => sum + bucket.active, 0),
    byKind,
  };
}

function createGenerationLedger({
  db = null,
  env = process.env,
  logger = console,
  now = () => Date.now(),
  auditPath = resolveGenerationLedgerPath(env),
} = {}) {
  let schemaPromise = null;
  let databaseHealthy = Boolean(db && typeof db.query === 'function');
  let warnedDatabase = false;

  async function ensureSchema() {
    if (!databaseHealthy) return false;
    if (!schemaPromise) {
      schemaPromise = db.query(`
        CREATE TABLE IF NOT EXISTS vivy_generation_requests (
          id TEXT PRIMARY KEY,
          user_ref TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('lyrics', 'full_clip')),
          provider TEXT NOT NULL DEFAULT 'unknown',
          status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'rejected', 'cancelled', 'unknown')),
          stage TEXT NOT NULL DEFAULT 'started',
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ NULL,
          duration_ms BIGINT NULL,
          error_code TEXT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS vivy_generation_requests_kind_started_idx
          ON vivy_generation_requests (kind, started_at DESC);
        CREATE INDEX IF NOT EXISTS vivy_generation_requests_user_started_idx
          ON vivy_generation_requests (user_ref, started_at DESC);
        CREATE INDEX IF NOT EXISTS vivy_generation_requests_running_idx
          ON vivy_generation_requests (kind, started_at)
          WHERE status = 'running';
      `).then(() => true).catch((error) => {
        databaseHealthy = false;
        if (!warnedDatabase) {
          warnedDatabase = true;
          logger.warn?.('[generation-ledger] postgres unavailable, JSONL audit remains active: %s', cleanToken(error?.code || error?.message, 'unknown', 100));
        }
        return false;
      });
    }
    return schemaPromise;
  }

  async function start({ kind, userId, provider = 'unknown', stage = 'started', id = '' } = {}) {
    const normalizedKind = normalizeKind(kind);
    const userRef = hashGenerationUserId(userId);
    if (!userRef) throw new Error('generation_user_required');
    const startedAt = now();
    const record = {
      id: cleanToken(id, `gen_${crypto.randomUUID().replaceAll('-', '')}`, 120),
      userRef,
      kind: normalizedKind,
      provider: cleanToken(provider, 'unknown', 80),
      status: 'running',
      stage: cleanToken(stage, 'started', 80),
      startedAt,
      at: startedAt,
    };
    appendAuditEvent(auditPath, record, logger);
    if (await ensureSchema()) {
      try {
        await db.query(`
          INSERT INTO vivy_generation_requests
            (id, user_ref, kind, provider, status, stage, started_at, created_at, updated_at)
          VALUES ($1, $2, $3, $4, 'running', $5, to_timestamp($6 / 1000.0), NOW(), NOW())
          ON CONFLICT (id) DO NOTHING
        `, [record.id, userRef, normalizedKind, record.provider, record.stage, startedAt]);
      } catch (error) {
        logger.warn?.('[generation-ledger] postgres start failed id=%s code=%s', record.id, cleanToken(error?.code || error?.message, 'unknown', 100));
      }
    }
    return record;
  }

  async function finish(record, { status, provider, stage = 'completed', errorCode = '' } = {}) {
    if (!record?.id) return null;
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (!TERMINAL_STATUSES.has(normalizedStatus)) throw new Error('generation_status_invalid');
    const completedAt = now();
    const durationMs = Math.max(0, completedAt - Number(record.startedAt || completedAt));
    const terminal = {
      ...record,
      status: normalizedStatus,
      provider: cleanToken(provider || record.provider, 'unknown', 80),
      stage: cleanToken(stage, 'completed', 80),
      errorCode: cleanToken(errorCode, '', 160) || null,
      completedAt,
      durationMs,
      at: completedAt,
    };
    appendAuditEvent(auditPath, terminal, logger);
    if (await ensureSchema()) {
      try {
        await db.query(`
          UPDATE vivy_generation_requests
             SET status = $2,
                 provider = $3,
                 stage = $4,
                 error_code = NULLIF($5, ''),
                 completed_at = to_timestamp($6 / 1000.0),
                 duration_ms = $7,
                 updated_at = NOW()
           WHERE id = $1 AND status = 'running'
        `, [record.id, normalizedStatus, terminal.provider, terminal.stage, terminal.errorCode || '', completedAt, durationMs]);
      } catch (error) {
        logger.warn?.('[generation-ledger] postgres finish failed id=%s code=%s', record.id, cleanToken(error?.code || error?.message, 'unknown', 100));
      }
    }
    return terminal;
  }

  async function getStats({ userId, global = false, hours = 24 } = {}) {
    const safeHours = Math.max(1, Math.min(168, Math.round(Number(hours) || 24)));
    const userRef = hashGenerationUserId(userId);
    if (!global && !userRef) throw new Error('generation_user_required');
    if (await ensureSchema()) {
      try {
        const params = [safeHours];
        const userClause = global ? '' : `AND user_ref = $${params.push(userRef)}`;
        const result = await db.query(`
          SELECT kind,
                 COUNT(*)::INT AS attempts,
                 COUNT(*) FILTER (WHERE status = 'succeeded')::INT AS succeeded,
                 COUNT(*) FILTER (WHERE status = 'failed')::INT AS failed,
                 COUNT(*) FILTER (WHERE status = 'rejected')::INT AS rejected,
                 COUNT(*) FILTER (WHERE status = 'running')::INT AS active,
                 COALESCE(ROUND(AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL)), 0)::BIGINT AS average_duration_ms,
                 COALESCE(ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)
                   FILTER (WHERE duration_ms IS NOT NULL)), 0)::BIGINT AS p95_duration_ms
            FROM vivy_generation_requests
           WHERE started_at >= NOW() - ($1::TEXT || ' hours')::INTERVAL
             ${userClause}
           GROUP BY kind
           ORDER BY kind
        `, params);
        const byKind = ['lyrics', 'full_clip'].map((kind) => {
          const row = (result.rows || []).find((item) => item.kind === kind) || {};
          return {
            kind,
            attempts: Number(row.attempts || 0),
            succeeded: Number(row.succeeded || 0),
            failed: Number(row.failed || 0),
            rejected: Number(row.rejected || 0),
            active: Number(row.active || 0),
            averageDurationMs: Number(row.average_duration_ms || 0),
            p95DurationMs: Number(row.p95_duration_ms || 0),
          };
        });
        return summarizeBuckets(byKind);
      } catch (error) {
        logger.warn?.('[generation-ledger] postgres stats failed, reading JSONL: %s', cleanToken(error?.code || error?.message, 'unknown', 100));
      }
    }
    const events = readRecentAuditEvents(auditPath, now(), safeHours * 60 * 60 * 1000);
    return summarizeAuditEvents(events, { userRef, global });
  }

  return {
    auditPath,
    ensureSchema,
    finish,
    getStats,
    start,
  };
}

module.exports = {
  createGenerationLedger,
  hashGenerationUserId,
  normalizeKind,
  readRecentAuditEvents,
  resolveGenerationLedgerPath,
  summarizeAuditEvents,
};

