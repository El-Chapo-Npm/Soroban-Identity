#!/usr/bin/env bash
# Invalidate the zone cache for the frontend after a deploy.
#
#   purge-cache.sh           purge the HTML entry point and non-hashed public files
#   purge-cache.sh --all     purge everything in the zone (last resort)
#
# Cloudflare Pages purges its own cache when a deployment is published, but
# responses cached under the custom hostname (cache rules, worker subrequests)
# are not. Hashed files under /assets/ never need purging: new content gets a
# new URL. The list of non-hashed files is taken from the build output.
set -euo pipefail
source "$(dirname "$0")/common.sh"

require_env CLOUDFLARE_ZONE_ID CLOUDFLARE_API_TOKEN FRONTEND_URL
require_cmd curl jq

# Cloudflare accepts at most 30 URLs per purge request on Free/Pro plans.
BATCH_SIZE=30

purge() {
  local body="$1" resp
  resp=$(cf_api POST "/zones/$CLOUDFLARE_ZONE_ID/purge_cache" "$body")
  echo "$resp" | jq -e '.success' >/dev/null \
    || die "purge failed: $(echo "$resp" | jq -c '.errors')"
}

if [[ "${1:-}" == "--all" ]]; then
  log "Purging entire zone cache"
  purge '{"purge_everything": true}'
  exit 0
fi

urls=("$FRONTEND_URL/" "$FRONTEND_URL/index.html")
if [[ -d "$DIST_DIR" ]]; then
  while IFS= read -r path; do
    urls+=("$FRONTEND_URL/$path")
  done < <(cd "$DIST_DIR" && find . -type f \
    ! -path "./assets/*" ! -path "./.vite/*" ! -name "*.html" ! -name "*.br" ! -name "*.gz" \
    ! -name "_headers" ! -name "_redirects" ! -name "*.json" \
    | sed 's|^\./||' | sort)
else
  warn "$DIST_DIR not found; purging only the HTML entry point"
fi

log "Purging ${#urls[@]} URL(s)"
for ((i = 0; i < ${#urls[@]}; i += BATCH_SIZE)); do
  batch=("${urls[@]:i:BATCH_SIZE}")
  purge "$(printf '%s\n' "${batch[@]}" | jq -R . | jq -s '{files: .}')"
  printf '  %s\n' "${batch[@]}"
done
log "Purge complete"
