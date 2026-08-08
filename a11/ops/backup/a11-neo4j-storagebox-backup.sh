#!/usr/bin/env bash
set -euo pipefail

# Safe by default: without --apply this script only prints and validates the
# intended plan. Restic provides client-side authenticated encryption; raw
# graph exports never leave the 0700 staging directory unencrypted in transit.

mode=dry-run
if [[ "${1:-}" == "--apply" ]]; then
  mode=apply
elif [[ -n "${1:-}" && "${1:-}" != "--dry-run" ]]; then
  printf 'usage: %s [--dry-run|--apply]\n' "$0" >&2
  exit 64
fi

backend_container="${A11_BACKUP_BACKEND_CONTAINER:-}"
neo4j_container="${A11_BACKUP_NEO4J_CONTAINER:-a11-neo4j}"
neo4j_database="${A11_BACKUP_NEO4J_DATABASE:-neo4j}"
native_dump_mode="${A11_BACKUP_NATIVE_DUMP_MODE:-required}"
verify_restore="${A11_BACKUP_VERIFY_RESTORE:-1}"
active_color_file="${A11_BACKUP_ACTIVE_COLOR_FILE:-/home/deploy/a11-prod/bluegreen/active-color}"
host_staging_root="${A11_BACKUP_HOST_STAGING_ROOT:-/home/deploy/a11-data/runtime/backup-staging/neo4j-storagebox}"
container_staging_root="${A11_BACKUP_CONTAINER_STAGING_ROOT:-/app/runtime/backup-staging/neo4j-storagebox}"
keep_daily="${A11_BACKUP_KEEP_DAILY:-14}"
keep_weekly="${A11_BACKUP_KEEP_WEEKLY:-8}"
keep_monthly="${A11_BACKUP_KEEP_MONTHLY:-12}"
max_source_bytes="${A11_BACKUP_MAX_SOURCE_BYTES:-40000000000}"
check_subset="${A11_BACKUP_CHECK_SUBSET:-1/200}"
restic_mode="${A11_BACKUP_RESTIC_MODE:-host}"
restic_image="${A11_BACKUP_RESTIC_IMAGE:-docker.io/restic/restic:0.18.0}"
restic_ssh_dir="${A11_BACKUP_RESTIC_SSH_DIR:-/root/.ssh}"
restic_cache_volume="${A11_BACKUP_RESTIC_CACHE_VOLUME:-a11-restic-cache}"

[[ "$neo4j_database" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || {
  printf 'unsafe Neo4j database name: %s\n' "$neo4j_database" >&2
  exit 64
}

case "$native_dump_mode" in
  required|disabled) ;;
  *) printf 'A11_BACKUP_NATIVE_DUMP_MODE must be required or disabled\n' >&2; exit 64 ;;
esac
case "$verify_restore" in
  0|1) ;;
  *) printf 'A11_BACKUP_VERIFY_RESTORE must be 0 or 1\n' >&2; exit 64 ;;
esac
case "$restic_mode" in
  host|docker) ;;
  *) printf 'A11_BACKUP_RESTIC_MODE must be host or docker\n' >&2; exit 64 ;;
esac

resolve_backend_container() {
  if [[ -n "$backend_container" ]]; then
    docker inspect "$backend_container" >/dev/null 2>&1 || {
      printf 'configured backend container not found: %s\n' "$backend_container" >&2
      return 1
    }
    printf '%s' "$backend_container"
    return 0
  fi

  local active_color=''
  if [[ -r "$active_color_file" ]]; then
    active_color="$(tr -d '[:space:]' <"$active_color_file" | tr '[:upper:]' '[:lower:]')"
  fi
  local candidates=()
  case "$active_color" in
    blue|green) candidates+=("a11-backend-$active_color" "kaen44-backend-$active_color") ;;
  esac
  candidates+=(a11-backend kaen44-backend)
  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ "$(docker inspect "$candidate" --format '{{.State.Running}}' 2>/dev/null || true)" == true ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  printf 'no running backend matches active color %s\n' "${active_color:-unknown}" >&2
  return 1
}

wait_for_source_neo4j() {
  local ready=0
  local attempt
  for attempt in $(seq 1 90); do
    if docker exec -e A11_PROBE_DATABASE="$neo4j_database" "$neo4j_container" sh -lc '
      shell=/var/lib/neo4j/bin/cypher-shell
      auth="${NEO4J_AUTH:-none}"
      if [ "$auth" = none ]; then
        "$shell" --database "$A11_PROBE_DATABASE" "RETURN 1 AS ready" >/dev/null 2>&1
      else
        user="${auth%%/*}"
        password="${auth#*/}"
        "$shell" -u "$user" -p "$password" --database "$A11_PROBE_DATABASE" "RETURN 1 AS ready" >/dev/null 2>&1
      fi
    ' >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 2
  done
  [[ "$ready" == 1 ]]
}

host_staging_root="$(realpath -m -- "$host_staging_root")"
case "$host_staging_root" in
  /|/home|/home/deploy|/home/deploy/a11-data|/home/deploy/a11-data/runtime)
    printf 'refusing broad staging root: %s\n' "$host_staging_root" >&2
    exit 64
    ;;
esac

default_artifacts=(
  /home/deploy/a11-data/runtime/knowledge-graph
  /home/deploy/a11-data/runtime/episodic-memory
  /home/deploy/a11-prod/bluegreen
)

artifacts=()
if [[ -n "${A11_BACKUP_ARTIFACT_PATHS:-}" ]]; then
  IFS=':' read -r -a requested_artifacts <<<"${A11_BACKUP_ARTIFACT_PATHS}"
else
  requested_artifacts=("${default_artifacts[@]}")
fi
for candidate in "${requested_artifacts[@]}"; do
  [[ -e "$candidate" ]] && artifacts+=("$candidate")
done

command -v docker >/dev/null || { printf 'docker is required\n' >&2; exit 1; }
backend_container="$(resolve_backend_container)"
[[ "$(docker inspect "$neo4j_container" --format '{{.State.Running}}' 2>/dev/null || true)" == true ]] || {
  printf 'Neo4j container not found: %s\n' "$neo4j_container" >&2
  exit 1
}
docker exec "$backend_container" test -r /app/scripts/a11-memory-router.cjs || {
  printf 'backup command is absent from active backend: %s\n' "$backend_container" >&2
  exit 1
}
docker exec "$backend_container" grep -q backup-storagebox /app/scripts/a11-memory-router.cjs || {
  printf 'active backend does not contain the backup-storagebox command: %s\n' "$backend_container" >&2
  exit 1
}

runtime_source_raw="$(docker inspect "$backend_container" --format '{{range .Mounts}}{{if eq .Destination "/app/runtime"}}{{.Source}}{{end}}{{end}}')"
[[ -n "$runtime_source_raw" ]] || {
  printf 'active backend has no /app/runtime bind mount: %s\n' "$backend_container" >&2
  exit 1
}
runtime_source="$(realpath -m -- "$runtime_source_raw")"
host_relative="${host_staging_root#"$runtime_source"/}"
container_relative="${container_staging_root#/app/runtime/}"
if [[ -z "$runtime_source" \
   || "$host_relative" == "$host_staging_root" \
   || "$container_relative" == "$container_staging_root" \
   || "$host_relative" != "$container_relative" ]]; then
  printf 'staging mapping mismatch host=%s container=%s runtime-source=%s\n' \
    "$host_staging_root" "$container_staging_root" "$runtime_source" >&2
  exit 1
fi

neo4j_image_label="$(docker inspect "$neo4j_container" --format '{{.Config.Image}}')"
neo4j_image_id="$(docker inspect "$neo4j_container" --format '{{.Image}}')"
neo4j_data_volume="$(docker inspect "$neo4j_container" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}')"
[[ -n "$neo4j_image_id" && -n "$neo4j_data_volume" ]] || {
  printf 'cannot resolve immutable Neo4j image or /data volume\n' >&2
  exit 1
}

printf 'mode=%s\n' "$mode"
printf 'neo4j_export=local graph from container %s\n' "$backend_container"
printf 'native_dump=%s database=%s verify_restore=%s\n' "$native_dump_mode" "$neo4j_database" "$verify_restore"
printf 'staging_host=%s\n' "$host_staging_root"
printf 'retention=daily:%s weekly:%s monthly:%s\n' "$keep_daily" "$keep_weekly" "$keep_monthly"
printf 'source_guard_bytes=%s\n' "$max_source_bytes"
printf 'artifact_paths=%s\n' "${artifacts[*]:-(none found)}"

if [[ "$mode" == "dry-run" ]]; then
  printf '%s\n' 'dry-run complete: no directory, graph export, Restic connection, retention or transfer was performed.'
  exit 0
fi

command -v sha256sum >/dev/null || { printf 'sha256sum is required\n' >&2; exit 1; }
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY must point to the encrypted Storage Box repository}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"
if [[ "$restic_mode" == host ]]; then
  command -v restic >/dev/null || { printf 'restic is required\n' >&2; exit 1; }
  [[ -r "$RESTIC_PASSWORD_FILE" ]] || { printf 'RESTIC_PASSWORD_FILE is not readable\n' >&2; exit 1; }
else
  docker image inspect "$restic_image" >/dev/null 2>&1 || {
    printf 'Restic image must be pre-pulled and reviewed: %s\n' "$restic_image" >&2
    exit 1
  }
fi

umask 077
exec 9>/run/lock/a11-neo4j-storagebox-backup.lock
flock -n 9 || { printf 'another Neo4j Storage Box backup is active\n' >&2; exit 75; }

run_id="$(date -u +%Y%m%dT%H%M%SZ)"
host_run="$host_staging_root/$run_id"
container_run="$container_staging_root/$run_id"
host_uid="$(id -u)"
host_gid="$(id -g)"
install -d -m 0700 "$host_run"
neo4j_stopped_by_backup=0
verify_container="a11-neo4j-restore-check-${run_id,,}"
verify_volume="a11-neo4j-restore-check-${run_id,,}"
dump_container="a11-neo4j-dump-${run_id,,}"
normalize_campaign_ownership() {
  docker run --rm --user 0:0 --entrypoint /bin/sh \
    --mount "type=bind,src=$host_run,dst=/campaign" \
    "$neo4j_image_id" -lc \
    "chown -R $host_uid:$host_gid /campaign
     find /campaign -type d -exec chmod 0700 {} +
     find /campaign -type f -exec chmod 0600 {} +" \
    >/dev/null
}
cleanup() {
  docker rm -f "$dump_container" >/dev/null 2>&1 || true
  docker rm -f "$verify_container" >/dev/null 2>&1 || true
  docker volume rm "$verify_volume" >/dev/null 2>&1 || true
  if [[ "$neo4j_stopped_by_backup" == 1 ]]; then
    printf 'restarting source Neo4j after interrupted backup\n' >&2
    docker start "$neo4j_container" >/dev/null 2>&1 || true
  fi
  if [[ "$host_run" == "$host_staging_root"/20??????T??????Z ]]; then
    normalize_campaign_ownership >/dev/null 2>&1 || true
    rm -rf -- "$host_run"
  else
    printf 'refusing unsafe staging cleanup: %s\n' "$host_run" >&2
  fi
}
trap cleanup EXIT

docker exec "$backend_container" \
  node scripts/a11-memory-router.cjs backup-storagebox \
  --target local \
  --output "$container_run" \
  >"$host_run/export-result.json"

# The JSON above is deliberately a diagnostic inventory: it is useful for
# counts and human inspection, but it cannot preserve all Neo4j property
# types. A native dump is therefore mandatory by default and is the only
# artifact described as restorable.
if [[ "$native_dump_mode" == required ]]; then
  neo4j_uid="$(docker exec "$neo4j_container" sh -lc 'id -u neo4j 2>/dev/null || id -u' | tr -d '[:space:]')"
  neo4j_gid="$(docker exec "$neo4j_container" sh -lc 'id -g neo4j 2>/dev/null || id -g' | tr -d '[:space:]')"
  native_dump_dir="$host_run/native-dump"
  install -d -m 0700 "$native_dump_dir"
  # The parent is 0700, so this temporary write permission is not reachable by
  # other host users; it only lets UID 7474 in the dump container create the
  # file. Permissions are normalized immediately afterwards.
  chmod 0777 "$native_dump_dir"

  printf 'creating native Neo4j dump with a controlled maintenance stop\n'
  docker stop --time 60 "$neo4j_container" >/dev/null
  neo4j_stopped_by_backup=1
  # neo4j-admin acquires the offline store lock, which requires a writable
  # /data mount even though dump does not mutate graph records. The source
  # server is stopped and the helper runs with the same Neo4j UID/GID.
  docker run --rm \
    --name "$dump_container" \
    --user "$neo4j_uid:$neo4j_gid" \
    --mount "type=volume,src=$neo4j_data_volume,dst=/data" \
    --mount "type=bind,src=$native_dump_dir,dst=/backups" \
    "$neo4j_image_id" \
    neo4j-admin database dump "$neo4j_database" \
    --to-path=/backups \
    --overwrite-destination=true
  [[ -s "$native_dump_dir/$neo4j_database.dump" ]] || {
    printf 'native Neo4j dump was not created\n' >&2
    exit 1
  }
  # The disposable load process runs as the same Neo4j UID. Keep the dump
  # private but readable by that UID until restore verification has finished.
  docker run --rm --user 0:0 --entrypoint /bin/sh \
    --mount "type=bind,src=$native_dump_dir,dst=/backups" \
    "$neo4j_image_id" -lc \
    "chown -R $neo4j_uid:$neo4j_gid /backups && chmod -R go-rwx /backups"
  docker start "$neo4j_container" >/dev/null
  if ! wait_for_source_neo4j; then
    docker logs --tail 80 "$neo4j_container" >&2 || true
    printf 'source Neo4j did not become queryable after restart\n' >&2
    exit 1
  fi
  neo4j_stopped_by_backup=0

  if [[ "$verify_restore" == 1 ]]; then
    source_metrics="$(docker exec "$backend_container" node -e '
      const fs = require("node:fs");
      const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const source = value.sources && value.sources.local;
      if (!source) process.exit(2);
      process.stdout.write([
        source.nodes,
        source.relationships,
        source.constraints,
        source.indexes,
        source.fallbackUsed ? 1 : 0,
        source.database,
      ].join(" "));
    ' "$container_run/export-result.json")"
    read -r source_nodes source_relationships source_constraints source_indexes source_fallback source_database <<<"$source_metrics"
    for metric in "$source_nodes" "$source_relationships" "$source_constraints" "$source_indexes"; do
      [[ "$metric" =~ ^[0-9]+$ ]] || {
        printf 'logical source inventory contains an invalid metric: %s\n' "$source_metrics" >&2
        exit 1
      }
    done
    [[ "$source_fallback" == 0 && "$source_database" == "$neo4j_database" ]] || {
      printf 'logical inventory did not read the requested production database: %s\n' "$source_metrics" >&2
      exit 1
    }

    docker volume create "$verify_volume" >/dev/null
    docker run --rm \
      --mount "type=volume,src=$verify_volume,dst=/data" \
      --mount "type=bind,src=$native_dump_dir,dst=/backups,readonly" \
      "$neo4j_image_id" \
      neo4j-admin database load "$neo4j_database" \
      --from-path=/backups \
      --overwrite-destination=true
    docker run -d \
      --name "$verify_container" \
      --mount "type=volume,src=$verify_volume,dst=/data" \
      -e NEO4J_AUTH=none \
      -e NEO4J_dbms_security_auth__enabled=false \
      -e NEO4J_server_memory_heap_initial__size=256m \
      -e NEO4J_server_memory_heap_max__size=512m \
      "$neo4j_image_id" >/dev/null

    restore_ready=0
    for _ in $(seq 1 90); do
      if docker exec "$verify_container" /var/lib/neo4j/bin/cypher-shell --database "$neo4j_database" 'RETURN 1 AS ready' >/dev/null 2>&1; then
        restore_ready=1
        break
      fi
      sleep 2
    done
    [[ "$restore_ready" == 1 ]] || {
      docker logs --tail 80 "$verify_container" >&2 || true
      printf 'restored Neo4j verification instance did not become ready\n' >&2
      exit 1
    }
    restore_scalar() {
      docker exec "$verify_container" /var/lib/neo4j/bin/cypher-shell \
        --database "$neo4j_database" --format plain "$1" \
        | tail -n 1 | tr -d '[:space:]"\r'
    }
    restored_nodes="$(restore_scalar 'MATCH (n) RETURN count(n) AS count')"
    restored_relationships="$(restore_scalar 'MATCH ()-[r]->() RETURN count(r) AS count')"
    restored_constraints="$(restore_scalar 'SHOW CONSTRAINTS YIELD name RETURN count(*) AS count')"
    restored_indexes="$(restore_scalar 'SHOW INDEXES YIELD name RETURN count(*) AS count')"
    [[ "$restored_nodes" == "$source_nodes" \
       && "$restored_relationships" == "$source_relationships" \
       && "$restored_constraints" == "$source_constraints" \
       && "$restored_indexes" == "$source_indexes" ]] || {
      printf 'restore mismatch source=%s/%s/%s/%s restored=%s/%s/%s/%s\n' \
        "$source_nodes" "$source_relationships" "$source_constraints" "$source_indexes" \
        "$restored_nodes" "$restored_relationships" "$restored_constraints" "$restored_indexes" >&2
      exit 1
    }
    {
      printf 'verified_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf 'database=%s\n' "$neo4j_database"
      printf 'nodes=%s\n' "$restored_nodes"
      printf 'relationships=%s\n' "$restored_relationships"
      printf 'constraints=%s\n' "$restored_constraints"
      printf 'indexes=%s\n' "$restored_indexes"
    } >"$host_run/RESTORE-VERIFICATION.txt"
    docker rm -f "$verify_container" >/dev/null
    docker volume rm "$verify_volume" >/dev/null
  fi
fi

# docker exec and the Neo4j helpers use container UIDs. Normalize the complete
# campaign back to the caller account only after the native restore proof, so
# checksums, Restic and fail-safe cleanup can read/remove every artifact.
normalize_campaign_ownership

{
  printf 'schema=funesterie.storagebox-backup.v1\n'
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'host=%s\n' "$(hostname)"
  printf 'neo4j_container=%s\n' "$neo4j_container"
  printf 'neo4j_image=%s\n' "$neo4j_image_label"
  printf 'neo4j_image_id=%s\n' "$neo4j_image_id"
  printf 'export_container=%s\n' "$backend_container"
  printf 'native_dump_mode=%s\n' "$native_dump_mode"
  printf 'restore_verified=%s\n' "$verify_restore"
  printf 'active_release=%s\n' "$(readlink -f /home/deploy/a11-prod/current 2>/dev/null || true)"
  printf 'retention_daily=%s\n' "$keep_daily"
  printf 'retention_weekly=%s\n' "$keep_weekly"
  printf 'retention_monthly=%s\n' "$keep_monthly"
  printf 'artifact_paths=%s\n' "${artifacts[*]:-(none)}"
} >"$host_run/BACKUP-MANIFEST.txt"

cat >"$host_run/RESTIC-EXCLUDES.txt" <<'EOF'
**/.env
**/.env.*
**/a11mcp.env
**/*secret*
**/*.pem
**/*.key
**/.deploy-tmp/**
**/a11mcp-prod/releases/**
EOF

# Compute this after the campaign manifest so every staged artifact except the
# checksum list itself is authenticated by both SHA-256 and Restic.
(
  cd "$host_run"
  find . -type f ! -name SHA256SUMS -print0 \
    | sort -z \
    | xargs -0 -r sha256sum
) >"$host_run/SHA256SUMS"

source_bytes="$(du -sb "$host_run" "${artifacts[@]}" 2>/dev/null | awk '{sum += $1} END {print sum + 0}')"
if (( source_bytes > max_source_bytes )); then
  printf 'source selection (%s bytes) exceeds guard (%s bytes)\n' "$source_bytes" "$max_source_bytes" >&2
  exit 1
fi

backup_sources=("$host_run" "${artifacts[@]}")
run_restic() {
  if [[ "$restic_mode" == host ]]; then
    restic "$@"
    return
  fi
  docker run --rm \
    --network host \
    -e RESTIC_REPOSITORY \
    -e "RESTIC_PASSWORD_FILE=$RESTIC_PASSWORD_FILE" \
    -e RESTIC_CACHE_DIR=/var/cache/restic \
    --mount "type=bind,src=$RESTIC_PASSWORD_FILE,dst=$RESTIC_PASSWORD_FILE,readonly" \
    --mount "type=bind,src=$restic_ssh_dir,dst=/root/.ssh,readonly" \
    --mount type=bind,src=/home/deploy/a11-data,dst=/home/deploy/a11-data,readonly \
    --mount type=bind,src=/home/deploy/a11-prod,dst=/home/deploy/a11-prod,readonly \
    --mount "type=volume,src=$restic_cache_volume,dst=/var/cache/restic" \
    "$restic_image" "$@"
}

run_restic backup \
  --exclude-file "$host_run/RESTIC-EXCLUDES.txt" \
  --tag a11-neo4j-storagebox \
  --tag neo4j \
  --tag artifacts \
  --host "$(hostname)" \
  "${backup_sources[@]}"

run_restic forget \
  --tag a11-neo4j-storagebox \
  --keep-daily "$keep_daily" \
  --keep-weekly "$keep_weekly" \
  --keep-monthly "$keep_monthly" \
  --prune

run_restic check --read-data-subset="$check_subset"
printf 'backup complete: run=%s source_bytes=%s\n' "$run_id" "$source_bytes"
