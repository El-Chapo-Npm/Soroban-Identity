#!/usr/bin/env bash
set -Eeuo pipefail

# Deploy an image to the inactive color, validate it, then atomically switch the
# load balancer. The previous color remains available for instant rollback.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COLOR_FILE="${COLOR_FILE:-$ROOT_DIR/active-color}"
ACTIVE_COLOR="$(cat "$COLOR_FILE" 2>/dev/null || echo blue)"
[[ "$ACTIVE_COLOR" == blue || "$ACTIVE_COLOR" == green ]] || { echo "Invalid active color" >&2; exit 2; }
INACTIVE_COLOR=$([[ "$ACTIVE_COLOR" == blue ]] && echo green || echo blue)
IMAGE="${IMAGE:?Set IMAGE to the immutable image tag}"
HEALTH_URL="${HEALTH_URL:?Set HEALTH_URL to the candidate health endpoint}"
SMOKE_URL="${SMOKE_URL:-${HEALTH_URL%/health}/info}"
ROUTER_CONFIG="${ROUTER_CONFIG:-$ROOT_DIR/router.conf}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"

rollback() {
  echo "Deployment failed; keeping traffic on $ACTIVE_COLOR and stopping $INACTIVE_COLOR" >&2
  "$ROOT_DIR/traffic-switch.sh" "$ACTIVE_COLOR" "$ROUTER_CONFIG" || true
  "$ROOT_DIR/environment.sh" stop "$INACTIVE_COLOR" || true
}
trap rollback ERR

"$ROOT_DIR/environment.sh" up "$INACTIVE_COLOR" "$IMAGE"
"$ROOT_DIR/migrations-compatible.sh"

for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null; then break; fi
  [[ "$attempt" == "$HEALTH_ATTEMPTS" ]] && { echo "Candidate health check failed" >&2; exit 1; }
  sleep "$HEALTH_INTERVAL"
done
curl --fail --silent --show-error "$SMOKE_URL" >/dev/null
"$ROOT_DIR/monitor-cutover.sh" preflight
"$ROOT_DIR/traffic-switch.sh" "$INACTIVE_COLOR" "$ROUTER_CONFIG"
printf '%s\n' "$INACTIVE_COLOR" > "$COLOR_FILE"
"$ROOT_DIR/monitor-cutover.sh" postflight
trap - ERR
echo "Promoted $INACTIVE_COLOR; previous environment $ACTIVE_COLOR is available for rollback."
