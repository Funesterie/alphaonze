#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const path = require('node:path');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
  require('dotenv').config({ path: path.resolve(__dirname, '..', '../../.env') });
} catch {
  // dotenv is best-effort for local runs.
}

const {
  ingestSoundCloudRssFeed,
  ingestYoutubeAccount,
  listSocialAccounts,
  ensureSocialSchema,
} = require('../src/social/social-autoprompt.cjs');

function flag(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function intEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function resolvePgSslConfig(connectionString = '') {
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) return undefined;
  if (/(?:localhost|127\.0\.0\.1|::1|a11-postgres|postgres)(?::|\/|$)/i.test(connectionString)) return undefined;
  if (flag('PGSSLMODE_DISABLE', false)) return false;
  return { rejectUnauthorized: false };
}

function createPool() {
  const connectionString = process.env.DATABASE_URL || process.env.PGURL || '';
  if (!connectionString) throw new Error('DATABASE_URL missing for social ingest worker');
  return new Pool({ connectionString, ssl: resolvePgSslConfig(connectionString) });
}

async function runOnce(db) {
  await ensureSocialSchema(db);
  const userId = Object.prototype.hasOwnProperty.call(process.env, 'SOCIAL_CONTEXT_USER_ID')
    ? process.env.SOCIAL_CONTEXT_USER_ID
    : (process.env.VIVY_STREAM_SOCIAL_CONTEXT_USER_ID || '');
  const safeUserId = userId || 'admin';
  const accounts = await listSocialAccounts(db, { userId });
  const youtubeAccounts = accounts.filter((account) => account.provider === 'youtube' && !account.paused && !account.reconnectRequired);
  const results = [];
  for (const account of youtubeAccounts) {
    try {
      const result = await ingestYoutubeAccount(db, {
        userId: account.userId,
        limit: intEnv('SOCIAL_YOUTUBE_INGEST_LIMIT', 12, 1, 50),
      });
      results.push({ userId: account.userId, provider: 'youtube', ok: result.ok === true, result });
      console.log('[social-ingest] youtube user=%s ok=%s items=%s', account.userId, result.ok === true ? 'true' : 'false', result.items || 0);
    } catch (error) {
      results.push({ userId: account.userId, provider: 'youtube', ok: false, error: String(error?.message || error) });
      console.warn('[social-ingest] youtube user=%s error=%s', account.userId, String(error?.message || error));
    }
  }
  if (!youtubeAccounts.length) console.log('[social-ingest] no active YouTube account');
  const soundCloudRssUrl = String(process.env.SOCIAL_SOUNDCLOUD_RSS_URL || process.env.SOUNDCLOUD_RSS_URL || '').trim();
  if (soundCloudRssUrl) {
    try {
      const result = await ingestSoundCloudRssFeed(db, {
        userId: safeUserId,
        limit: intEnv('SOCIAL_SOUNDCLOUD_RSS_INGEST_LIMIT', 12, 1, 50),
      });
      results.push({ userId: safeUserId, provider: 'soundcloud_rss', ok: result.ok === true, result });
      console.log('[social-ingest] soundcloud_rss user=%s ok=%s items=%s', safeUserId, result.ok === true ? 'true' : 'false', result.items || 0);
    } catch (error) {
      results.push({ userId: safeUserId, provider: 'soundcloud_rss', ok: false, error: String(error?.message || error) });
      console.warn('[social-ingest] soundcloud_rss user=%s error=%s', safeUserId, String(error?.message || error));
    }
  }
  return results;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const loop = args.has('--loop') || (!args.has('--once') && flag('SOCIAL_INGEST_WORKER_ENABLED', false));
  const db = createPool();
  try {
    do {
      await runOnce(db);
      if (!loop) break;
      const delayMs = intEnv('SOCIAL_INGEST_INTERVAL_MS', 30 * 60 * 1000, 30 * 60 * 1000, 24 * 60 * 60 * 1000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } while (loop);
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error('[social-ingest] fatal:', error);
  process.exitCode = 1;
});
