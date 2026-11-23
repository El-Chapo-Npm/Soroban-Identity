#!/usr/bin/env bash
set -Eeuo pipefail
color="${1:?blue|green}"
config="${2:?router config path}"
[[ "$color" == blue || "$color" == green ]] || exit 2
[[ -f "$config" ]] || { echo "Router configuration not found: $config" >&2; exit 2; }
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COLOR_FILE="${COLOR_FILE:-$ROOT_DIR/active-color}"
ACTIVE_UPSTREAM_CONFIG="${ACTIVE_UPSTREAM_CONFIG:-$ROOT_DIR/nginx/active-upstream.conf}"
previous_color="$(sed -n 's/^active=\(blue\|green\)$/\1/p' "$config" | head -n 1)"
[[ "$previous_color" == blue || "$previous_color" == green ]] || {
  echo "No valid active color in $config" >&2
  exit 2
}

write_active_color() {
  local target="$1" temporary
  temporary="$(mktemp "${config}.tmp.XXXXXX")"
  sed -e "s/^active=.*/active=$target/" "$config" > "$temporary"
  chmod --reference="$config" "$temporary"
  mv -f "$temporary" "$config"
}

write_upstream() {
  local target="$1" temporary
  mkdir -p "$(dirname "$ACTIVE_UPSTREAM_CONFIG")"
  temporary="$(mktemp "${ACTIVE_UPSTREAM_CONFIG}.tmp.XXXXXX")"
  cat > "$temporary" <<EOF
upstream soroban_active {
  server $target:3001;
  keepalive 32;
}
EOF
  chmod 644 "$temporary"
  mv -f "$temporary" "$ACTIVE_UPSTREAM_CONFIG"
}

write_color_state() {
  local target="$1" temporary
  mkdir -p "$(dirname "$COLOR_FILE")"
  temporary="$(mktemp "${COLOR_FILE}.tmp.XXXXXX")"
  printf '%s\n' "$target" > "$temporary"
  chmod 600 "$temporary"
  mv -f "$temporary" "$COLOR_FILE"
}

reload_router() {
  if [[ -n "${TRAFFIC_RELOAD_COMMAND:-}" ]]; then
    bash -Eeuo pipefail -c "$TRAFFIC_RELOAD_COMMAND"
  else
    docker compose -f "$ROOT_DIR/docker-compose.yml" \
      -p "${COMPOSE_PROJECT:-soroban-identity}" exec -T router nginx -s reload
  fi
}

# The Nginx upstream include is separate from router.conf's regional route
# metadata. Both files are replaced before a graceful reload is requested.
write_active_color "$color"
write_upstream "$color"

reload_status=0
reload_router || reload_status=$?
if [[ "$reload_status" == 0 ]]; then
  if write_color_state "$color"; then exit 0; fi
  reload_status=1
fi

# A failed reload leaves the running router on its previously loaded upstream.
# Restore the files to match that still-active color before returning failure.
echo "Router reload failed; restoring its previous $previous_color upstream" >&2
write_active_color "$previous_color" || true
write_upstream "$previous_color" || true
reload_router || echo 'Router reload also failed while restoring the previous upstream.' >&2
exit "$reload_status"
