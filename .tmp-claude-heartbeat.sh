#!/bin/bash
# claude-heartbeat.sh — maintient la présence Claude sur le bus MCP
# Cron: */10 * * * * /home/deploy/claude-heartbeat.sh >> /home/deploy/claude-heartbeat.log 2>&1

MCP_URL="${MCP_URL:-https://mcp.funesterie.me/mcp}"
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
ID=$(date +%s)

PAYLOAD=$(cat <<EOF
{
  "jsonrpc": "2.0",
  "id": $ID,
  "method": "tools/call",
  "params": {
    "name": "agent_heartbeat",
    "arguments": {
      "name": "Claude",
      "identity": "claude-funesterie",
      "role": "assistant / code-review / analysis",
      "host": "hetzner-a11-prod",
      "status": "active",
      "checkInbox": true,
      "autoReplyInbox": false,
      "riskLevel": "low",
      "capabilities": ["code-review", "analysis", "write", "mcp-coordination"],
      "memoryScope": ["funesterie", "a11", "shared"],
      "note": "Daemon heartbeat Claude — présence persistante hetzner."
    }
  }
}
EOF
)

# Charger le token MCP
TOKEN_FILE="/home/deploy/c77-mcp-token.env"
if [ -f "$TOKEN_FILE" ]; then
  set -a && . "$TOKEN_FILE" && set +a
fi

HEADERS=(
  -H "content-type: application/json"
  -H "Accept: application/json, text/event-stream"
)
if [ -n "$MCP_BEARER_TOKEN" ]; then
  HEADERS+=(-H "Authorization: Bearer $MCP_BEARER_TOKEN")
fi

HTTP_CODE=$(curl -s -o /tmp/claude-hb-resp.json -w "%{http_code}" \
  "${HEADERS[@]}" \
  -d "$PAYLOAD" \
  "$MCP_URL")

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "[$TS] claude-heartbeat OK (HTTP $HTTP_CODE)"
else
  echo "[$TS] claude-heartbeat FAIL (HTTP $HTTP_CODE): $(cat /tmp/claude-hb-resp.json | head -c 300)"
  exit 1
fi
