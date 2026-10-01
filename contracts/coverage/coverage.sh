#!/usr/bin/env bash
# Generates contract coverage (HTML, JSON, LCOV) with cargo-llvm-cov and enforces thresholds.
set -euo pipefail
LINE_MIN="${COVERAGE_LINE_MIN:-80}"
BRANCH_MIN="${COVERAGE_BRANCH_MIN:-70}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/report"
cd "$HERE/.."
command -v cargo-llvm-cov >/dev/null || cargo install cargo-llvm-cov --locked

# Exclude tests, generated code and build output from metrics
IGNORE='(/tests?/|test\.rs$|_test\.rs$|/target/|/fuzz/|contractimport|\.cargo/registry)'

mkdir -p "$OUT"
cargo llvm-cov clean --workspace
# --branch requires nightly; fall back to line-only on stable
BRANCH_FLAG=""
if rustc --version | grep -q nightly; then BRANCH_FLAG="--branch"; fi
cargo llvm-cov --workspace $BRANCH_FLAG --no-report
cargo llvm-cov report $BRANCH_FLAG --ignore-filename-regex "$IGNORE" --html --output-dir "$OUT"
cargo llvm-cov report $BRANCH_FLAG --ignore-filename-regex "$IGNORE" --json --summary-only --output-path "$OUT/coverage.json"
cargo llvm-cov report $BRANCH_FLAG --ignore-filename-regex "$IGNORE" --lcov --output-path "$OUT/lcov.info"

node "$HERE/check-thresholds.mjs" "$OUT/coverage.json" "$LINE_MIN" "$BRANCH_MIN"
