#!/usr/bin/env bash
# Run the Kani proofs for the Soroban Identity contracts (#957).
#
# Usage:
#   scripts/verify.sh              # current contract behaviour
#   scripts/verify.sh --patched    # with the fixes proposed in RESULTS.md
#   scripts/verify.sh --harness id_did_count_matches_active
#
# Requires Kani: `cargo install --locked kani-verifier && cargo kani setup`.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

ARGS=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --patched) ARGS+=(--features patched); shift ;;
    --harness) ARGS+=(--harness "$2"); shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done

command -v cargo-kani >/dev/null 2>&1 || {
  echo "cargo-kani not found: cargo install --locked kani-verifier && cargo kani setup" >&2
  exit 1
}

cargo kani "${ARGS[@]}" --output-format terse
