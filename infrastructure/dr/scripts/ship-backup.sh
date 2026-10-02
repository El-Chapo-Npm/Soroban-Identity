#!/usr/bin/env bash
# Create a backup with scripts/backup.sh and upload it to the DR bucket (#959).
#
# Usage:
#   ship-backup.sh [--region REGION] [--bucket BUCKET] [--data-dir DIR] [--redis-url URL]
#
# Prints the uploaded s3:// URI on stdout. The bucket replicates to the
# secondary region (see infrastructure/dr/terraform/backups.tf); this script
# only writes to the primary.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

REGION="$PRIMARY_REGION"
BUCKET=""
BACKUP_ARGS=(--quiet)

while [[ $# -gt 0 ]]; do
  case $1 in
    --region) REGION="$2"; shift 2 ;;
    --bucket) BUCKET="$2"; shift 2 ;;
    --data-dir) BACKUP_ARGS+=(--data-dir "$2"); shift 2 ;;
    --redis-url) BACKUP_ARGS+=(--redis-url "$2"); shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) fail "unknown option: $1" ;;
  esac
done

require aws
BUCKET="${BUCKET:-$(bucket_for "$REGION")}"

ARCHIVE="$("$REPO_ROOT/scripts/backup.sh" "${BACKUP_ARGS[@]}")" || fail "backup.sh failed"
[[ -f "$ARCHIVE" ]] || fail "backup.sh did not produce an archive"

KEY="$ARCHIVE_PREFIX/$(basename "$ARCHIVE")"
log "uploading $(basename "$ARCHIVE") -> s3://$BUCKET/$KEY"
aws s3 cp "$ARCHIVE" "s3://$BUCKET/$KEY" --region "$REGION" --only-show-errors \
  --sse aws:kms || fail "upload to s3://$BUCKET/$KEY failed"

echo "s3://$BUCKET/$KEY"
