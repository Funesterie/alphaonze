#!/usr/bin/env node
// Script d'initialisation du schéma PostgreSQL Railway pour A11
const { Client } = require('pg');

const DB_URL = process.env.DATABASE_URL || 
  'postgresql://postgres:KTQeQfOkaNNwMKDYXXfKvmedvMAXqQsh@shuttle.proxy.rlwy.net:35544/railway';

const client = new Client({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false }
});

const tables = [
  {
    name: 'users',
    sql: `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT UNIQUE,
      role TEXT DEFAULT 'user',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      reset_token TEXT,
      reset_token_expires_at TIMESTAMP
    )`
  },
  {
    name: 'messages',
    sql: `CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      metadata_json JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    name: 'idx_messages',
    sql: `CREATE INDEX IF NOT EXISTS idx_messages_user_conversation_created_at 
          ON messages (user_id, conversation_id, created_at DESC)`
  },
  {
    name: 'user_memory',
    sql: `CREATE TABLE IF NOT EXISTS user_memory (
      user_id TEXT PRIMARY KEY,
      summary TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    name: 'files',
    sql: `CREATE TABLE IF NOT EXISTS files (
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
    )`
  },
  {
    name: 'idx_files',
    sql: `CREATE INDEX IF NOT EXISTS idx_files_expires_at ON files (expires_at)`
  },
  {
    name: 'user_facts',
    sql: `CREATE TABLE IF NOT EXISTS user_facts (
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
    )`
  },
  { name: 'migrate_user_facts_fact_key',   sql: `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_key TEXT` },
  { name: 'migrate_user_facts_fact_value', sql: `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS fact_value TEXT` },
  { name: 'migrate_user_facts_confidence', sql: `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS confidence REAL` },
  { name: 'migrate_user_facts_source',     sql: `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS source TEXT` },
  { name: 'migrate_user_facts_last_seen',  sql: `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP DEFAULT NOW()` },
  { name: 'migrate_user_facts_last_used',  sql: `ALTER TABLE user_facts ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP` },
  {
    name: 'idx_user_facts',
    sql: `CREATE INDEX IF NOT EXISTS idx_user_facts_user_relevance 
          ON user_facts (user_id, relevance_score DESC, updated_at DESC)`
  },
  { name: 'idx_user_facts_updated', sql: `CREATE INDEX IF NOT EXISTS idx_user_facts_user_updated ON user_facts (user_id, updated_at DESC)` },
  {
    name: 'user_tasks',
    sql: `CREATE TABLE IF NOT EXISTS user_tasks (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      description TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    name: 'idx_user_tasks',
    sql: `CREATE INDEX IF NOT EXISTS idx_user_tasks_user_status_updated 
          ON user_tasks (user_id, status, updated_at DESC)`
  },
  { name: 'migrate_user_tasks_priority',   sql: `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal'` },
  { name: 'migrate_user_tasks_due_at',     sql: `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS due_at TIMESTAMP` },
  { name: 'migrate_user_tasks_source',     sql: `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'chat_message'` },
  { name: 'migrate_user_tasks_closed_at',  sql: `ALTER TABLE user_tasks ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP` },
  {
    name: 'user_files',
    sql: `CREATE TABLE IF NOT EXISTS user_files (
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
    )`
  },
  {
    name: 'idx_user_files',
    sql: `CREATE INDEX IF NOT EXISTS idx_user_files_expires_at ON user_files (expires_at)`
  },
  {
    name: 'conversation_resources',
    sql: `CREATE TABLE IF NOT EXISTS conversation_resources (
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
    )`
  },
  {
    name: 'idx_conv_resources_1',
    sql: `CREATE INDEX IF NOT EXISTS idx_conversation_resources_user_conversation_created 
          ON conversation_resources (user_id, conversation_id, created_at DESC)`
  },
  {
    name: 'idx_conv_resources_2',
    sql: `CREATE INDEX IF NOT EXISTS idx_conversation_resources_user_kind_updated 
          ON conversation_resources (user_id, resource_kind, updated_at DESC)`
  },
  {
    name: 'idx_conv_resources_3',
    sql: `CREATE INDEX IF NOT EXISTS idx_conversation_resources_expires_at 
          ON conversation_resources (expires_at)`
  },
  {
    name: 'a11_pending_clarifications',
    sql: `CREATE TABLE IF NOT EXISTS a11_pending_clarifications (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      conversation_id TEXT,
      original_prompt TEXT,
      clarification_question TEXT,
      status TEXT DEFAULT 'pending',
      payload_json JSONB,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  },
  {
    name: 'a11_external_resource_cache',
    sql: `CREATE TABLE IF NOT EXISTS a11_external_resource_cache (
      cache_key TEXT PRIMARY KEY,
      image_url TEXT,
      cached_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP
    )`
  }
];

async function run() {
  console.log('\n=== Initialisation du schéma PostgreSQL Railway pour A11 ===\n');
  
  await client.connect();
  console.log('✓ Connecté à PostgreSQL Railway\n');

  let ok = 0;
  let skip = 0;
  
  for (const table of tables) {
    try {
      await client.query(table.sql);
      const isIndex = table.name.startsWith('idx_');
      console.log(`✓ ${isIndex ? 'Index' : 'Table'}: ${table.name}`);
      ok++;
    } catch(e) {
      if (e.message.includes('already exists')) {
        console.log(`  ${table.name}: déjà existant`);
        skip++;
      } else {
        console.log(`✗ ${table.name}: ${e.message.slice(0, 100)}`);
      }
    }
  }

  // Créer l'admin par défaut si la table users est vide
  try {
    const count = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(count.rows[0].count) === 0) {
      const bcrypt = require('bcrypt');
      const hash = await bcrypt.hash('1991', 10);
      await client.query(
        'INSERT INTO users (username, password_hash, email, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        ['Djeff', hash, 'djeff@a11.local', 'admin']
      );
      console.log('\n✓ Admin créé: Djeff / 1991');
    } else {
      console.log('\n  Admin: déjà existant');
    }
  } catch(e) {
    console.log('\n⚠ Admin:', e.message.slice(0, 80));
  }

  console.log(`\n=== Terminé: ${ok} créés, ${skip} ignorés ===\n`);
  await client.end();
}

run().catch(e => {
  console.error('Fatal:', e.message);
  client.end();
  process.exit(1);
});
