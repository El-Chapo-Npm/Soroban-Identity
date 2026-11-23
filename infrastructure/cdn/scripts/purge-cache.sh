#!/usr/bin/env bash
# Invalidate the zone cache for the frontend after a deploy, or on demand from
# the cache invalidation pipeline.
#
#   purge-cache.sh                       purge the HTML entry point and non-hashed public files
#   purge-cache.sh --all                 purge everything in the zone (last resort)
#   purge-cache.sh --urls <file|->       purge an explicit list of URLs (one per line)
#   purge-cache.sh --tags <file|->       purge by cache tags (one per line)
#   purge-cache.sh --url <url>           purge a single URL (repeatable)
#   purge-cache.sh --tag <tag>           purge a single cache tag (repeatable)
#   purge-cache.sh --json                emit a machine-readable result (for the invalidation module)
#
# Cloudflare Pages purges its own cache when a deployment is published, but
# responses cached under the custom hostname (cache rules, worker subrequests)
# are not. Hashed files under /assets/ never need purging: new content gets a
# new URL. The list of non-hashed files is taken from the build output.
#
# The cache invalidation pipeline invokes this script programmatically, e.g.:
#   purge-cache.sh --urls - --json < urls.txt
#   purge-cache.sh --tags - --json < tags.txt
# Exit codes: 0 success, 1 usage/config error, 2 purge failure.
set -euo pipefail
source "$(dirname "$0")/common.sh"

require_env CLOUDFLARE_ZONE_ID CLOUDFLARE_API_TOKEN FRONTEND_URL
require_cmd curl jq

# Cloudflare accepts at most 30 URLs per purge request on Free/Pro plans.
BATCH_SIZE=30
# Cloudflare accepts at most 30 tags per purge request.
TAG_BATCH_SIZE=30

MODE="default"
JSON_OUTPUT=0
declare -a EXPLICIT_URLS=()
declare -a EXPLICIT_TAGS=()
URLS_SOURCE=""
TAGS_SOURCE=""

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

# Read newline-separated values from a file or stdin ("-"), trimming blanks.
read_list() {
  local src="$1"
  if [[ "$src" == "-" ]]; then
    cat
  elif [[ -f "$src" ]]; then
    cat "$src"
  else
    die "list file not found: $src"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      MODE="all"
      shift
      ;;
    --urls)
      [[ $# -ge 2 ]] || die "--urls requires a file path or -"
      URLS_SOURCE="$2"
      MODE="urls"
      shift 2
      ;;
    --tags)
      [[ $# -ge 2 ]] || die "--tags requires a file path or -"
      TAGS_SOURCE="$2"
      MODE="tags"
      shift 2
      ;;
    --url)
      [[ $# -ge 2 ]] || die "--url requires a value"
      EXPLICIT_URLS+=("$2")
      MODE="urls"
      shift 2
      ;;
    --tag)
      [[ $# -ge 2 ]] || die "--tag requires a value"
      EXPLICIT_TAGS+=("$2")
      MODE="tags"
      shift 2
      ;;
    --json)
      JSON_OUTPUT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1 (see --help)"
      ;;
  esac
done

purge() {
  local body="$1" resp
  resp=$(cf_api POST "/zones/$CLOUDFLARE_ZONE_ID/purge_cache" "$body")
  echo "$resp" | jq -e '.success' >/dev/null \
    || die "purge failed: $(echo "$resp" | jq -c '.errors')"
}

emit_result() {
  local kind="$1" count="$2"
  if [[ "$JSON_OUTPUT" -eq 1 ]]; then
    jq -n --arg kind "$kind" --argjson count "$count" \
      '{success: true, mode: $kind, purged: $count}'
  fi
}

if [[ "$MODE" == "all" ]]; then
  log "Purging entire zone cache"
  purge '{"purge_everything": true}'
  emit_result "all" 1
  exit 0
fi

# --- Tag-based purge (preferred for API responses / public data) -------------
if [[ "$MODE" == "tags" ]]; then
  declare -a tags=("${EXPLICIT_TAGS[@]}")
  if [[ -n "$TAGS_SOURCE" ]]; then
    while IFS= read -r tag; do
      tag="${tag%$'\r'}"
      [[ -z "$tag" ]] && continue
      tags+=("$tag")
    done < <(read_list "$TAGS_SOURCE")
  fi
  if [[ ${#tags[@]} -eq 0 ]]; then
    die "no cache tags provided"
  fi
  log "Purging ${#tags[@]} cache tag(s)"
  for ((i = 0; i < ${#tags[@]}; i += TAG_BATCH_SIZE)); do
    batch=("${tags[@]:i:TAG_BATCH_SIZE}")
    purge "$(printf '%s\n' "${batch[@]}" | jq -R . | jq -s '{tags: .}')"
    printf '  %s\n' "${batch[@]}"
  done
  log "Purge complete"
  emit_result "tags" "${#tags[@]}"
  exit 0
fi

# --- URL-based purge ---------------------------------------------------------
declare -a urls=("${EXPLICIT_URLS[@]}")
if [[ -n "$URLS_SOURCE" ]]; then
  while IFS= read -r url; do
    url="${url%$'\r'}"
    [[ -z "$url" ]] && continue
    urls+=("$url")
  done < <(read_list "$URLS_SOURCE")
fi

if [[ ${#urls[@]} -eq 0 ]]; then
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
fi

log "Purging ${#urls[@]} URL(s)"
for ((i = 0; i < ${#urls[@]}; i += BATCH_SIZE)); do
  batch=("${urls[@]:i:BATCH_SIZE}")
  purge "$(printf '%s\n' "${batch[@]}" | jq -R . | jq -s '{files: .}')"
  printf '  %s\n' "${batch[@]}"
done
log "Purge complete"
emit_result "urls" "${#urls[@]}"
```

Note: the step also mentions "add cache-control header configuration for API responses (public data) to support L3 caching." That configuration belongs in the CDN `_headers`/cache-rules files rather than this purge script; the script now supports tag-based invalidation so the invalidation pipeline can target those API responses (e.g. `--tag api-public`) once the cache rules tag them.