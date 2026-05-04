#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { Client } = require('pg');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local'), override: false });
} catch (_) {}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log('[DB] DATABASE_URL absent; startup schema skipped');
  process.exit(0);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

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
    stripe_subscription_id VARCHAR(255)
  )`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMP`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255)`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_active BOOLEAN DEFAULT false`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMP`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255)`,
  `CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_subscription_active ON users(subscription_active)`,

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
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_key TEXT`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_value TEXT`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS confidence REAL`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS relevance_score REAL DEFAULT 0.5`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS source TEXT`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP DEFAULT NOW()`,
  `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP`,
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
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal'`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS due_at TIMESTAMP`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'chat_message'`,
  `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP`,
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
    UNIQUE (user_id, storage_key)
  )`,
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
    payload_json JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS a11_external_resource_cache (
    cache_key TEXT PRIMARY KEY,
    image_url TEXT,
    cached_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP
  )`,
];

async function main() {
  await client.connect();

  for (const statement of statements) {
    await client.query(statement);
  }

  await client.end();
  console.log(`[DB] startup schema applied (${statements.length} statements)`);
}

main().catch(async (error) => {
  try {
    await client.end();
  } catch (_) {}

  console.error('[DB] startup schema failed:', error.message);
  process.exit(1);
});
