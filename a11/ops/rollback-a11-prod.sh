#!/usr/bin/env bash
# rollback-a11-prod.sh -- remet une couleur de repli en tete de Caddy, sans deployer.
#
# Usage (Git Bash, depuis D:\projets\funesterie) :
#   tr -d '\r' < a11/ops/rollback-a11-prod.sh | ssh -o IdentitiesOnly=yes -o BatchMode=yes \
#     -i ~/.ssh/codex-a11-hetzner-20260627_ed25519 deploy@37.27.63.109 'bash -s -- [couleur] [--apply]'
#
# Usage (PowerShell -- `<` n'y existe pas, « ParserError » le 12/09/2026) :
#   (Get-Content -Raw a11/ops/rollback-a11-prod.sh) -replace "`r", "" | ssh -o IdentitiesOnly=yes -o BatchMode=yes `
#     -i $HOME/.ssh/codex-a11-hetzner-20260627_ed25519 deploy@37.27.63.109 'bash -s -- [couleur] [--apply]'
#
# Jamais pendant un deploiement en cours : il reecrit le Caddyfile a la fin.
#
# Sans --apply : simulation, affiche le diff du Caddyfile et ne touche a rien.
# Sans couleur : prend le repli immediat, c'est-a-dire la deuxieme couleur du Caddyfile.
#
# Pourquoi un script : Caddy ne lit JAMAIS bluegreen/active-color. L'ordre des
# upstreams est ecrit dans releases/<stamp>/Caddyfile par le script de deploiement,
# couleur deployee en tete (`lb_policy first`). Ecrire active-color puis recreer
# Caddy relit le meme fichier et ne change rien -- c'etait pourtant la procedure
# notee jusqu'au 12/09/2026.
#
# Deux pieges evites :
# - le Caddyfile est monte comme FICHIER : `sed -i` ou `mv` creent un nouvel inode
#   que le conteneur ne voit pas. On reecrit le contenu en place (`cat >`), et on
#   verifie que Caddy lit bien la nouvelle version.
# - on valide la config avant `caddy reload`, et on restaure le fichier si elle
#   est refusee.
#
# Ce que ce rollback NE fait PAS : les workers (vivy-twitch-worker,
# vivy-social-ingest-worker, funesterie-evidence-monitor) restent sur l'image du
# dernier deploiement. Ils ne passent pas par Caddy.
set -euo pipefail

root=/home/deploy/a11-prod
caddyfile="$root/current/Caddyfile"
target=""
apply=0
for arg in "$@"; do
  case "$arg" in
    --apply) apply=1 ;;
    blue|green|yellow|purple) target="$arg" ;;
    *) echo "argument inconnu : $arg (attendu : blue|green|yellow|purple et/ou --apply)" >&2; exit 2 ;;
  esac
done

ordre="$(grep -m1 -E '^[[:space:]]*reverse_proxy .*a11-backend-' "$caddyfile" | grep -oE 'a11-backend-[a-z]+' | sed 's/^a11-backend-//' | tr '\n' ' ' || true)"
# shellcheck disable=SC2086
set -- $ordre
tete="${1:-}"
[ -n "$target" ] || target="${2:-}"
active="$(cat "$root/bluegreen/active-color" 2>/dev/null || echo '?')"

echo "release courante : $(basename "$(readlink -f "$root/current")")"
echo "ordre Caddy      : $ordre"
echo "active-color     : $active"

if [ -z "$target" ]; then
  echo "aucune couleur de repli dans le Caddyfile : en preciser une" >&2
  exit 3
fi
if [ "$target" = "$tete" ]; then
  echo "$target est deja en tete de Caddy : rien a faire"
  exit 0
fi

for svc in "a11-backend-$target:3000" "kaen44-backend-$target:3001"; do
  name="${svc%%:*}"
  port="${svc##*:}"
  if ! docker exec "$name" curl -fsS -m 5 "http://127.0.0.1:$port/health" >/dev/null 2>&1; then
    echo "$name ne repond pas sur /health : rollback refuse" >&2
    exit 4
  fi
done
build_json="$(docker exec "a11-backend-$target" curl -fsS -m 5 http://127.0.0.1:3000/api/build 2>/dev/null || true)"
target_commit="$(printf '%s' "$build_json" | sed -n 's/.*"commit":"\([0-9a-f]\{7,40\}\)".*/\1/p')"
echo "cible            : $target (commit ${target_commit:-inconnu}), sante OK"

nouveau="$(mktemp)"
trap 'rm -f "$nouveau"' EXIT
# Chaque ligne `reverse_proxy` d'un backend : la cible passe en tete, les autres
# gardent leur ordre. Une cible absente de la liste y est ajoutee.
awk -v t="$target" '
  /^[[:space:]]*reverse_proxy / && /-backend-/ {
    indent = $0; sub(/reverse_proxy.*/, "", indent)
    cible = ""; reste = ""; fin = ""
    for (i = 2; i <= NF; i++) {
      if ($i == "{") { fin = " {"; continue }
      if ($i ~ /^(a11|kaen44)-backend-[a-z]+:[0-9]+$/) {
        split($i, p, ":")
        base = p[1]; sub(/-[a-z]+$/, "", base)
        cible = base "-" t ":" p[2]
        if ($i != cible) reste = reste " " $i
      } else {
        reste = reste " " $i
      }
    }
    print indent "reverse_proxy " cible reste fin
    next
  }
  { print }
' "$caddyfile" > "$nouveau"

if cmp -s "$caddyfile" "$nouveau"; then
  echo "le Caddyfile ne change pas : rien a faire"
  exit 0
fi
diff -u "$caddyfile" "$nouveau" || true

if [ "$apply" != 1 ]; then
  echo
  echo "simulation seulement : relancer avec --apply pour basculer sur $target"
  exit 0
fi

sauvegarde="$(readlink -f "$caddyfile").avant-rollback-$(date +%Y%m%d-%H%M%S)"
cp -p "$caddyfile" "$sauvegarde"
cat "$nouveau" > "$caddyfile"

restaurer() {
  cat "$sauvegarde" > "$caddyfile"
  echo "$1 -- Caddyfile restaure, rien n'a bascule" >&2
  exit 5
}
if ! docker exec a11-caddy grep -qE "reverse_proxy a11-backend-$target:3000" /etc/caddy/Caddyfile; then
  restaurer "le conteneur Caddy ne voit pas le fichier modifie"
fi
if ! docker exec a11-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  restaurer "Caddyfile refuse par caddy validate"
fi
docker exec a11-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

if [ -n "$target_commit" ]; then
  ok=0
  for _ in $(seq 1 20); do
    vu="$(curl -fsS -m 5 -H 'Host: a11.funesterie.me' http://127.0.0.1/api/build 2>/dev/null | sed -n 's/.*"commit":"\([0-9a-f]\{7,40\}\)".*/\1/p' || true)"
    if [ "$vu" = "$target_commit" ]; then ok=1; break; fi
    sleep 1
  done
  if [ "$ok" != 1 ]; then
    echo "AVERTISSEMENT : Caddy recharge mais /api/build ne renvoie pas encore $target_commit" >&2
  fi
fi

echo "$target" > "$root/bluegreen/active-color"
echo "bascule faite : $target en tete, active-color=$target (sauvegarde : $sauvegarde)"
echo "pour annuler : meme commande avec '$tete --apply'"
