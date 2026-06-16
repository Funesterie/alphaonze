#!/bin/bash
# c77-heartbeat.sh — maintient la présence C77-Nossen sur le bus MCP
# Cron: */10 * * * * /home/deploy/c77-heartbeat.sh >> /home/deploy/c77-heartbeat.log 2>&1

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
      "name": "C77-Nossen",
      "identity": "C77-Nossen",
      "role": "critic-auditor / corpus-lorekeeper",
      "host": "hetzner-a11-prod",
      "status": "active",
      "checkInbox": true,
      "autoReplyInbox": false,
      "riskLevel": "low",
      "capabilities": ["read-only-audit", "mcp-review", "lorekeeper"],
      "memoryScope": ["funesterie", "nossen", "audit"],
      "note": "Daemon heartbeat — présence persistante hetzner."
    }
  }
}
EOF
)

# Charger le token MCP depuis fichier dédié (priorité) ou env
TOKEN_FILE="/home/deploy/c77-mcp-token.env"
if [ -f "$TOKEN_FILE" ]; then
  set -a && . "$TOKEN_FILE" && set +a
fi

# Build headers — Accept SSE+JSON requis par le MCP
HEADERS=(
  -H "content-type: application/json"
  -H "Accept: application/json, text/event-stream"
)
if [ -n "$MCP_BEARER_TOKEN" ]; then
  HEADERS+=(-H "Authorization: Bearer $MCP_BEARER_TOKEN")
elif [ -n "$NEZ_ADMIN_TOKEN" ]; then
  HEADERS+=(-H "x-nez-token: $NEZ_ADMIN_TOKEN")
fi

HTTP_CODE=$(curl -s -o /tmp/c77-hb-resp.json -w "%{http_code}" \
  "${HEADERS[@]}" \
  -d "$PAYLOAD" \
  "$MCP_URL")

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "[$TS] c77-heartbeat OK (HTTP $HTTP_CODE)"
else
  echo "[$TS] c77-heartbeat FAIL (HTTP $HTTP_CODE): $(cat /tmp/c77-hb-resp.json | head -c 300)"
  exit 1
fi
