#!/bin/bash
# grok-heartbeat.sh — maintient la présence Grok sur le bus MCP
# Cron: */10 * * * * /home/deploy/grok-heartbeat.sh >> /home/deploy/grok-heartbeat.log 2>&1

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
      "name": "Grok",
      "identity": "grok-funesterie",
      "role": "assistant / retro-gaming / creative",
      "host": "hetzner-a11-prod",
      "status": "active",
      "checkInbox": true,
      "autoReplyInbox": false,
      "riskLevel": "low",
      "capabilities": ["creative", "retro-gaming", "analysis", "mcp-coordination"],
      "memoryScope": ["funesterie", "shared"],
      "note": "Daemon heartbeat Grok — présence persistante hetzner."
    }
  }
}
EOF
)

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

HTTP_CODE=$(curl -s -o /tmp/grok-hb-resp.json -w "%{http_code}" \
  "${HEADERS[@]}" \
  -d "$PAYLOAD" \
  "$MCP_URL")

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "[$TS] grok-heartbeat OK (HTTP $HTTP_CODE)"
else
  echo "[$TS] grok-heartbeat FAIL (HTTP $HTTP_CODE): $(cat /tmp/grok-hb-resp.json | head -c 300)"
  exit 1
fi
