#!/usr/bin/env bash
# Build the frontend, upload static assets to R2 (fronted by Cloudflare CDN)
# with cache headers, then purge the Cloudflare cache for index.html.
#
# Required env: R2_BUCKET, R2_ENDPOINT, CDN_BASE_URL, CF_ZONE_ID, CF_API_TOKEN
# (plus AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY for the R2 S3 API)
set -euo pipefail

: "${R2_BUCKET:?}" "${R2_ENDPOINT:?}" "${CDN_BASE_URL:?}" "${CF_ZONE_ID:?}" "${CF_API_TOKEN:?}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="$ROOT/frontend/dist"

(cd "$ROOT/frontend" && npm ci && CDN_BASE_URL="$CDN_BASE_URL" npm run build)

s3() { aws s3 "$@" --endpoint-url "$R2_ENDPOINT"; }

# Hashed bundles, fonts, images: immutable, cached 1 year
s3 sync "$DIST/assets" "s3://$R2_BUCKET/assets" \
  --cache-control "public, max-age=31536000, immutable"

# Everything else (index.html, favicon, …): always revalidate
s3 sync "$DIST" "s3://$R2_BUCKET" --exclude "assets/*" \
  --cache-control "public, max-age=0, must-revalidate" --delete

# Invalidate non-hashed entry points on deploy
curl -fsS -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" \
  --data "{\"files\":[\"${CDN_BASE_URL%/}/\",\"${CDN_BASE_URL%/}/index.html\"]}"

echo "Deployed to $CDN_BASE_URL"
