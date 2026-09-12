#!/usr/bin/env bash
# Cerbere : recuperation bornee des backends que Caddy sert REELLEMENT.
#
# Installe sur l'EX44 en /usr/local/sbin/a11-vivy-watchdog (root), lance par
# a11-vivy-watchdog.timer toutes les 60 s. Ce fichier est la source : avant le
# 12/09/2026 le script n'existait que sur le serveur.
#
# Ancienne version (07/08/2026) : soignait blue et green en dur, et redemarrait
# yellow comme « sonde de validation qui ne recoit jamais de trafic ». Depuis la
# topologie quaternion (a11/ops/deploy-a11-prod-finland-2.ps1 -Quaternion), yellow
# et purple sont des couleurs de rotation qui prennent le trafic : l'ancienne
# version ne les soignait pas quand elles etaient actives, et ranimait yellow
# meme arrete expres (constate le 12/09/2026).
#
# La liste des couleurs est lue dans le Caddyfile que le conteneur Caddy CHARGE,
# pas dans `current/Caddyfile` : pendant un deploiement, ou apres un deploiement
# echoue, `current` pointe deja vers une release dont la couleur n'a jamais tourne.
#
# A11_WATCHDOG_DRY=1 : n'agit pas, dit seulement ce qu'il ferait (test sans root).
set -euo pipefail

cooldown=/run/a11-vivy-watchdog.cooldown
dry="${A11_WATCHDOG_DRY:-0}"
log() {
  if [ "$dry" = 1 ]; then echo "[dry] $*"; else logger -t a11-vivy-watchdog -- "$*"; fi
}
healthy() { docker exec "$1" curl -fsS --max-time 5 "http://127.0.0.1:$2/health" >/dev/null 2>&1; }
agir() { if [ "$dry" = 1 ]; then echo "[dry] ferait : $*"; else "$@"; fi; }
toucher_cooldown() { [ "$dry" = 1 ] || touch "$cooldown"; }

if [ "$dry" != 1 ] && [ -e "$cooldown" ] && [ $(( $(date +%s) - $(stat -c %Y "$cooldown") )) -lt 90 ]; then
  exit 0
fi

# Un deploiement detruit puis reconstruit la couleur cible : la redemarrer pendant
# son demarrage ferait echouer le controle de sante du deploiement.
if pgrep -f 'a11-remote-deploy-' >/dev/null 2>&1; then
  log "deploiement en cours, aucune action"
  exit 0
fi

colours="$(docker exec a11-caddy cat /etc/caddy/Caddyfile 2>/dev/null \
  | grep -m1 -E '^[[:space:]]*reverse_proxy .*a11-backend-' \
  | grep -oE 'a11-backend-[a-z]+' | sed 's/^a11-backend-//' | tr '\n' ' ' || true)"
if [ -z "$colours" ]; then
  colours="$(cat /home/deploy/a11-prod/bluegreen/active-color 2>/dev/null || true)"
  log "Caddyfile illisible, repli sur active-color : ${colours:-aucune}"
fi
[ "$dry" = 1 ] && echo "[dry] couleurs servies par Caddy : $colours"

for colour in $colours; do
  for svc in "a11-backend-$colour:3000" "kaen44-backend-$colour:3001"; do
    name="${svc%%:*}"
    port="${svc##*:}"
    # Absent : c'est au deploiement de le creer, pas au watchdog.
    docker inspect "$name" >/dev/null 2>&1 || { log "$name absent, ignore"; continue; }
    if healthy "$name" "$port"; then
      [ "$dry" = 1 ] && echo "[dry] $name sain"
      continue
    fi
    toucher_cooldown
    log "$name malade ; redemarrage cible"
    agir docker restart "$name" >/dev/null
    [ "$dry" = 1 ] && continue
    sleep 12
    if healthy "$name" "$port"; then log "$name retabli"; else log "$name toujours malade apres redemarrage"; fi
  done
done

# Gemma doit etre presente avant de declarer le chemin NOSSEN local repare.
if ! docker exec a11-ollama ollama show gemma4:e4b >/dev/null 2>&1; then
  toucher_cooldown
  log "Gemma 4 absente ; telechargement"
  agir docker exec a11-ollama ollama pull gemma4:e4b >/dev/null
fi
