#!/usr/bin/env bash
set -euo pipefail

STABLE_ENV="${STABLE_ENV:-/srv/a11/secrets/a11.env}"
COMPOSE_ENV="${COMPOSE_ENV:-/srv/a11/secrets/compose.env}"
BACKUP_SUFFIX="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ ! -r "$STABLE_ENV" ]]; then
  echo "Stable environment file is missing or unreadable: $STABLE_ENV" >&2
  exit 1
fi

sudo install -m 600 -o root -g root /dev/null "$COMPOSE_ENV" 2>/dev/null || true
sudo cp -a "$COMPOSE_ENV" "${COMPOSE_ENV}.bak.${BACKUP_SUFFIX}"

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT
sudo cat "$COMPOSE_ENV" > "$TMP_FILE"

is_supported_key() {
  case "$1" in
    *_API_KEY|*_API_TOKEN|*_ACCESS_TOKEN|*_AUTH_TOKEN|*_REFRESH_TOKEN|OPENAI_API_KEY|XAI_API_KEY|TOGETHER_API_KEY|OLLAMA_API_KEY|HUGGINGFACEHUB_API_TOKEN|HUGGINGFACE_HUB_TOKEN|VIVY_SUNO_CALLBACK_TOKEN)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" == *=* ]] || continue

  key="${line%%=*}"
  value="${line#*=}"
  key="$(printf '%s' "$key" | tr -d '[:space:]')"

  [[ "$key" =~ ^[A-Z0-9_]+$ ]] || continue
  [[ -n "${value//[[:space:]]/}" ]] || continue
  is_supported_key "$key" || continue

  # User/site values in compose.env keep priority. Only fill missing or blank entries.
  if grep -qE "^${key}=[^[:space:]].*" "$TMP_FILE"; then
    continue
  fi

  sed -i "/^${key}=/d" "$TMP_FILE"
  printf '%s=%s\n' "$key" "$value" >> "$TMP_FILE"
  echo "Restored stable fallback: $key"
done < <(sudo cat "$STABLE_ENV")

sudo install -m 600 -o root -g root "$TMP_FILE" "$COMPOSE_ENV"

echo "Stable fallback merged into $COMPOSE_ENV"
echo "Existing non-empty site/user values were preserved."
echo "Recreate the backend with the production compose deployment to apply the environment."
