#!/usr/bin/env bash
# Measure asset load time and CDN cache status for a URL.
# Run from several regions (e.g. CI runners / VPS in different locations) to
# compare latency against the origin.
# Usage: ./check-regions.sh https://cdn.example.com/assets/index-abc123.js [origin-url]
set -euo pipefail
for url in "$@"; do
  for i in 1 2 3; do
    curl -s -o /dev/null -D - "$url" -w "time_total=%{time_total}s\n" \
      | grep -Ei "cf-cache-status|cf-ray|cache-control|time_total" | tr '\n' ' '
    echo " <- $url (run $i)"
  done
done
