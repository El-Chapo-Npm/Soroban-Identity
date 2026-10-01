#!/usr/bin/env bash
# Post-recovery verification (#945). Exits non-zero on the first failed check.
#
# Usage:
#   verify-recovery.sh --url https://api.example.com [--expect-credentials N] [--api-key KEY]
#   verify-recovery.sh --check-backup-age [--bucket B] [--max-age-minutes 60]
set -euo pipefail

URL=""
EXPECT_CREDENTIALS=""
API_KEY="${VERIFY_API_KEY:-}"
CHECK_BACKUP_AGE=0
BUCKET="${DR_BACKUP_BUCKET_SECONDARY:-}"
MAX_AGE_MINUTES="${DR_RPO_MINUTES:-60}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --url) URL="${2%/}"; shift 2 ;;
    --expect-credentials) EXPECT_CREDENTIALS="$2"; shift 2 ;;
    --api-key) API_KEY="$2"; shift 2 ;;
    --check-backup-age) CHECK_BACKUP_AGE=1; shift ;;
    --bucket) BUCKET="$2"; shift 2 ;;
    --max-age-minutes) MAX_AGE_MINUTES="$2"; shift 2 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

pass() { printf '  ok    %s\n' "$*"; }
fail() { printf '  FAIL  %s\n' "$*" >&2; exit 1; }

# Prints the age in minutes of the newest archive in the bucket.
backup_age_minutes() {
  local newest
  newest="$(aws s3api list-objects-v2 --bucket "$BUCKET" --prefix archives/ \
    --query 'sort_by(Contents[?ends_with(Key, `.tar.gz`)], &LastModified)[-1].LastModified' --output text)"
  [[ -n "$newest" && "$newest" != "None" ]] || return 1
  echo $(( ( $(date -u +%s) - $(date -u -d "$newest" +%s) ) / 60 ))
}

if [[ "$CHECK_BACKUP_AGE" -eq 1 ]]; then
  [[ -n "$BUCKET" ]] || fail "--bucket or DR_BACKUP_BUCKET_SECONDARY required"
  echo "Checking backup freshness in s3://$BUCKET (RPO ${MAX_AGE_MINUTES}m)"
  age="$(backup_age_minutes)" || fail "no archives found"
  (( age <= MAX_AGE_MINUTES )) || fail "newest archive is ${age}m old (> ${MAX_AGE_MINUTES}m RPO)"
  pass "newest archive is ${age}m old"
  [[ -z "$URL" ]] && exit 0
fi

[[ -n "$URL" ]] || fail "--url is required"
echo "Verifying $URL"

auth=()
[[ -n "$API_KEY" ]] && auth=(-H "X-API-Key: $API_KEY")

for path in /live /ready /health /info; do
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$URL$path")"
  [[ "$code" == "200" ]] || fail "GET $path returned $code"
  pass "GET $path → 200"
done

headers="$(curl -s -D - -o /dev/null -m 10 "$URL/info")"
grep -qi '^x-correlation-id:' <<<"$headers" || fail "responses are missing X-Correlation-ID"
pass "X-Correlation-ID present"

body="$(curl -fsS -m 20 "${auth[@]}" "$URL/credentials?limit=1")" || fail "GET /credentials failed"
if command -v jq >/dev/null 2>&1; then
  total="$(jq -r '.pagination.total_count // .data.pagination.total_count // empty' <<<"$body")"
  [[ -n "$total" ]] || fail "GET /credentials has no pagination.total_count"
  pass "credentials total_count = $total"
  if [[ -n "$EXPECT_CREDENTIALS" ]]; then
    (( total >= EXPECT_CREDENTIALS )) || fail "expected at least $EXPECT_CREDENTIALS credentials, found $total"
    pass "credential count ≥ $EXPECT_CREDENTIALS"
  fi
else
  pass "GET /credentials → 200 (install jq to check counts)"
fi

echo "Recovery verified."
