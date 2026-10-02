#!/usr/bin/env bash
# CDN performance report for the frontend hostname, from Cloudflare's GraphQL
# Analytics API: cache hit ratio, bandwidth offload, edge TTFB, top PoPs and
# countries.
#
#   metrics.sh [hours] [--json <file>]
#
# hours defaults to 24. The adaptive dataset's lookback window depends on
# the zone's plan (1 day on Free, longer on paid plans).
set -euo pipefail
source "$(dirname "$0")/common.sh"

require_env CLOUDFLARE_ZONE_ID CLOUDFLARE_API_TOKEN FRONTEND_URL
require_cmd curl jq

hours=24
json_out=""
while (($#)); do
  case "$1" in
    --json) json_out="$2"; shift ;;
    *) hours="$1" ;;
  esac
  shift
done

until_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
since_ts=$(date -u -d "-$hours hours" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
  || date -u -v-"$hours"H +%Y-%m-%dT%H:%M:%SZ)

read -r -d '' QUERY <<'GRAPHQL' || true
query ($zone: String!, $filter: ZoneHttpRequestsAdaptiveGroupsFilter_InputObject!) {
  viewer {
    zones(filter: { zoneTag: $zone }) {
      byCache: httpRequestsAdaptiveGroups(limit: 20, filter: $filter) {
        count
        dimensions { cacheStatus }
        sum { edgeResponseBytes }
      }
      latency: httpRequestsAdaptiveGroups(limit: 1, filter: $filter) {
        count
        avg { edgeTimeToFirstByteMs originResponseDurationMs }
        quantiles { edgeTimeToFirstByteMsP50 edgeTimeToFirstByteMsP95 edgeTimeToFirstByteMsP99 }
      }
      byColo: httpRequestsAdaptiveGroups(limit: 10, filter: $filter, orderBy: [count_DESC]) {
        count
        dimensions { coloCode }
        avg { edgeTimeToFirstByteMs }
      }
      byCountry: httpRequestsAdaptiveGroups(limit: 10, filter: $filter, orderBy: [count_DESC]) {
        count
        dimensions { clientCountryName }
      }
    }
  }
}
GRAPHQL

body=$(jq -n --arg q "$QUERY" --arg zone "$CLOUDFLARE_ZONE_ID" \
  --arg host "$APP_HOSTNAME" --arg since "$since_ts" --arg until "$until_ts" '{
  query: $q,
  variables: {
    zone: $zone,
    filter: { clientRequestHTTPHost: $host, datetime_geq: $since, datetime_lt: $until }
  }
}')

resp=$(curl -sS https://api.cloudflare.com/client/v4/graphql \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$body")

if [[ "$(echo "$resp" | jq '.errors | length // 0')" != "0" ]]; then
  die "GraphQL error: $(echo "$resp" | jq -c '.errors')"
fi

zone=$(echo "$resp" | jq '.data.viewer.zones[0]')
[[ -n "$json_out" ]] && echo "$zone" > "$json_out"

echo "CDN metrics for $APP_HOSTNAME — last ${hours}h ($since_ts → $until_ts)"
echo
echo "$zone" | jq -r '
  def pct(a; b): if b == 0 then "n/a" else ((a / b * 1000 | round) / 10 | tostring) + "%" end;
  def mb(x): ((x / 1048576 * 10 | round) / 10 | tostring) + " MB";
  (.byCache | map(.count) | add // 0) as $total
  | (.byCache | map(select(.dimensions.cacheStatus == "hit" or .dimensions.cacheStatus == "revalidated")) | map(.count) | add // 0) as $hits
  | (.byCache | map(.sum.edgeResponseBytes) | add // 0) as $bytes
  | (.byCache | map(select(.dimensions.cacheStatus == "hit" or .dimensions.cacheStatus == "revalidated")) | map(.sum.edgeResponseBytes) | add // 0) as $cachedBytes
  | "Requests:          \($total)",
    "Cache hit ratio:   \(pct($hits; $total))",
    "Bandwidth served:  \(mb($bytes))",
    "Bandwidth offload: \(pct($cachedBytes; $bytes)) served from cache",
    "",
    "Edge TTFB (ms):    avg \(.latency[0].avg.edgeTimeToFirstByteMs // "n/a")  p50 \(.latency[0].quantiles.edgeTimeToFirstByteMsP50 // "n/a")  p95 \(.latency[0].quantiles.edgeTimeToFirstByteMsP95 // "n/a")  p99 \(.latency[0].quantiles.edgeTimeToFirstByteMsP99 // "n/a")",
    "Origin avg:        \(.latency[0].avg.originResponseDurationMs // "n/a") ms",
    "",
    "Cache status breakdown:",
    (.byCache | sort_by(-.count)[] | "  \(.dimensions.cacheStatus | .[0:14] + (" " * (14 - length)))\(.count)"),
    "",
    "Top PoPs:",
    (.byColo[] | "  \(.dimensions.coloCode)  \(.count) req  avg TTFB \(.avg.edgeTimeToFirstByteMs) ms"),
    "",
    "Top countries:",
    (.byCountry[] | "  \(.dimensions.clientCountryName)  \(.count) req")'
