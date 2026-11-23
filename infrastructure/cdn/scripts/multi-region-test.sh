#!/usr/bin/env bash
# Fetch a frontend asset from probes on every continent (via the Globalping
# API) and report status, cache status, serving PoP and timings.
#
#   multi-region-test.sh [asset-path] [probes-per-region]
#
# asset-path defaults to the first JS bundle referenced by the live index.html.
# Two rounds run: the first warms each PoP's cache, the second is reported
# and is expected to be all HITs. Exits non-zero on any non-200 response.
set -euo pipefail
source "$(dirname "$0")/common.sh"

require_env FRONTEND_URL
require_cmd curl jq

REGIONS=("North America" "South America" "Europe" "Asia" "Oceania" "Africa")
API="https://api.globalping.io/v1/measurements"

asset_path="${1:-}"
per_region="${2:-2}"

if [[ -z "$asset_path" ]]; then
  asset_path=$(first_asset_path) || true
  [[ -n "$asset_path" ]] || die "no /assets/ script found in $FRONTEND_URL/ — pass an asset path"
fi

auth=()
[[ -n "${GLOBALPING_TOKEN:-}" ]] && auth=(-H "Authorization: Bearer $GLOBALPING_TOKEN")

run_measurement() {
  local locations body id resp
  locations=$(printf '%s\n' "${REGIONS[@]}" \
    | jq -R --argjson n "$per_region" '{magic: ., limit: $n}' | jq -s .)
  body=$(jq -n --arg host "$APP_HOSTNAME" --arg path "$asset_path" --argjson loc "$locations" '{
    type: "http",
    target: $host,
    locations: $loc,
    measurementOptions: { protocol: "HTTPS", request: { method: "GET", path: $path } }
  }')

  id=$(curl -sS -X POST "$API" -H "Content-Type: application/json" "${auth[@]}" --data "$body" | jq -r '.id // empty')
  [[ -n "$id" ]] || die "Globalping rejected the measurement (rate limited? set GLOBALPING_TOKEN)"

  for _ in $(seq 1 60); do
    resp=$(curl -sS "$API/$id" "${auth[@]}")
    [[ "$(echo "$resp" | jq -r .status)" != "in-progress" ]] && { echo "$resp"; return; }
    sleep 1
  done
  die "measurement $id did not finish in time"
}

log "Warm-up round: $FRONTEND_URL$asset_path"
run_measurement >/dev/null

log "Measured round"
result=$(run_measurement)

echo
echo "$result" | jq -r '
  ["REGION", "LOCATION", "STATUS", "CACHE", "POP", "TTFB_MS", "TOTAL_MS"],
  (.results[] | [
    .probe.continent,
    "\(.probe.city), \(.probe.country)",
    (.result.statusCode // "ERR" | tostring),
    (.result.headers["cf-cache-status"] // "-"),
    ((.result.headers["cf-ray"] // "-") | split("-") | last),
    (.result.timings.firstByte // "-" | tostring),
    (.result.timings.total // "-" | tostring)
  ]) | @tsv' | column -t -s $'\t'

echo
echo "$result" | jq -r '
  [.results[].result] as $r
  | ($r | map(select(.statusCode == 200)) | length) as $ok
  | ($r | map(select(.headers["cf-cache-status"] == "HIT")) | length) as $hits
  | ($r | map(.timings.firstByte // empty) | sort) as $ttfb
  | def pct(p): if ($ttfb | length) == 0 then "n/a"
      else $ttfb[((($ttfb | length) - 1) * p | floor)] | tostring end;
  "probes: \($r | length)  ok: \($ok)  cache hits: \($hits)",
  "TTFB ms  p50: \(pct(0.5))  p90: \(pct(0.9))  max: \(pct(1))"'

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### CDN multi-region test: \`$asset_path\`"
    echo
    echo "| Region | Location | Status | Cache | PoP | TTFB ms | Total ms |"
    echo "|---|---|---|---|---|---|---|"
    echo "$result" | jq -r '.results[] | "| \(.probe.continent) | \(.probe.city), \(.probe.country) | \(.result.statusCode // "ERR") | \(.result.headers["cf-cache-status"] // "-") | \((.result.headers["cf-ray"] // "-") | split("-") | last) | \(.result.timings.firstByte // "-") | \(.result.timings.total // "-") |"'
  } >> "$GITHUB_STEP_SUMMARY"
fi

bad=$(echo "$result" | jq '[.results[].result | select(.statusCode != 200)] | length')
((bad == 0)) || die "$bad probe(s) did not get HTTP 200"
