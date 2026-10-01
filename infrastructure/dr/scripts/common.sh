#!/usr/bin/env bash
# Shared helpers and defaults for the DR scripts (#959). Sourced, not executed.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

PRIMARY_REGION="${PRIMARY_REGION:-us-east-1}"
SECONDARY_REGION="${SECONDARY_REGION:-us-west-2}"
BUCKET_PREFIX="${DR_BUCKET_PREFIX:-soroban-identity-dr-backups}"
ARCHIVE_PREFIX="${DR_ARCHIVE_PREFIX:-archives}"
DR_ENV="${DR_ENV:-production}"

log() { printf '%s [dr] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
fail() { log "ERROR: $*"; notify "DR step failed: $*"; exit 1; }

# Post to the incident webhook when one is configured. Never fails the caller.
notify() {
  [[ -n "${DR_ALERT_WEBHOOK:-}" ]] || return 0
  curl -fsS -m 10 -X POST "$DR_ALERT_WEBHOOK" -H 'Content-Type: application/json' \
    -d "$(printf '{"text":"[dr:%s] %s"}' "$DR_ENV" "$1")" >/dev/null 2>&1 || true
}

require() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || fail "'$cmd' is required but not on PATH"
  done
}

bucket_for() { printf '%s-%s' "$BUCKET_PREFIX" "$1"; }

# ECS cluster and service names per region: the primary uses the environment
# stack, the secondary uses the DR stack in infrastructure/dr/terraform.
ecs_name_for() {
  if [[ "$1" == "$PRIMARY_REGION" ]]; then
    printf 'soroban-identity-%s' "$DR_ENV"
  else
    printf 'soroban-identity-%s-dr' "$DR_ENV"
  fi
}

# Newest archive key in a bucket, or empty.
latest_archive() {
  local bucket="$1" region="$2"
  aws s3api list-objects-v2 --region "$region" --bucket "$bucket" --prefix "$ARCHIVE_PREFIX/" \
    --query 'sort_by(Contents,&LastModified)[-1].Key' --output text 2>/dev/null | grep -v '^None$' || true
}

# Age of an S3 object in whole seconds.
object_age_seconds() {
  local bucket="$1" key="$2" region="$3" modified
  modified="$(aws s3api head-object --region "$region" --bucket "$bucket" --key "$key" \
    --query LastModified --output text)"
  echo $(( $(date -u +%s) - $(date -u -d "$modified" +%s) ))
}

scale_service() {
  local region="$1" count="$2" name
  name="$(ecs_name_for "$region")"
  log "scaling $name in $region to $count task(s)"
  aws ecs update-service --region "$region" --cluster "$name" --service "$name" \
    --desired-count "$count" >/dev/null
  if [[ "$count" -gt 0 ]]; then
    aws ecs wait services-stable --region "$region" --cluster "$name" --services "$name"
  fi
}

# Poll <origin>/ready until it returns 200 or the timeout elapses.
wait_ready() {
  local origin="$1" timeout="${2:-600}" start
  start="$(date +%s)"
  until curl -fsS -m 5 "$origin/ready" >/dev/null 2>&1; do
    (( $(date +%s) - start < timeout )) || return 1
    sleep 10
  done
}
