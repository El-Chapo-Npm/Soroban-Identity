#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COLOR_FILE="${COLOR_FILE:-$ROOT_DIR/active-color}"
ROUTER_CONFIG="${ROUTER_CONFIG:-$ROOT_DIR/router.conf}"
LOCK_FILE="${DEPLOYMENT_LOCK_FILE:-${COLOR_FILE}.lock}"
IMAGE="${IMAGE:?Set IMAGE to an immutable image tag}"
HEALTH_URL="${HEALTH_URL:?Set HEALTH_URL to the candidate health endpoint}"
SMOKE_URL="${SMOKE_URL:-${HEALTH_URL%/health}/info}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"

if ! [[ "$HEALTH_ATTEMPTS" =~ ^[1-9][0-9]*$ && "$HEALTH_INTERVAL" =~ ^[0-9]+$ ]]; then
  echo 'HEALTH_ATTEMPTS must be positive and HEALTH_INTERVAL must be non-negative' >&2
  exit 2
fi
command -v flock >/dev/null 2>&1 || { echo 'flock is required to serialize deployments' >&2; exit 2; }
mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another blue-green deployment is holding $LOCK_FILE" >&2
  exit 2
fi

# Recover the active color from the router if this is the first deployment or
# the local state file was lost. The router remains the source of truth.
ACTIVE_COLOR="$(cat "$COLOR_FILE" 2>/dev/null || sed -n 's/^active=\(blue\|green\)$/\1/p' "$ROUTER_CONFIG" | head -n 1)"
ACTIVE_COLOR="${ACTIVE_COLOR:-blue}"
[[ "$ACTIVE_COLOR" == blue || "$ACTIVE_COLOR" == green ]] || {
  echo "Invalid active color: $ACTIVE_COLOR" >&2
  exit 2
}
INACTIVE_COLOR="$([[ "$ACTIVE_COLOR" == blue ]] && echo green || echo blue)"
MIGRATION_APPLIED=0
CUTOVER_ATTEMPTED=0

write_active_color() {
  local temporary
  temporary="$(mktemp "${COLOR_FILE}.tmp.XXXXXX")"
  printf '%s\n' "$1" > "$temporary"
  chmod 600 "$temporary"
  mv -f "$temporary" "$COLOR_FILE"
}

rollback_failed_deployment() {
  local status="$1"
  local traffic_restored=1
  local candidate_safe_to_stop=1
  set +e
  echo "Deployment failed (status $status); restoring traffic to $ACTIVE_COLOR" >&2
  if [[ "$CUTOVER_ATTEMPTED" == 1 ]]; then
    if "$ROOT_DIR/traffic-switch.sh" "$ACTIVE_COLOR" "$ROUTER_CONFIG"; then
      write_active_color "$ACTIVE_COLOR" || traffic_restored=0
    else
      traffic_restored=0
    fi
  fi
  if [[ "$MIGRATION_APPLIED" == 1 ]]; then
    if [[ "$traffic_restored" == 1 ]]; then
      echo 'Rolling back the database migration before ending the deployment.' >&2
      if ! "$ROOT_DIR/migrate-and-rollback.sh" rollback; then
        echo 'Database migration rollback failed; keeping the candidate available for manual recovery.' >&2
        MIGRATION_APPLIED=2
        candidate_safe_to_stop=0
      fi
    else
      write_active_color "$INACTIVE_COLOR" || true
      echo 'Could not confirm traffic is back on the previous color; keeping the candidate and migrated schema live for manual recovery.' >&2
      candidate_safe_to_stop=0
    fi
  elif [[ "$MIGRATION_APPLIED" == 2 ]]; then
    echo 'Migration rollback status is uncertain; keeping the candidate available for manual recovery.' >&2
    candidate_safe_to_stop=0
  fi
  if [[ "$traffic_restored" == 1 && "$candidate_safe_to_stop" == 1 ]]; then
    "$ROOT_DIR/environment.sh" stop "$INACTIVE_COLOR" || true
  else
    echo "Leaving candidate $INACTIVE_COLOR running for safe recovery." >&2
  fi
  return "$status"
}

on_exit() {
  local status="$?"
  trap - EXIT
  if [[ "$status" -ne 0 ]]; then
    rollback_failed_deployment "$status" || true
  fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Deploying $IMAGE to inactive color $INACTIVE_COLOR (active: $ACTIVE_COLOR)"
"$ROOT_DIR/environment.sh" up "$INACTIVE_COLOR" "$IMAGE"
"$ROOT_DIR/migrations-compatible.sh"
if [[ -n "${MIGRATION_COMMAND:-}" ]]; then MIGRATION_APPLIED=2; fi
if "$ROOT_DIR/migrate-and-rollback.sh" apply; then
  if [[ -n "${MIGRATION_COMMAND:-}" ]]; then MIGRATION_APPLIED=1; fi
else
  migration_status="$?"
  if [[ "$migration_status" == 80 ]]; then
    MIGRATION_APPLIED=0
  elif [[ -z "${MIGRATION_ROLLBACK_COMMAND:-}" ]]; then
    MIGRATION_APPLIED=0
  fi
  exit "$migration_status"
fi

for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null; then
    break
  fi
  if [[ "$attempt" == "$HEALTH_ATTEMPTS" ]]; then
    echo 'Candidate health check failed' >&2
    exit 1
  fi
  sleep "$HEALTH_INTERVAL"
done
curl --fail --silent --show-error "$SMOKE_URL" >/dev/null
"$ROOT_DIR/monitor-cutover.sh" preflight
CUTOVER_ATTEMPTED=1
"$ROOT_DIR/traffic-switch.sh" "$INACTIVE_COLOR" "$ROUTER_CONFIG"
write_active_color "$INACTIVE_COLOR"
"$ROOT_DIR/monitor-cutover.sh" postflight

trap - EXIT
echo "Promoted $INACTIVE_COLOR; previous environment $ACTIVE_COLOR remains available for rollback."
