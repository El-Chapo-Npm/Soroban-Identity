#!/usr/bin/env bash
# Run mutation testing on contract code and enforce a minimum mutation score.
set -euo pipefail
THRESHOLD="${MUTATION_THRESHOLD:-70}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/tests/mutation/reports"
mkdir -p "$OUT"
command -v cargo-mutants >/dev/null || cargo install cargo-mutants --locked
cd "$ROOT/contracts"
cargo mutants --workspace --output "$OUT" --no-shuffle -j "${MUTATION_JOBS:-2}" "$@" || true
node "$ROOT/tests/mutation/score.mjs" "$OUT/mutants.out/outcomes.json" "$THRESHOLD"
