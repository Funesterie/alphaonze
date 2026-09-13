#!/usr/bin/env bash
# Grosse sauvegarde manuelle de l'EX44, lancee depuis le compte deploy.
#
# Pourquoi elle existe (13/09/2026) : la sauvegarde Neo4j quotidienne produit bien
# son dump natif, mais l'envoi vers la Storage Box echoue depuis au moins le 07/09
# (« Permission denied » : la cle SFTP est celle de root, la tache tourne sous
# deploy), et le staging est vide apres chaque echec. Il n'existait donc AUCUNE
# copie restaurable de Neo4j, ni de Postgres ou du runtime hors du serveur.
#
# Contenu, dans /home/deploy/a11-data/backups/full-<horodatage>/ (mode 0700) :
#   postgres-globals.sql, postgres-<base>.dump  pg_dumpall --globals-only + pg_dump -Fc
#   neo4j.dump                                   dump natif (seul format restaurable
#                                                fidelement) : Neo4j arrete quelques
#                                                secondes, redemarre meme en cas d'echec
#   donnees.tar.zst                              a11-data (runtime, uploads, voix...),
#                                                secrets, reglages de sauvegarde
#   config/                                      compose et Caddyfile de la release
#                                                active, couleur active, crontab
#   SHA256SUMS, VERIFICATION.txt                 empreintes et controles de lecture
#
# Exclus, car reconstructibles ou deja couverts : donnees brutes de Postgres
# (le dump les remplace), modeles STT/XTTS, sorties XTTS, staging de sauvegarde et
# les sauvegardes precedentes. Les secrets sont INCLUS : ne jamais publier ce dossier.
set -euo pipefail

STAMP=$(date +%Y%m%d-%H%M)
DATA=/home/deploy/a11-data
PROD=/home/deploy/a11-prod
OUT=$DATA/backups/full-$STAMP
NEO4J=a11-neo4j
PG=a11-postgres

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

mkdir -p "$OUT/config"
chmod 700 "$OUT"
cd "$OUT"
log "sauvegarde dans $OUT"

# 1. Postgres, a chaud.
log "postgres"
docker exec "$PG" sh -c 'pg_dumpall -U "${POSTGRES_USER:-postgres}" --globals-only' > postgres-globals.sql
for base in $(docker exec "$PG" sh -c 'psql -U "${POSTGRES_USER:-postgres}" -Atc "select datname from pg_database where not datistemplate"'); do
  [[ "$base" =~ ^[A-Za-z0-9_-]+$ ]] || { log "base ignoree (nom inattendu)"; continue; }
  docker exec "$PG" sh -c "pg_dump -U \"\${POSTGRES_USER:-postgres}\" -Fc \"$base\"" > "postgres-$base.dump"
done

# 2. Neo4j, dump natif : arret bref du seul conteneur Neo4j, redemarrage garanti.
log "neo4j (arret de quelques secondes)"
IMAGE=$(docker inspect -f '{{.Config.Image}}' "$NEO4J")
VOLUME=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$NEO4J")
[ -n "$VOLUME" ] || { log "volume /data de Neo4j introuvable"; exit 1; }
redemarrer() { docker start "$NEO4J" >/dev/null 2>&1 || true; }
trap redemarrer EXIT
docker stop "$NEO4J" >/dev/null
docker run --rm --user 0 --entrypoint neo4j-admin -v "$VOLUME":/data -v "$OUT":/backups "$IMAGE" \
  database dump neo4j --to-path=/backups --overwrite-destination=true
redemarrer
trap - EXIT
for _ in $(seq 1 60); do
  docker exec "$NEO4J" sh -c 'cypher-shell -u neo4j -p "${NEO4J_AUTH#neo4j/}" "RETURN 1" >/dev/null 2>&1' && break
  sleep 2
done
log "neo4j de nouveau disponible"

# 3. Configuration de la release active.
log "configuration"
cp "$PROD/bluegreen/active-color" config/ 2>/dev/null || true
readlink "$PROD/current" > config/release-active.txt
cp "$PROD/current/server/docker-compose.prod.yml" config/ 2>/dev/null || true
cp "$PROD/current/Caddyfile" config/ 2>/dev/null || true
crontab -l > config/crontab-deploy.txt 2>/dev/null || true

# 4. Donnees : un conteneur jetable lit aussi les fichiers de root.
log "donnees (runtime, uploads, voix, secrets)"
docker run --rm \
  -v "$DATA":/src/a11-data:ro \
  -v "$PROD/secrets":/src/secrets:ro \
  -v /home/deploy/a11-backup:/src/a11-backup:ro \
  alpine:latest tar -C /src -cf - \
    --exclude=a11-data/backups \
    --exclude=a11-data/postgres \
    --exclude=a11-data/stt \
    --exclude=a11-data/xtts-rvc/models \
    --exclude=a11-data/xtts-rvc/outputs \
    --exclude=a11-data/runtime/backup-staging \
    a11-data secrets a11-backup \
  | zstd -T0 -3 -q -o donnees.tar.zst

# 5. Controles.
log "controles"
{
  echo "sauvegarde $STAMP"
  echo "release: $(cat config/release-active.txt)  couleur: $(cat config/active-color 2>/dev/null)"
  for f in postgres-*.dump; do echo "$f: $(docker run --rm -i postgres:16-alpine pg_restore -l < "$f" | grep -c ';') entrees"; done
  echo "neo4j.dump: $(stat -c %s neo4j.dump) octets"
  zstd -tq donnees.tar.zst && echo "donnees.tar.zst: archive lisible"
  echo "donnees.tar.zst: $(zstd -dc donnees.tar.zst | tar -tf - | wc -l) fichiers"
} > VERIFICATION.txt
sha256sum postgres-* neo4j.dump donnees.tar.zst config/* > SHA256SUMS
cat VERIFICATION.txt
du -sh "$OUT"
log "termine"
