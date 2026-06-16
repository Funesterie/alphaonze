#!/bin/sh
# Patch translation LLM config: local Ollama 3B → Groq 70B
set -e

COMPOSE=/home/deploy/a11-prod/current/server/docker-compose.prod.yml

# Change model
sed -i 's/A11_TRANSLATION_MODEL: llama3\.2:3b/A11_TRANSLATION_MODEL: llama-3.3-70b-versatile/g' "$COMPOSE"

# Add BASE_URL + ALLOW_GENERIC_OPENAI after each TRANSLATION_MODEL line (only if not already present)
if ! grep -q 'A11_TRANSLATION_BASE_URL' "$COMPOSE"; then
  sed -i 's|A11_TRANSLATION_MODEL: llama-3.3-70b-versatile|A11_TRANSLATION_MODEL: llama-3.3-70b-versatile\n      A11_TRANSLATION_BASE_URL: https://api.groq.com/openai/v1\n      A11_TRANSLATION_ALLOW_GENERIC_OPENAI: "1"|g' "$COMPOSE"
fi

echo "Compose patched:"
grep -n 'A11_TRANSLATION' "$COMPOSE"

# Restart backends
docker restart a11-backend-blue a11-backend a11-backend-green
echo "Containers restarted"
