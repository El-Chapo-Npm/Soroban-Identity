#!/usr/bin/env bash
# Regional failover to the DR (pilot light) region (#945).
# Implements infrastructure/dr/runbook.md § E. Dry run unless --execute.
#
# Usage:
#   failover.sh [--execute] [--skip-redis] [--skip-dns] [--skip-freeze]
#
# Required env (see runbook.md § Environment):
#   DR_REGION DR_CLUSTER DR_SERVICE DR_DESIRED_COUNT DR_BACKUP_BUCKET_SECONDARY
#   DR_DATA_DIR DR_ORIGIN PUBLIC_URL
#   CF_API_TOKEN CF_ZONE_ID CF_RECORD_ID      (unless --skip-dns)
# Optional:
#   PRIMARY_REGION PRIMARY_CLUSTER PRIMARY_SERVICE   freeze the primary first
#   DR_REDIS_URL                                     self-hosted Redis restore target
#   DR_RPO_MINUTES (60)                              warn when the archive is older
#   FAILOVER_TIMINGS                                 file to write step timings (JSON lines)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

EXECUTE=0
SKIP_REDIS=0
SKIP_DNS=0
SKIP_FREEZE=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --execute) EXECUTE=1; shift ;;
    --skip-redis) SKIP_REDIS=1; shift ;;
    --skip-dns) SKIP_DNS=1; shift ;;
    --skip-freeze) SKIP_FREEZE=1; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

required=(DR_REGION DR_CLUSTER DR_SERVICE DR_DESIRED_COUNT DR_BACKUP_BUCKET_SECONDARY DR_DATA_DIR DR_ORIGIN PUBLIC_URL)
[[ "$SKIP_DNS" -eq 1 ]] || required+=(CF_API_TOKEN CF_ZONE_ID CF_RECORD_ID)
for v in "${required[@]}"; do
  [[ -n "${!v:-}" ]] || { echo "missing required env: $v" >&2; exit 2; }
done

RPO_MINUTES="${DR_RPO_MINUTES:-60}"
TIMINGS="${FAILOVER_TIMINGS:-/dev/null}"
START="$(date -u +%s)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

log() { printf '%s [failover] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
step() {
  local name="$1"
  log "── $name"
  printf '{"step":"%s","at":%s,"elapsed_s":%s}\n' "$name" "$(date -u +%s)" "$(( $(date -u +%s) - START ))" >> "$TIMINGS"
}
run() {
  if [[ "$EXECUTE" -eq 1 ]]; then
    log "+ $*"
    "$@"
  else
    log "(dry run) $*"
  fi
}

[[ "$EXECUTE" -eq 1 ]] || log "DRY RUN: pass --execute to perform the failover"

# 1. Freeze the primary to avoid split brain.
step "freeze-primary"
if [[ "$SKIP_FREEZE" -eq 0 && -n "${PRIMARY_CLUSTER:-}" && -n "${PRIMARY_SERVICE:-}" ]]; then
  run aws ecs update-service --region "${PRIMARY_REGION:-us-east-1}" --cluster "$PRIMARY_CLUSTER" \
    --service "$PRIMARY_SERVICE" --desired-count 0 --output text --query 'service.serviceName' \
    || log "WARN: primary unreachable; continuing (it cannot serve traffic either)"
else
  log "skipped (no PRIMARY_CLUSTER/PRIMARY_SERVICE or --skip-freeze)"
fi

# 2. Fetch newest archive and check RPO.
step "fetch-backup"
LATEST="$(aws s3 ls "s3://$DR_BACKUP_BUCKET_SECONDARY/archives/" --region "$DR_REGION" \
  | awk '{print $4}' | grep '\.tar\.gz$' | sort | tail -n1)"
[[ -n "$LATEST" ]] || { log "ERROR: no archives in s3://$DR_BACKUP_BUCKET_SECONDARY/archives/"; exit 1; }
AGE_MIN="$("$SCRIPT_DIR/verify-recovery.sh" --check-backup-age --bucket "$DR_BACKUP_BUCKET_SECONDARY" \
  --max-age-minutes 525600 | sed -n 's/.*archive is \([0-9]*\)m old.*/\1/p')"
log "newest archive: $LATEST (${AGE_MIN:-?} min old)"
if [[ -n "$AGE_MIN" && "$AGE_MIN" -gt "$RPO_MINUTES" ]]; then
  log "WARN: archive exceeds ${RPO_MINUTES}m RPO; continuing with best available"
fi
aws s3 cp "s3://$DR_BACKUP_BUCKET_SECONDARY/archives/$LATEST" "$WORK/" --region "$DR_REGION" --only-show-errors
aws s3 cp "s3://$DR_BACKUP_BUCKET_SECONDARY/archives/$LATEST.sha256" "$WORK/" --region "$DR_REGION" --only-show-errors \
  && (cd "$WORK" && sha256sum -c "$LATEST.sha256") \
  || { log "ERROR: checksum verification failed"; exit 1; }

# 3. Restore data (and optionally self-hosted Redis).
step "restore-data"
restore_args=("$WORK/$LATEST" --data-dir "$DR_DATA_DIR" --force)
if [[ "$SKIP_REDIS" -eq 0 && -n "${DR_REDIS_URL:-}" ]]; then
  restore_args+=(--redis-url "$DR_REDIS_URL")
else
  log "Redis restore skipped; service starts with a cold cache (runbook § C for ElastiCache seeding)"
fi
if [[ "$EXECUTE" -eq 1 ]]; then
  "$REPO_ROOT/scripts/restore.sh" "${restore_args[@]}"
else
  "$REPO_ROOT/scripts/restore.sh" "${restore_args[@]}" --dry-run
fi

# 4. Scale up the pilot-light service.
step "scale-up"
run aws ecs update-service --region "$DR_REGION" --cluster "$DR_CLUSTER" --service "$DR_SERVICE" \
  --desired-count "$DR_DESIRED_COUNT" --output text --query 'service.serviceName'
run aws ecs wait services-stable --region "$DR_REGION" --cluster "$DR_CLUSTER" --services "$DR_SERVICE"

# 5. Verify the DR origin directly.
step "verify-origin"
run "$SCRIPT_DIR/verify-recovery.sh" --url "https://$DR_ORIGIN"

# 6. Switch DNS.
step "switch-dns"
if [[ "$SKIP_DNS" -eq 0 ]]; then
  run curl -fsS -X PATCH "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/dns_records/$CF_RECORD_ID" \
    -H "Authorization: Bearer $CF_API_TOKEN" -H 'Content-Type: application/json' \
    --data "{\"type\":\"CNAME\",\"content\":\"$DR_ORIGIN\",\"proxied\":true}" -o /dev/null
else
  log "skipped (--skip-dns)"
fi

# 7. Verify public URL.
step "verify-public"
if [[ "$SKIP_DNS" -eq 0 ]]; then
  run "$SCRIPT_DIR/verify-recovery.sh" --url "$PUBLIC_URL"
fi

step "done"
ELAPSED=$(( $(date -u +%s) - START ))
log "failover complete in $((ELAPSED / 60))m $((ELAPSED % 60))s (RTO target 60m)"
[[ "$EXECUTE" -eq 1 ]] && log "NEXT: status page update, re-point backup shipping to the DR region (runbook § E)"
exit 0
