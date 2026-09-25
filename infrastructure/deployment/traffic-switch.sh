#!/usr/bin/env bash
set -Eeuo pipefail
color="${1:?blue|green}"; config="${2:?router config path}"
[[ "$color" == blue || "$color" == green ]] || exit 2
sed -e "s/^active=.*/active=$color/" "$config" > "$config.tmp"
mv "$config.tmp" "$config"
# Reload is intentionally injectable for nginx, Envoy, or a cloud load balancer.
if [[ -n "${TRAFFIC_RELOAD_COMMAND:-}" ]]; then eval "$TRAFFIC_RELOAD_COMMAND"; fi
