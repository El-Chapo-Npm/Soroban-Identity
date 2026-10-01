#!/usr/bin/env bash
# Hourly DR backup (#945): run scripts/backup.sh, then upload the archive and
# its checksum to the primary backup bucket. S3 cross-region replication
# (infrastructure/dr/terraform) copies it to the DR region.
#
# Usage:
#   backup-and-ship.sh [--no-redis]
#
# Env:
#   DR_BACKUP_BUCKET_PRIMARY  bucket to upload to (required)
#   BACKUP_DIR                local archive dir (default: <repo>/backups)
#   DATA_DIR, REDIS_URL       passed through to scripts/backup.sh
#   ALERT_WEBHOOK             optional; POSTed a JSON message on failure
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
BUCKET="${DR_BACKUP_BUCKET_PRIMARY:-}"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"

log() { printf '%s [dr-backup] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

alert() {
  log "ERROR: $1"
  if [[ -n "$ALERT_WEBHOOK" ]]; then
    curl -fsS -m 10 -X POST "$ALERT_WEBHOOK" -H 'Content-Type: application/json' \
      -d "{\"text\":\"[dr-backup] $(hostname -s 2>/dev/null || echo host): $1\"}" >/dev/null 2>&1 \
      || log "WARN: alert webhook delivery failed"
  fi
}
trap 'alert "backup-and-ship failed at line $LINENO"' ERR

[[ -n "$BUCKET" ]] || { alert "DR_BACKUP_BUCKET_PRIMARY is not set"; exit 1; }
command -v aws >/dev/null 2>&1 || { alert "aws CLI not found"; exit 1; }

"$REPO_ROOT/scripts/backup.sh" --backup-dir "$BACKUP_DIR" --quiet "$@"

ARCHIVE="$(find "$BACKUP_DIR" -maxdepth 1 -name 'soroban-identity-backup-*.tar.gz' -type f -printf '%T@ %p\n' \
  | sort -n | tail -n1 | cut -d' ' -f2-)"
[[ -n "$ARCHIVE" ]] || { alert "no archive produced in $BACKUP_DIR"; exit 1; }

NAME="$(basename "$ARCHIVE")"
(cd "$(dirname "$ARCHIVE")" && sha256sum "$NAME" > "$NAME.sha256")

log "uploading $NAME -> s3://$BUCKET/archives/"
aws s3 cp "$ARCHIVE" "s3://$BUCKET/archives/$NAME" --only-show-errors --sse aws:kms
aws s3 cp "$ARCHIVE.sha256" "s3://$BUCKET/archives/$NAME.sha256" --only-show-errors --sse aws:kms
rm -f "$ARCHIVE.sha256"

log "done: $NAME ($(du -h "$ARCHIVE" | cut -f1))"
