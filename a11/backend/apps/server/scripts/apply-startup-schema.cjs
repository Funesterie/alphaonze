#!/usr/bin/env node
'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const bcrypt = require('bcrypt');
const { getFullAccessEmails } = require('../src/auth/full-access.cjs');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local'), override: false });
} catch (_) {}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log('[DB] DATABASE_URL absent; startup schema skipped');
  process.exit(0);
}

function resolvePgSslConfig(connectionString = '') {
  const explicit = String(process.env.PGSSLMODE || process.env.DATABASE_SSL_MODE || process.env.DATABASE_SSL || '')
    .trim()
    .toLowerCase();
  if (['disable', 'false', '0', 'off'].includes(explicit)) return false;
  if (['require', 'true', '1', 'on'].includes(explicit)) {
    return { rejectUnauthorized: false };
  }
  try {
    const parsed = new URL(connectionString);
    const host = String(parsed.hostname || '').trim().toLowerCase();
    if (['localhost', '127.0.0.1', 'a11-postgres', 'postgres', 'db'].includes(host)) {
      return false;
    }
  } catch (_) {
    // Ignore URL parsing issues and fall back to the safe remote default.
  }
  return { rejectUnauthorized: false };
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: resolvePgSslConfig(databaseUrl),
});

const STARTUP_SCHEMA_LOCK = "hashtext('funesterie:a11:startup-schema:v1')";

const DEFAULT_ADMIN_USERNAME = String(process.env.DEFAULT_ADMIN_USERNAME || 'Djeff').trim();
const DEFAULT_ADMIN_EMAIL = String(process.env.DEFAULT_ADMIN_EMAIL || 'djeff@a11.local').trim().toLowerCase();
const DEFAULT_ADMIN_PASSWORD = Object.prototype.hasOwnProperty.call(process.env, 'DEFAULT_ADMIN_PASSWORD')
  ? String(process.env.DEFAULT_ADMIN_PASSWORD)
  : '';
const UNSAFE_DEFAULT_ADMIN_PASSWORD = '1991';
const isProductionRuntime = process.env.NODE_ENV === 'production'
  || Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);

const statements = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT UNIQUE,
    role TEXT DEFAULT 'user',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    reset_token TEXT,
    reset_token_expires_at TIMESTAMP,
    stripe_customer_id VARCHAR(255),
    subscription_active BOOLEAN DEFAULT false,
    subscription_end_date TIMESTAMP,
    stripe_subscription_id VARCHAR(255),
    stripe_price_id VARCHAR(255),
    subscription_plan TEXT,
    account_tier TEXT,
    auth_session_version INTEGER DEFAULT 0,
    last_global_logout_at TIMESTAMP
  )`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMP`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_active BOOLEAN DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMP`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_plan TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS account_tier TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_session_version INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_global_logout_at TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription_id ON users(stripe_subscription_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_subscription_active ON users(subscription_active)`,
  `CREATE INDEX IF NOT EXISTS idx_users_subscription_plan ON users(subscription_plan)`,
  `CREATE INDEX IF NOT EXISTS idx_users_account_tier ON users(account_tier)`,

  `CREATE TABLE IF NOT EXISTS auth_sessions (
    session_id TEXT PRIMARY KEY,
    user_key TEXT NOT NULL,
    user_id TEXT,
    email TEXT,
    username TEXT,
    provider TEXT,
    surface TEXT,
    client TEXT,
    session_generation INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    last_seen_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP,
    revoked_at TIMESTAMP,
    request_host TEXT,
    user_agent_hash TEXT,
    ip_hash TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_key ON auth_sessions(user_key, last_seen_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked_at ON auth_sessions(revoked_at)`,

  `CREATE TABLE IF NOT EXISTS files (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    filename TEXT,
    storage_key TEXT UNIQUE,
    content_type TEXT,
    size_bytes INTEGER,
    url TEXT,
    metadata_json JSONB,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
  )`,
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS filename TEXT`,
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS storage_key TEXT`,
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS content_type TEXT`,
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS size_bytes INTEGER`,
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS url TEXT`,
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS metadata_json JSONB`,
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`,
  `ALTER TABLE files ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `UPDATE files SET user_id = 'legacy' WHERE user_id IS NULL OR user_id = ''`,
  `ALTER TABLE files ALTER COLUMN user_id SET DEFAULT 'legacy'`,
  `CREATE INDEX IF NOT EXISTS idx_files_expires_at ON files (expires_at)`,

  `CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    metadata_json JSONB,
    created_at TIMESTAMP DEFAULT NOW()
  )`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_id TEXT`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS role TEXT`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS author TEXT`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS content TEXT`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata_json JSONB`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `UPDATE messages SET user_id = 'legacy' WHERE user_id IS NULL OR user_id = ''`,
  `DO $$ DECLARE column_type TEXT; BEGIN
    SELECT udt_name INTO column_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'messages'
       AND column_name = 'conversation_id';

    IF column_type IN ('text', 'varchar', 'bpchar') THEN
      UPDATE messages
         SET conversation_id = 'legacy'
       WHERE conversation_id IS NULL OR conversation_id = '';
      ALTER TABLE messages ALTER COLUMN conversation_id SET DEFAULT 'legacy';
    ELSE
      ALTER TABLE messages ALTER COLUMN conversation_id DROP DEFAULT;
    END IF;
  END $$`,
  `UPDATE messages SET role = COALESCE(NULLIF(author, ''), 'user') WHERE role IS NULL OR role = ''`,
  `UPDATE messages SET metadata_json = metadata WHERE metadata_json IS NULL AND metadata IS NOT NULL`,
  `ALTER TABLE messages ALTER COLUMN user_id SET DEFAULT 'legacy'`,
  `ALTER TABLE messages ALTER COLUMN role SET DEFAULT 'user'`,
  `CREATE INDEX IF NOT EXISTS idx_messages_user_conversation_created_at
    ON messages (user_id, conversation_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS user_memory (
    user_id TEXT PRIMARY KEY,
    summary TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS user_facts (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    fact_key TEXT NOT NULL,
    fact_value TEXT NOT NULL,
    confidence REAL,
    relevance_score REAL DEFAULT 0.5,
    source TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_seen_at TIMESTAMP DEFAULT NOW(),
    last_used_at TIMESTAMP,
    UNIQUE (user_id, fact_key)
  )`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_key TEXT`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_value TEXT`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS confidence REAL`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS relevance_score REAL DEFAULT 0.5`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS source TEXT`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP`,
  `UPDATE user_facts SET user_id = 'legacy' WHERE user_id IS NULL OR user_id = ''`,
  `UPDATE user_facts SET fact_key = CONCAT('legacy-', id::text) WHERE fact_key IS NULL OR fact_key = ''`,
  `UPDATE user_facts SET fact_value = '' WHERE fact_value IS NULL`,
  `ALTER TABLE user_facts ALTER COLUMN user_id SET DEFAULT 'legacy'`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'user_facts'
        AND constraint_name = 'user_facts_user_id_fact_key_key'
    ) THEN
      ALTER TABLE user_facts ADD CONSTRAINT user_facts_user_id_fact_key_key UNIQUE (user_id, fact_key);
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS idx_user_facts_user_relevance
    ON user_facts (user_id, relevance_score DESC, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_user_facts_user_updated
    ON user_facts (user_id, updated_at DESC)`,

  `CREATE TABLE IF NOT EXISTS user_tasks (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT,
    description TEXT,
    status TEXT DEFAULT 'pending',
    priority TEXT DEFAULT 'normal',
    due_at TIMESTAMP,
    source TEXT DEFAULT 'chat_message',
    closed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS title TEXT`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS description TEXT`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal'`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS due_at TIMESTAMP`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'chat_message'`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP`,
  `UPDATE user_tasks SET user_id = 'legacy' WHERE user_id IS NULL OR user_id = ''`,
  `UPDATE user_tasks SET status = 'pending' WHERE status IS NULL OR status = ''`,
  `ALTER TABLE user_tasks ALTER COLUMN user_id SET DEFAULT 'legacy'`,
  `CREATE INDEX IF NOT EXISTS idx_user_tasks_user_status_updated
    ON user_tasks (user_id, status, updated_at DESC)`,

  `CREATE TABLE IF NOT EXISTS user_files (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    filename TEXT,
    storage_key TEXT UNIQUE,
    content_type TEXT,
    size_bytes INTEGER,
    url TEXT,
    metadata_json JSONB,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, storage_key)
  )`,
  `ALTER TABLE user_files ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE user_files ADD COLUMN IF NOT EXISTS filename TEXT`,
  `ALTER TABLE user_files ADD COLUMN IF NOT EXISTS storage_key TEXT`,
  `ALTER TABLE user_files ADD COLUMN IF NOT EXISTS content_type TEXT`,
  `ALTER TABLE user_files ADD COLUMN IF NOT EXISTS size_bytes INTEGER`,
  `ALTER TABLE user_files ADD COLUMN IF NOT EXISTS url TEXT`,
  `ALTER TABLE user_files ADD COLUMN IF NOT EXISTS metadata_json JSONB`,
  `ALTER TABLE user_files ADD COLUMN IF NOT EXISTS origin TEXT DEFAULT 'upload'`,
  `ALTER TABLE user_files ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`,
  `ALTER TABLE user_files ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE user_files ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
  `UPDATE user_files SET user_id = 'legacy' WHERE user_id IS NULL OR user_id = ''`,
  `ALTER TABLE user_files ALTER COLUMN user_id SET DEFAULT 'legacy'`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'user_files'
        AND constraint_name = 'user_files_user_id_storage_key_key'
    ) THEN
      ALTER TABLE user_files ADD CONSTRAINT user_files_user_id_storage_key_key UNIQUE (user_id, storage_key);
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS idx_user_files_expires_at ON user_files (expires_at)`,

  `CREATE TABLE IF NOT EXISTS conversation_resources (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    resource_kind TEXT NOT NULL DEFAULT 'file',
    origin TEXT DEFAULT 'upload',
    filename TEXT,
    storage_key TEXT UNIQUE,
    url TEXT,
    content_type TEXT,
    size_bytes INTEGER,
    metadata_json JSONB,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, conversation_id, storage_key)
  )`,
  `ALTER TABLE conversation_resources ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE conversation_resources ADD COLUMN IF NOT EXISTS conversation_id TEXT`,
  `ALTER TABLE conversation_resources ADD COLUMN IF NOT EXISTS resource_kind TEXT NOT NULL DEFAULT 'file'`,
  `ALTER TABLE conversation_resources ADD COLUMN IF NOT EXISTS origin TEXT DEFAULT 'upload'`,
  `ALTER TABLE conversation_resources ADD COLUMN IF NOT EXISTS filename TEXT`,
  `ALTER TABLE conversation_resources ADD COLUMN IF NOT EXISTS storage_key TEXT`,
  `ALTER TABLE conversation_resources ADD COLUMN IF NOT EXISTS url TEXT`,
  `ALTER TABLE conversation_resources ADD COLUMN IF NOT EXISTS content_type TEXT`,
  `ALTER TABLE conversation_resources ADD COLUMN IF NOT EXISTS size_bytes INTEGER`,
  `ALTER TABLE conversation_resources ADD COLUMN IF NOT EXISTS metadata_json JSONB`,
  `ALTER TABLE conversation_resources ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`,
  `ALTER TABLE conversation_resources ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE conversation_resources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
  `UPDATE conversation_resources SET user_id = 'legacy' WHERE user_id IS NULL OR user_id = ''`,
  `UPDATE conversation_resources SET conversation_id = 'legacy' WHERE conversation_id IS NULL OR conversation_id = ''`,
  `ALTER TABLE conversation_resources ALTER COLUMN user_id SET DEFAULT 'legacy'`,
  `ALTER TABLE conversation_resources ALTER COLUMN conversation_id SET DEFAULT 'legacy'`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_resources_user_conversation_created
    ON conversation_resources (user_id, conversation_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_resources_user_kind_updated
    ON conversation_resources (user_id, resource_kind, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_conversation_resources_expires_at
    ON conversation_resources (expires_at)`,

  `CREATE TABLE IF NOT EXISTS a11_pending_clarifications (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    conversation_id TEXT,
    original_prompt TEXT,
    clarification_question TEXT,
    status TEXT DEFAULT 'pending',
    kind TEXT NOT NULL DEFAULT 'semantic',
    payload_json JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP,
    resolved_at TIMESTAMP
  )`,
  `ALTER TABLE a11_pending_clarifications ADD COLUMN IF NOT EXISTS user_id TEXT`,
  `ALTER TABLE a11_pending_clarifications ADD COLUMN IF NOT EXISTS conversation_id TEXT`,
  `ALTER TABLE a11_pending_clarifications ADD COLUMN IF NOT EXISTS original_prompt TEXT`,
  `ALTER TABLE a11_pending_clarifications ADD COLUMN IF NOT EXISTS clarification_question TEXT`,
  `ALTER TABLE a11_pending_clarifications ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'`,
  `ALTER TABLE a11_pending_clarifications ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'semantic'`,
  `ALTER TABLE a11_pending_clarifications ADD COLUMN IF NOT EXISTS payload_json JSONB`,
  `ALTER TABLE a11_pending_clarifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE a11_pending_clarifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE a11_pending_clarifications ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`,
  `ALTER TABLE a11_pending_clarifications ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP`,
  `UPDATE a11_pending_clarifications SET user_id = 'legacy' WHERE user_id IS NULL OR user_id = ''`,
  `UPDATE a11_pending_clarifications SET status = 'pending' WHERE status IS NULL OR status = ''`,
  `ALTER TABLE a11_pending_clarifications ALTER COLUMN user_id SET DEFAULT 'legacy'`,
  `CREATE INDEX IF NOT EXISTS idx_a11_pending_clarifications_user_conv_kind
    ON a11_pending_clarifications (user_id, conversation_id, kind, updated_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_a11_pending_clarifications_active
    ON a11_pending_clarifications (user_id, conversation_id, kind)
    WHERE status = 'pending'`,

  `CREATE TABLE IF NOT EXISTS a11_external_resource_cache (
    cache_key TEXT PRIMARY KEY,
    image_url TEXT,
    source_url TEXT,
    storage_key TEXT,
    public_url TEXT,
    filename TEXT,
    content_type TEXT,
    size_bytes INTEGER,
    cached_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_hit_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP
  )`,
  `ALTER TABLE a11_external_resource_cache ADD COLUMN IF NOT EXISTS source_url TEXT`,
  `ALTER TABLE a11_external_resource_cache ADD COLUMN IF NOT EXISTS storage_key TEXT`,
  `ALTER TABLE a11_external_resource_cache ADD COLUMN IF NOT EXISTS public_url TEXT`,
  `ALTER TABLE a11_external_resource_cache ADD COLUMN IF NOT EXISTS filename TEXT`,
  `ALTER TABLE a11_external_resource_cache ADD COLUMN IF NOT EXISTS content_type TEXT`,
  `ALTER TABLE a11_external_resource_cache ADD COLUMN IF NOT EXISTS size_bytes INTEGER`,
  `ALTER TABLE a11_external_resource_cache ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE a11_external_resource_cache ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE a11_external_resource_cache ADD COLUMN IF NOT EXISTS last_hit_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE a11_external_resource_cache ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_a11_external_resource_cache_updated
    ON a11_external_resource_cache (updated_at DESC)`,
];

async function disableUnsafeDefaultAdmin() {
  if (!isProductionRuntime || DEFAULT_ADMIN_PASSWORD) {
    return;
  }

  const { rows } = await client.query(
    `SELECT id, password_hash
       FROM users
      WHERE LOWER(username)=LOWER($1) OR LOWER(email)=LOWER($2)`,
    [DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_EMAIL]
  );

  let disabledCount = 0;

  for (const row of rows) {
    if (!row.password_hash) {
      continue;
    }

    const matchesUnsafeDefault = await bcrypt
      .compare(UNSAFE_DEFAULT_ADMIN_PASSWORD, row.password_hash)
      .catch(() => false);

    if (!matchesUnsafeDefault) {
      continue;
    }

    const lockedPassword = crypto.randomBytes(48).toString('base64url');
    const lockedHash = await bcrypt.hash(lockedPassword, 12);
    await client.query(
      'UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2',
      [lockedHash, row.id]
    );
    disabledCount += 1;
  }

  if (disabledCount > 0) {
    const suffix = disabledCount === 1 ? '' : 's';
    console.log(`[AUTH] unsafe default admin password disabled (${disabledCount} user${suffix})`);
  }
}

async function activateFullAccessAllowlist() {
  const emails = getFullAccessEmails();
  if (!emails.length) return;

  const result = await client.query(
    `UPDATE users
        SET subscription_active=true,
            subscription_end_date=NULL,
            updated_at=NOW()
      WHERE LOWER(email) = ANY($1::text[])`,
    [emails]
  );

  if (result.rowCount > 0) {
    console.log(`[AUTH] full access allowlist activated (${result.rowCount} user${result.rowCount === 1 ? '' : 's'})`);
  }
}

async function main() {
  await client.connect();
  await client.query(`SELECT pg_advisory_lock(${STARTUP_SCHEMA_LOCK})`);

  try {
    for (const statement of statements) {
      await client.query(statement);
    }

    await disableUnsafeDefaultAdmin();
    await activateFullAccessAllowlist();

    console.log(`[DB] startup schema applied (${statements.length} statements)`);
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${STARTUP_SCHEMA_LOCK})`).catch(() => {});
    await client.end();
  }
}

main().catch(async (error) => {
  try {
    await client.end();
  } catch (_) {}

  console.error('[DB] startup schema failed:', error.message);
  process.exit(1);
});
