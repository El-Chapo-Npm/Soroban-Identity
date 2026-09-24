#!/usr/bin/env bash
set -Eeuo pipefail
phase="${1:?preflight|postflight}"
if [[ -n "${DEPLOYMENT_MONITOR_COMMAND:-}" ]]; then
  DEPLOYMENT_PHASE="$phase" eval "$DEPLOYMENT_MONITOR_COMMAND"
fi
if [[ "$phase" == postflight && -n "${ERROR_RATE_URL:-}" ]]; then
  payload=$(curl --fail --silent "$ERROR_RATE_URL")
  node -e 'const p=JSON.parse(process.argv[1]); if (p.errorRate > Number(process.env.ERROR_RATE_THRESHOLD || 0.02)) process.exit(1)' "$payload"
fi
