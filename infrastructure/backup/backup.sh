#!/usr/bin/env bash
#
# Automated database backup script (INFRA-01 / issue #862)
#
# Backs up Redis and persistent stores, compresses with gzip, uploads to
# S3/cloud storage, enforces a 30-day retention policy, and alerts on failure.
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via environment)
# ---------------------------------------------------------------------------
BACKUP_DIR="${BACKUP_DIR:-/var/backups/db}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-db-backups}"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"

# Redis connection
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"

# Persistent stores: space-separated list of "name:path" entries.
# Each path is a directory or file that will be archived.
PERSISTENT_STORES="${PERSISTENT_STORES:-}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
HOSTNAME_SHORT="$(hostname -s 2>/dev/null || echo host)"

log() { printf '%s [backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# ---------------------------------------------------------------------------
# Failure alerting
# ---------------------------------------------------------------------------
alert_failure() {
  local message="$1"
  log "ERROR: ${message}"
  if [ -n "${ALERT_WEBHOOK}" ]; then
    curl -fsS -m 10 -X POST "${ALERT_WEBHOOK}" \
      -H 'Content-Type: application/json' \
      -d "{\"text\":\"[backup] ${HOSTNAME_SHORT}: ${message}\"}" \
      >/dev/null 2>&1 || log "WARN: failed to deliver alert webhook"
  fi
}

trap 'alert_failure "backup failed at line ${LINENO}"' ERR

# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------
mkdir -p "${BACKUP_DIR}"

backup_redis() {
  local out="${BACKUP_DIR}/redis-${HOSTNAME_SHORT}-${TIMESTAMP}.rdb"
  log "backing up Redis (${REDIS_HOST}:${REDIS_PORT}) -> ${out}"
  if [ -n "${REDIS_PASSWORD}" ]; then
    redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" -a "${REDIS_PASSWORD}" --no-auth-warning \
      --rdb "${out}"
  else
    redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" --rdb "${out}"
  fi
  gzip -f "${out}"
  echo "${out}.gz"
}

backup_persistent_stores() {
  local archives=()
  local entry name path out
  for entry in ${PERSISTENT_STORES}; do
    name="${entry%%:*}"
    path="${entry#*:}"
    if [ ! -e "${path}" ]; then
      log "WARN: persistent store '${name}' path '${path}' not found, skipping"
      continue
    fi
    out="${BACKUP_DIR}/${name}-${HOSTNAME_SHORT}-${TIMESTAMP}.tar.gz"
    log "backing up persistent store '${name}' (${path}) -> ${out}"
    tar -czf "${out}" -C "$(dirname "${path}")" "$(basename "${path}")"
    archives+=("${out}")
  done
  printf '%s\n' "${archives[@]:-}"
}

upload_to_s3() {
  local file="$1"
  if [ -z "${S3_BUCKET}" ]; then
    log "WARN: S3_BUCKET not set, skipping upload of ${file}"
    return 0
  fi
  local key="${S3_PREFIX}/$(basename "${file}")"
  log "uploading ${file} -> s3://${S3_BUCKET}/${key}"
  aws s3 cp "${file}" "s3://${S3_BUCKET}/${key}" --only-show-errors
}

enforce_retention() {
  log "enforcing ${RETENTION_DAYS}-day retention in ${BACKUP_DIR}"
  find "${BACKUP_DIR}" -type f \( -name '*.gz' -o -name '*.rdb' \) \
    -mtime "+${RETENTION_DAYS}" -print -delete
}

main() {
  local files=()
  local redis_file
  redis_file="$(backup_redis)"
  files+=("${redis_file}")

  while IFS= read -r f; do
    [ -n "${f}" ] && files+=("${f}")
  done < <(backup_persistent_stores)

  local f
  for f in "${files[@]}"; do
    upload_to_s3 "${f}"
  done

  enforce_retention
  log "backup completed successfully (${#files[@]} archive(s))"
}

main "$@"
