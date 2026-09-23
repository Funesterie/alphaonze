-- Refresh tokens durables pour le MCP OAuth de ChatGPT (rotation + fenetre glissante).
-- Seule l'empreinte SHA-256 est stockee, jamais le token en clair.
CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  scope TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_oauth_refresh_tokens_last_used
  ON mcp_oauth_refresh_tokens(last_used_at);
