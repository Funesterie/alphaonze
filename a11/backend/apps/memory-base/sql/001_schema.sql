CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memory_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  account_label text NOT NULL DEFAULT 'default',
  source_label text NOT NULL,
  source_path text,
  source_hash text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES memory_sources(id) ON DELETE CASCADE,
  provider text NOT NULL,
  account_label text NOT NULL DEFAULT 'default',
  external_id text NOT NULL,
  title text NOT NULL DEFAULT 'Untitled conversation',
  created_at timestamptz,
  updated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES memory_sources(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  ordinal integer NOT NULL DEFAULT 0,
  role text NOT NULL DEFAULT 'unknown',
  author text,
  content text NOT NULL,
  content_hash text NOT NULL,
  redactions_count integer NOT NULL DEFAULT 0,
  created_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, external_id)
);

CREATE TABLE IF NOT EXISTS memory_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES memory_sources(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL DEFAULT 0,
  role text NOT NULL DEFAULT 'unknown',
  content text NOT NULL,
  content_hash text NOT NULL UNIQUE,
  token_estimate integer NOT NULL DEFAULT 0,
  embedding vector,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  account_label text NOT NULL DEFAULT 'default',
  input_path text,
  status text NOT NULL DEFAULT 'running',
  files_seen integer NOT NULL DEFAULT 0,
  conversations_seen integer NOT NULL DEFAULT 0,
  messages_seen integer NOT NULL DEFAULT 0,
  chunks_seen integer NOT NULL DEFAULT 0,
  redactions_seen integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_conversations_provider_account
  ON conversations(provider, account_label);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_ordinal
  ON messages(conversation_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_messages_role
  ON messages(role);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_conversation
  ON memory_chunks(conversation_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_fts
  ON memory_chunks USING gin (to_tsvector('simple', content));

CREATE OR REPLACE VIEW memory_search AS
SELECT
  mc.id AS chunk_id,
  mc.content,
  mc.role,
  mc.token_estimate,
  m.created_at AS message_created_at,
  c.id AS conversation_id,
  c.title AS conversation_title,
  c.provider,
  c.account_label,
  s.source_label,
  s.source_path
FROM memory_chunks mc
JOIN conversations c ON c.id = mc.conversation_id
JOIN memory_sources s ON s.id = mc.source_id
LEFT JOIN messages m ON m.id = mc.message_id;
