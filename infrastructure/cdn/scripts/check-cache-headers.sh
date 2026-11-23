#!/usr/bin/env bash
# Verify the live cache policy after a deploy:
#   - the HTML entry point must revalidate (max-age=0)
#   - hashed assets must be cacheable for a year and immutable
#   - every asset referenced by index.html must return 200
set -euo pipefail
source "$(dirname "$0")/common.sh"

require_env FRONTEND_URL
require_cmd curl

failed=0

header() { # url name
  curl -fsS -o /dev/null -D - "$1" | tr -d '\r' | awk -v h="$(echo "$2" | tr 'A-Z' 'a-z')" -F': ' 'tolower($1) == h { print $2 }' | tail -1
}

check() { # label url expected-substring
  local cc status
  cc=$(header "$2" cache-control)
  status=$(header "$2" cf-cache-status)
  if [[ "$cc" == *"$3"* ]]; then
    printf '  ok    %-10s %-60s %s [%s]\n' "$1" "$2" "$cc" "${status:--}"
  else
    printf '  FAIL  %-10s %-60s %s (expected %s)\n' "$1" "$2" "${cc:-<none>}" "$3"
    failed=1
  fi
}

log "Cache policy for $FRONTEND_URL"
check "html" "$FRONTEND_URL/" "$EXPECT_HTML"

assets=$(curl -fsS "$FRONTEND_URL/" | grep -oE '/assets/[^"'"'"' ]+\.(js|css)' | sort -u)
[[ -n "$assets" ]] || die "no /assets/ references found in index.html"
while IFS= read -r path; do
  check "asset" "$FRONTEND_URL$path" "$EXPECT_HASHED"
  [[ "$(header "$FRONTEND_URL$path" cache-control)" == *immutable* ]] || { warn "$path is not marked immutable"; failed=1; }
done <<< "$assets"

((failed == 0)) || die "cache policy check failed"
log "Cache policy OK"
