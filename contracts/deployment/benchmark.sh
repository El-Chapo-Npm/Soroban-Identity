#!/usr/bin/env bash
# Benchmark deployment cost drivers for Soroban Identity contracts (#949).
#
# Upload fees scale with the number of WASM bytes written to the ledger, so
# the main number to track is the size of each uploaded WASM. This script
# builds the contracts, optimizes them, and reports raw vs. optimized sizes
# plus the number of transactions a fresh deploy and a re-run each need.
#
# Usage:
#   contracts/deployment/benchmark.sh              # human-readable table
#   contracts/deployment/benchmark.sh --json       # JSON, e.g. for CI artifacts
#   SKIP_BUILD=1 contracts/deployment/benchmark.sh # reuse existing build
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RELEASE_DIR="$ROOT/contracts/target/wasm32-unknown-unknown/release"
CONTRACTS=(identity_registry credential_manager reputation)
JSON=0
[[ "${1:-}" == "--json" ]] && JSON=1

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  (cd "$ROOT/contracts" && cargo build --target wasm32-unknown-unknown --release >&2)
fi

size_of() { stat -c%s "$1" 2>/dev/null || stat -f%z "$1"; }

rows=()
total_raw=0
total_opt=0
for name in "${CONTRACTS[@]}"; do
  raw="$RELEASE_DIR/$name.wasm"
  opt="$RELEASE_DIR/$name.optimized.wasm"
  [[ -f "$raw" ]] || { echo "missing $raw" >&2; exit 1; }
  if ! stellar contract optimize --wasm "$raw" --wasm-out "$opt" >/dev/null 2>&1; then
    opt="$raw"
  fi
  r=$(size_of "$raw")
  o=$(size_of "$opt")
  total_raw=$((total_raw + r))
  total_opt=$((total_opt + o))
  rows+=("$name $r $o")
done

# Transactions per deployment. Legacy flow: 3 x (upload+deploy) + 3 x init,
# with every WASM re-uploaded on each run. Optimized flow: uploads and deploys
# are skipped when the code hash / deterministic address already exists.
legacy_fresh=9; optimized_fresh=9
legacy_rerun=9; optimized_rerun=0

if [[ $JSON == 1 ]]; then
  printf '{\n  "contracts": [\n'
  for i in "${!rows[@]}"; do
    read -r n r o <<<"${rows[$i]}"
    sep=","; [[ $i -eq $((${#rows[@]} - 1)) ]] && sep=""
    printf '    {"name": "%s", "rawBytes": %d, "optimizedBytes": %d}%s\n' "$n" "$r" "$o" "$sep"
  done
  printf '  ],\n  "totalRawBytes": %d,\n  "totalOptimizedBytes": %d,\n' "$total_raw" "$total_opt"
  printf '  "transactions": {"legacyFresh": %d, "optimizedFresh": %d, "legacyRerun": %d, "optimizedRerun": %d}\n}\n' \
    "$legacy_fresh" "$optimized_fresh" "$legacy_rerun" "$optimized_rerun"
else
  printf '%-22s %12s %12s %8s\n' contract raw_bytes opt_bytes saved
  for row in "${rows[@]}"; do
    read -r n r o <<<"$row"
    printf '%-22s %12d %12d %7d%%\n' "$n" "$r" "$o" $(((r - o) * 100 / (r > 0 ? r : 1)))
  done
  printf '%-22s %12d %12d %7d%%\n' TOTAL "$total_raw" "$total_opt" \
    $(((total_raw - total_opt) * 100 / (total_raw > 0 ? total_raw : 1)))
  echo
  echo "Transactions: fresh deploy $legacy_fresh -> $optimized_fresh, re-run $legacy_rerun -> $optimized_rerun"
fi
