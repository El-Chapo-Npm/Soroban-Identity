#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$TMP_DIR/bin" "$TMP_DIR/nginx"
export TEST_LOG="$TMP_DIR/commands.log"
: > "$TEST_LOG"

cat > "$TMP_DIR/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf 'docker %s\n' "$*" >> "$TEST_LOG"
STUB
cat > "$TMP_DIR/bin/curl" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$TMP_DIR/bin/docker" "$TMP_DIR/bin/curl"
export PATH="$TMP_DIR/bin:$PATH"

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_contains() {
  grep -Fq "$2" "$1" || fail "expected '$2' in $1"
}

# A partial migration must execute the operator-supplied down migration.
if MIGRATION_COMMAND='echo migrate-failed >> "$TEST_LOG"; exit 7' \
  MIGRATION_ROLLBACK_COMMAND='echo migrate-down >> "$TEST_LOG"' \
  "$ROOT_DIR/migrate-and-rollback.sh" apply >"$TMP_DIR/migration.out" 2>&1; then
  fail 'failed migration unexpectedly returned success'
fi
assert_contains "$TEST_LOG" 'migrate-failed'
assert_contains "$TEST_LOG" 'migrate-down'

# A migration must not start if rollback support is not configured.
: > "$TEST_LOG"
if MIGRATION_COMMAND='echo should-not-run >> "$TEST_LOG"' \
  "$ROOT_DIR/migrate-and-rollback.sh" apply >"$TMP_DIR/no-rollback.out" 2>&1; then
  fail 'migration without rollback support unexpectedly returned success'
fi
if grep -Fq 'should-not-run' "$TEST_LOG"; then fail 'migration ran without a rollback command'; fi

run_deployment() {
  local monitor_command="$1"
  local reload_command="${2:-echo nginx-reload >> \"\$TEST_LOG\"}"
  local rollback_command="${3:-echo migrate-down >> \"\$TEST_LOG\"}"
  IMAGE='registry.example/soroban-identity@sha256:test' \
  HEALTH_URL='http://127.0.0.1:3002/health' \
  SMOKE_URL='http://127.0.0.1:3002/info' \
  HEALTH_ATTEMPTS=1 HEALTH_INTERVAL=0 \
  COLOR_FILE="$TMP_DIR/active-color" \
  ROUTER_CONFIG="$TMP_DIR/router.conf" \
  ACTIVE_UPSTREAM_CONFIG="$TMP_DIR/nginx/active-upstream.conf" \
  DEPLOYMENT_LOCK_FILE="$TMP_DIR/deploy.lock" \
  COMPOSE_PROJECT='test-soroban-identity' \
  TRAFFIC_RELOAD_COMMAND="$reload_command" \
  MIGRATION_CHECK_COMMAND='true' \
  MIGRATION_COMMAND='echo migrate-up >> "$TEST_LOG"' \
  MIGRATION_ROLLBACK_COMMAND="$rollback_command" \
  DEPLOYMENT_MONITOR_COMMAND="$monitor_command" \
  "$ROOT_DIR/blue-green.sh" >"$TMP_DIR/deploy.out" 2>&1
}

cat > "$TMP_DIR/router.conf" <<'ROUTER'
active=blue
blue_upstream=http://127.0.0.1:3001
green_upstream=http://127.0.0.1:3002
ROUTER
: > "$TEST_LOG"
if run_deployment '[ "$DEPLOYMENT_PHASE" != postflight ]'; then
  fail 'postflight monitor failure unexpectedly promoted the candidate'
fi
[[ "$(cat "$TMP_DIR/active-color")" == blue ]] || fail 'failed deployment did not restore active-color'
grep -qx 'active=blue' "$TMP_DIR/router.conf" || fail 'failed deployment did not restore router state'
grep -Fq 'server blue:3001;' "$TMP_DIR/nginx/active-upstream.conf" || fail 'failed deployment did not restore Nginx upstream'
assert_contains "$TEST_LOG" 'migrate-up'
assert_contains "$TEST_LOG" 'migrate-down'
assert_contains "$TEST_LOG" 'nginx-reload'
assert_contains "$TEST_LOG" 'docker compose'

: > "$TEST_LOG"
if ! run_deployment 'true'; then
  cat "$TMP_DIR/deploy.out" >&2
  fail 'healthy deployment did not complete'
fi
[[ "$(cat "$TMP_DIR/active-color")" == green ]] || fail 'successful deployment did not promote green'
grep -qx 'active=green' "$TMP_DIR/router.conf" || fail 'successful deployment did not update router state'
grep -Fq 'server green:3001;' "$TMP_DIR/nginx/active-upstream.conf" || fail 'successful deployment did not update Nginx upstream'
assert_contains "$TEST_LOG" 'migrate-up'
assert_contains "$TEST_LOG" 'nginx-reload'

# Manual rollback must keep the state file in sync so the next deploy targets
# the actual inactive color.
COLOR_FILE="$TMP_DIR/active-color" \
ACTIVE_UPSTREAM_CONFIG="$TMP_DIR/nginx/active-upstream.conf" \
TRAFFIC_RELOAD_COMMAND='true' \
  "$ROOT_DIR/traffic-switch.sh" blue "$TMP_DIR/router.conf"
[[ "$(cat "$TMP_DIR/active-color")" == blue ]] || fail 'manual rollback did not update active-color'
COLOR_FILE="$TMP_DIR/active-color" \
ACTIVE_UPSTREAM_CONFIG="$TMP_DIR/nginx/active-upstream.conf" \
TRAFFIC_RELOAD_COMMAND='true' \
  "$ROOT_DIR/traffic-switch.sh" green "$TMP_DIR/router.conf"
[[ "$(cat "$TMP_DIR/active-color")" == green ]] || fail 'manual promotion did not update active-color'

# If the router cannot confirm reversion, retain the candidate and schema
# instead of stopping the live server or rolling its database backward.
: > "$TEST_LOG"
router_fails_on_second_reload='count=$(grep -Fc nginx-reload "$TEST_LOG" || true); echo nginx-reload >> "$TEST_LOG"; [ "$count" -eq 0 ]'
if run_deployment '[ "$DEPLOYMENT_PHASE" != postflight ]' "$router_fails_on_second_reload"; then
  fail 'postflight failure with a broken router rollback unexpectedly succeeded'
fi
[[ "$(cat "$TMP_DIR/active-color")" == blue ]] || fail 'failed router recovery did not keep candidate state'
grep -qx 'active=blue' "$TMP_DIR/router.conf" || fail 'failed router recovery did not preserve candidate route metadata'
grep -Fq 'server blue:3001;' "$TMP_DIR/nginx/active-upstream.conf" || fail 'failed router recovery did not preserve candidate upstream'
assert_contains "$TEST_LOG" 'migrate-up'
if grep -Fq 'migrate-down' "$TEST_LOG"; then fail 'schema rollback ran while traffic may still use the candidate'; fi
if grep -Fq 'stop blue' "$TEST_LOG"; then fail 'candidate was stopped while traffic may still use it'; fi

# If restoring the schema fails after traffic returned to the previous color,
# retain the candidate for recovery rather than stopping it.
: > "$TEST_LOG"
rollback_fails='echo migrate-down >> "$TEST_LOG"; exit 1'
if run_deployment '[ "$DEPLOYMENT_PHASE" != postflight ]' 'echo nginx-reload >> "$TEST_LOG"' "$rollback_fails"; then
  fail 'deployment with a failed migration rollback unexpectedly succeeded'
fi
[[ "$(cat "$TMP_DIR/active-color")" == blue ]] || fail 'migration rollback failure changed the active route'
grep -qx 'active=blue' "$TMP_DIR/router.conf" || fail 'migration rollback failure did not restore routing'
assert_contains "$TEST_LOG" 'migrate-down'
if grep -Fq 'stop green' "$TEST_LOG"; then fail 'candidate was stopped after a failed schema rollback'; fi

printf '%s\n' 'Blue-green and migration rollback tests passed.'
