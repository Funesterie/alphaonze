-- Central Funesterie OAuth sessions: current-session revocation and logout-all.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_session_version INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_global_logout_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS auth_sessions (
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
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_key
  ON auth_sessions(user_key, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked_at
  ON auth_sessions(revoked_at);
