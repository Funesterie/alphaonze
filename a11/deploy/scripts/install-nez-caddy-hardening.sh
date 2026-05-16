#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Usage:
  sudo ./install-nez-caddy-hardening.sh a11
  sudo ./install-nez-caddy-hardening.sh kaen44

Copies the prepared Caddy security profile into /etc/caddy/Caddyfile.d when that
directory exists, then validates and reloads Caddy.
USAGE
  exit 0
fi

profile="${1:-}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

case "$profile" in
  a11)
    source_file="$repo_root/deploy/caddy/a11.funesterie.pro.Caddyfile"
    target_file="/etc/caddy/Caddyfile.d/a11.funesterie.pro.Caddyfile"
    ;;
  kaen44)
    source_file="$repo_root/deploy/caddy/kaen44.funesterie.me.Caddyfile"
    target_file="/etc/caddy/Caddyfile.d/kaen44.funesterie.me.Caddyfile"
    ;;
  *)
    echo "Choose profile: a11 or kaen44" >&2
    exit 2
    ;;
esac

if [[ ! -f "$source_file" ]]; then
  echo "Source file not found: $source_file" >&2
  exit 1
fi

if [[ ! -d /etc/caddy/Caddyfile.d ]]; then
  echo "/etc/caddy/Caddyfile.d not found. Copy this block manually into /etc/caddy/Caddyfile:" >&2
  cat "$source_file"
  exit 3
fi

install -m 0644 "$source_file" "$target_file"
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
echo "Caddy hardening installed for $profile: $target_file"
