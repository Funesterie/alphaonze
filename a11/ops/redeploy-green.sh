#!/bin/bash
# redeploy-green.sh — Redéploie le container a11-backend-green avec les env vars NOSSEN.
# Usage: ssh deploy@37.27.63.109 'bash /home/deploy/a11-prod/current/server/ops/redeploy-green.sh'
set -euo pipefail

CONTAINER="a11-backend-green"
IMAGE="server-a11-backend-green"
SECRETS="/home/deploy/a11-prod/secrets/a11.env"
COMPOSE_ENV="/home/deploy/a11-prod/secrets/compose.env"
RELEASE_DIR="/home/deploy/a11-prod/current"
NETWORK="server_default"
CLIPS_DIR="/home/deploy/agent-bus/clips"

echo "[redeploy] Vérification des clips en cours..."
if docker exec "$CONTAINER" pgrep -f "ffmpeg.*clips" >/dev/null 2>&1; then
  echo "⚠️  FFmpeg actif dans le container — clip probablement en cours."
  echo "    Attends la fin ou lance avec FORCE=1 pour forcer."
  if [ "${FORCE:-0}" != "1" ]; then
    exit 1
  fi
fi

echo "[redeploy] Arrêt du container actuel..."
docker stop "$CONTAINER" --time 30 || true
docker rm "$CONTAINER" || true

echo "[redeploy] Copie du package mcp-bridge-tunnel dans le contexte release..."
BRIDGE_SRC="/home/deploy/a11-prod/current/server/packages/mcp-bridge-tunnel"
MONOREPO_BRIDGE="/home/deploy/a11-prod/current/packages/mcp-bridge-tunnel"
DEST="/home/deploy/a11-prod/current/server/packages/mcp-bridge-tunnel"
if [ -d "$MONOREPO_BRIDGE" ]; then
  mkdir -p "$DEST"
  cp -r "$MONOREPO_BRIDGE/"* "$DEST/"
  echo "[redeploy] mcp-bridge-tunnel copié dans le contexte Docker"
elif [ -d "$BRIDGE_SRC" ]; then
  echo "[redeploy] mcp-bridge-tunnel déjà dans le contexte"
else
  echo "[redeploy] ⚠️  mcp-bridge-tunnel non trouvé — Zen Gate sera désactivé"
fi

echo "[redeploy] Rebuild de l'image..."
docker build -t "$IMAGE" "$RELEASE_DIR/server/"

echo "[redeploy] Lancement du container avec env-file..."
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --network "$NETWORK" \
  --env-file "$COMPOSE_ENV" \
  --env-file "$SECRETS" \
  -v /home/deploy/a11-data/uploads:/app/runtime/files/uploads:rw \
  -v /home/deploy/a11-data/tts:/data/tts:ro \
  -v /home/deploy/a11-prod/current/web/dist:/web/dist:ro \
  -v /home/deploy/agent-bus:/agent-bus:rw \
  -v /home/deploy/a11-data/logs:/app/logs:rw \
  -v /home/deploy/a11-data/runtime:/app/runtime:rw \
  "$IMAGE" \
  npm run start:a11

echo "[redeploy] Attente du health check..."
sleep 15
if curl -sf http://localhost:3000/health >/dev/null 2>&1 || \
   docker exec "$CONTAINER" curl -sf http://localhost:3000/health >/dev/null 2>&1; then
  echo "✅ Container opérationnel"
else
  echo "⚠️  Health check non confirmé — vérifier les logs"
  docker logs --tail 30 "$CONTAINER"
fi

echo "[redeploy] Variables NOSSEN dans le container:"
docker exec "$CONTAINER" env | grep -iE "NOSSEN_|XAI_API_KEY|MCP_BRIDGE_ENC" | sed 's/=.*/=***/'
echo "[redeploy] Done."
