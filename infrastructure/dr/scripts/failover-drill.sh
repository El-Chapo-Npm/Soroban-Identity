#!/usr/bin/env bash
# Quarterly DR drill (#959). Runs a failover scenario against staging, measures
# RTO and RPO, and writes a report to infrastructure/dr/drills/.
#
# Usage:
#   failover-drill.sh [--env staging] [--scenario region|restore] [--no-failback]
#
# Requires: DR_ORIGIN_US_EAST_1, DR_ORIGIN_US_WEST_2 (staging origins),
#           DR_ADMIN_API_KEY (admin key for the staging API),
#           CLOUDFLARE_API_TOKEN (region scenario only).
# See infrastructure/dr/failover-testing.md for the procedure and pass criteria.
set -euo pipefail
export DR_ENV="staging"
SCENARIO="region"
FAILBACK=1

while [[ $# -gt 0 ]]; do
  case $1 in
    --env) DR_ENV="$2"; shift 2 ;;
    --scenario) SCENARIO="$2"; shift 2 ;;
    --no-failback) FAILBACK=0; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
[[ "$DR_ENV" != "production" ]] || fail "drills never run against production"
[[ "$SCENARIO" == "region" || "$SCENARIO" == "restore" ]] || fail "unknown scenario: $SCENARIO"
require aws curl jq
: "${DR_ADMIN_API_KEY:?DR_ADMIN_API_KEY is required}"

SCRIPTS="$(dirname "$0")"
PRIMARY_ORIGIN="${DR_ORIGIN_US_EAST_1:?DR_ORIGIN_US_EAST_1 is required}"
SECONDARY_ORIGIN="${DR_ORIGIN_US_WEST_2:?DR_ORIGIN_US_WEST_2 is required}"

PHASES=()
phase() {
  local name="$1"; shift
  local t0; t0="$(date +%s)"
  log "phase: $name"
  "$@"
  PHASES+=("| $name | $(date -u -d "@$t0" +%H:%M:%SZ) | $(( $(date +%s) - t0 ))s |")
}

DRILL_START="$(date +%s)"
MARKER="dr-drill-$(date -u +%Y%m%dT%H%M%SZ)"
MARKER_AT="$(date +%s)"

seed_marker() {
  curl -fsS -X POST "$PRIMARY_ORIGIN/webhooks" \
    -H "x-api-key: $DR_ADMIN_API_KEY" -H 'content-type: application/json' \
    -d "{\"url\":\"https://example.invalid/$MARKER\",\"events\":[\"credential.issued\"]}" >/dev/null
}

ship() { SHIPPED="$("$SCRIPTS/ship-backup.sh" --region "$PRIMARY_REGION")"; }

wait_replication() {
  local key="${SHIPPED#s3://*/}" bucket; bucket="$(bucket_for "$SECONDARY_REGION")"
  local deadline=$(( $(date +%s) + 1800 ))
  until aws s3api head-object --region "$SECONDARY_REGION" --bucket "$bucket" --key "$key" >/dev/null 2>&1; do
    (( $(date +%s) < deadline )) || fail "archive not replicated within 30 min"
    sleep 15
  done
}

do_failover() {
  RTO_START="$(date +%s)"
  "$SCRIPTS/failover.sh" --to "$SECONDARY_REGION" --origin "$SECONDARY_ORIGIN" --yes
  RTO=$(( $(date +%s) - RTO_START ))
  CHECK_ORIGIN="$SECONDARY_ORIGIN"
}

do_restore() {
  RTO_START="$(date +%s)"
  "$SCRIPTS/recover.sh" --region "$PRIMARY_REGION" --origin "$PRIMARY_ORIGIN" >/dev/null
  RTO=$(( $(date +%s) - RTO_START ))
  CHECK_ORIGIN="$PRIMARY_ORIGIN"
}

check_marker() {
  if curl -fsS -H "x-api-key: $DR_ADMIN_API_KEY" "$CHECK_ORIGIN/webhooks" | grep -q "$MARKER"; then
    MARKER_OK=yes
  else
    MARKER_OK=no
  fi
}

do_failback() {
  "$SCRIPTS/ship-backup.sh" --region "$SECONDARY_REGION" >/dev/null
  "$SCRIPTS/failover.sh" --to "$PRIMARY_REGION" --origin "$PRIMARY_ORIGIN" \
    --bucket "$(bucket_for "$SECONDARY_REGION")" --yes >/dev/null
}

phase "seed marker" seed_marker
phase "backup shipped" ship
[[ "$SCENARIO" == "region" ]] && phase "replication" wait_replication
if [[ "$SCENARIO" == "region" ]]; then phase "failover" do_failover; else phase "restore" do_restore; fi
phase "verify marker" check_marker
RPO=$(( RTO_START - MARKER_AT ))
[[ "$SCENARIO" == "region" && "$FAILBACK" -eq 1 ]] && phase "failback" do_failback

RESULT=PASS
(( RTO <= 3600 )) || RESULT=FAIL
(( RPO <= 3600 )) || RESULT=FAIL
[[ "$MARKER_OK" == yes ]] || RESULT=FAIL

QUARTER="$(date -u +%Y)-Q$(( ($(date -u +%-m) - 1) / 3 + 1 ))"
REPORT="$REPO_ROOT/infrastructure/dr/drills/$QUARTER-$SCENARIO.md"
mkdir -p "$(dirname "$REPORT")"
{
  echo "# DR drill — $QUARTER — $SCENARIO"
  echo
  echo "- Date: $(date -u +%Y-%m-%d)"
  echo "- Environment: $DR_ENV"
  echo "- Drill lead / observer: _fill in_"
  echo
  echo "| Phase | Started | Duration |"
  echo "| --- | --- | --- |"
  printf '%s\n' "${PHASES[@]}"
  echo "| **total drill** | | $(( $(date +%s) - DRILL_START ))s |"
  echo
  echo "- Measured RTO: ${RTO}s (target ≤ 3600s)"
  echo "- Measured RPO: ${RPO}s (target ≤ 3600s)"
  echo "- Marker present: $MARKER_OK"
  echo "- Result: **$RESULT**"
  echo
  echo "## What went wrong"
  echo
  echo "## Follow-up issues"
} > "$REPORT"

log "report written to $REPORT ($RESULT)"
notify "drill $QUARTER/$SCENARIO: $RESULT (RTO ${RTO}s, RPO ${RPO}s)"
[[ "$RESULT" == PASS ]]
