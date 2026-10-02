#!/usr/bin/env bash
# Shared helpers for the CDN scripts. Source, don't execute.

CDN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$CDN_DIR/../.." && pwd)"
DIST_DIR="${DIST_DIR:-$REPO_ROOT/frontend/dist}"

if [[ -f "$CDN_DIR/cdn.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$CDN_DIR/cdn.env"
  set +a
fi

# Public URL of the deployed frontend, e.g. https://app.example.com
FRONTEND_URL="${FRONTEND_URL%/}"
APP_HOSTNAME="${FRONTEND_URL#*://}"
APP_HOSTNAME="${APP_HOSTNAME%%/*}"

# Expected policies, matching the `_headers` file from frontend/csp.config.ts.
EXPECT_HASHED="max-age=31536000"
EXPECT_HTML="max-age=0"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

require_env() {
  local missing=()
  for name in "$@"; do
    [[ -n "${!name:-}" ]] || missing+=("$name")
  done
  ((${#missing[@]} == 0)) || die "missing env: ${missing[*]} (see infrastructure/cdn/cdn.env.example)"
}

require_cmd() {
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' is required but not installed"
  done
}

cf_api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS -X "$method" "https://api.cloudflare.com/client/v4$path"
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
    -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(--data "$body")
  curl "${args[@]}"
}

# First JS bundle referenced by the live index.html, as a path (/assets/…).
first_asset_path() {
  curl -fsS "$FRONTEND_URL/" | grep -oE '/assets/[^"'"'"' ]+\.js' | head -1
}
