#!/usr/bin/env bash
# Restore the service in one region from the DR backups (#959).
#
# Usage:
#   recover.sh --region REGION [--bucket BUCKET] [--backup-key KEY]
#              [--data-dir DIR] [--desired-count N] [--origin URL]
#              [--no-scale] [--dry-run]
#
#   --region         Region to recover into (its ECS service is scaled up).
#   --bucket         Bucket to restore from (default: the DR bucket in --region).
#   --backup-key     Specific archive key (default: newest in the bucket).
#   --data-dir       Where the service's DATA_DIR is mounted on this host
#                    (the EFS mount). Default: $DR_DATA_DIR or /mnt/soroban-data.
#   --desired-count  Task count to scale to (default 3).
#   --origin         Origin to health-check after scaling (default: $DR_ORIGIN_<REGION>).
#   --no-scale       Restore data only; leave ECS as it is.
#   --dry-run        Download and inspect the archive; change nothing.
#
# Prints a JSON summary on stdout: archive, rpo_seconds, duration_seconds.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

REGION=""
BUCKET=""
KEY=""
DATA_DIR="${DR_DATA_DIR:-/mnt/soroban-data}"
DESIRED=3
ORIGIN=""
SCALE=1
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case $1 in
    --region) REGION="$2"; shift 2 ;;
    --bucket) BUCKET="$2"; shift 2 ;;
    --backup-key) KEY="$2"; shift 2 ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --desired-count) DESIRED="$2"; shift 2 ;;
    --origin) ORIGIN="$2"; shift 2 ;;
    --no-scale) SCALE=0; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) fail "unknown option: $1" ;;
  esac
done

[[ -n "$REGION" ]] || fail "--region is required"
require aws curl gzip tar
STARTED="$(date +%s)"
BUCKET="${BUCKET:-$(bucket_for "$REGION")}"
ORIGIN_VAR="DR_ORIGIN_$(echo "$REGION" | tr 'a-z-' 'A-Z_')"
ORIGIN="${ORIGIN:-${!ORIGIN_VAR:-}}"

# The bucket's region can differ from the recovery region during failback.
BUCKET_REGION="$(aws s3api get-bucket-location --bucket "$BUCKET" --query LocationConstraint --output text)"
[[ "$BUCKET_REGION" == "None" ]] && BUCKET_REGION="us-east-1"

if [[ -z "$KEY" ]]; then
  KEY="$(latest_archive "$BUCKET" "$BUCKET_REGION")"
  [[ -n "$KEY" ]] || fail "no archives found in s3://$BUCKET/$ARCHIVE_PREFIX/"
fi
RPO="$(object_age_seconds "$BUCKET" "$KEY" "$BUCKET_REGION")"
log "selected s3://$BUCKET/$KEY (age ${RPO}s = expected RPO)"
notify "recovery into $REGION started from $KEY (RPO ~$((RPO / 60)) min)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ARCHIVE="$WORK/$(basename "$KEY")"
aws s3 cp "s3://$BUCKET/$KEY" "$ARCHIVE" --region "$BUCKET_REGION" --only-show-errors
gzip -t "$ARCHIVE" || fail "archive failed gzip integrity check"

RESTORE_ARGS=("$ARCHIVE" --data-dir "$DATA_DIR" --config-dir "$WORK/config")
if [[ "$DRY_RUN" -eq 1 ]]; then
  "$REPO_ROOT/scripts/restore.sh" "${RESTORE_ARGS[@]}" --dry-run
  log "dry run: nothing changed"
  exit 0
fi

# Stop writers in this region before replacing their data.
if [[ "$SCALE" -eq 1 ]]; then scale_service "$REGION" 0; fi

# Config files are restored into a scratch dir only: in ECS the secret manager
# is authoritative (see backup-restoration.md).
"$REPO_ROOT/scripts/restore.sh" "${RESTORE_ARGS[@]}" --force --quiet \
  || fail "restore.sh failed"
log "data restored into $DATA_DIR"

if [[ "$SCALE" -eq 1 ]]; then
  scale_service "$REGION" "$DESIRED"
  if [[ -n "$ORIGIN" ]]; then
    log "waiting for $ORIGIN/ready"
    wait_ready "$ORIGIN" 600 || fail "$ORIGIN did not become ready within 10 min"
  else
    log "WARN: no --origin / $ORIGIN_VAR set; skipping readiness check"
  fi
fi

DURATION=$(( $(date +%s) - STARTED ))
notify "recovery into $REGION complete in $((DURATION / 60)) min"
printf '{"archive":"s3://%s/%s","rpo_seconds":%d,"duration_seconds":%d}\n' \
  "$BUCKET" "$KEY" "$RPO" "$DURATION"
