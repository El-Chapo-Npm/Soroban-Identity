#!/usr/bin/env bash
#
# restore.sh - Restore a database backup produced by backup.sh
#
# Usage:
#   ./restore.sh <backup-file-or-s3-key> [target-dir]
#
# Examples:
#   ./restore.sh /var/backups/handsoff/redis-20240101T030000Z.tar.gz
#   ./restore.sh s3://my-bucket/handsoff/redis-20240101T030000Z.tar.gz
#
# The script downloads the archive from S3 when given an s3:// URI,
# decompresses it, and restores the contained data into the target
# directory (defaults to the configured data directory).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load configuration (bucket, data dir, etc.) if present.
if [[ -f "${SCRIPT_DIR}/backup.env" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/backup.env"
fi

BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_DATA_DIR="${BACKUP_DATA_DIR:-/var/lib/redis}"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

err() {
  log "ERROR: $*" >&2
}

usage() {
  cat <<'EOF'
Usage: restore.sh <backup-file-or-s3-key> [target-dir]

  <backup-file-or-s3-key>  Local path or s3:// URI of the backup archive.
  [target-dir]             Directory to restore into (default: $BACKUP_DATA_DIR).
EOF
}

if [[ $# -lt 1 || "$1" == "-h" || "$1" == "--help" ]]; then
  usage
  exit 1
fi

SOURCE="$1"
TARGET_DIR="${2:-${BACKUP_DATA_DIR}}"

if ! command -v gzip >/dev/null 2>&1; then
  err "gzip is required but not installed"
  exit 1
fi

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

ARCHIVE="${WORK_DIR}/backup.tar.gz"

# Fetch the archive: download from S3 when an s3:// URI is supplied.
if [[ "${SOURCE}" == s3://* ]]; then
  if ! command -v aws >/dev/null 2>&1; then
    err "aws CLI is required to restore from S3"
    exit 1
  fi
  log "Downloading ${SOURCE} from S3"
  aws s3 cp "${SOURCE}" "${ARCHIVE}"
else
  if [[ ! -f "${SOURCE}" ]]; then
    err "backup file not found: ${SOURCE}"
    exit 1
  fi
  cp "${SOURCE}" "${ARCHIVE}"
fi

# Verify the archive is a valid gzip stream before touching live data.
if ! gzip -t "${ARCHIVE}" 2>/dev/null; then
  err "archive is not a valid gzip file: ${SOURCE}"
  exit 1
fi

log "Restoring backup into ${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"

# Extract into a staging directory first so a corrupt archive cannot
# partially overwrite the live data directory.
STAGING="${WORK_DIR}/staging"
mkdir -p "${STAGING}"
tar -xzf "${ARCHIVE}" -C "${STAGING}"

# Copy restored contents into place.
if [[ -n "$(ls -A "${STAGING}" 2>/dev/null)" ]]; then
  cp -a "${STAGING}/." "${TARGET_DIR}/"
else
  err "archive contained no files"
  exit 1
fi

log "Restore complete. Verify the service starts and data is intact."
