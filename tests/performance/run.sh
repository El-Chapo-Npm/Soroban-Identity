#!/usr/bin/env bash
# Performance regression test runner (#880).
#
# 1. Runs Soroban contract benchmarks (cargo bench) and captures budget output.
# 2. Runs API performance tests against a running server.
# 3. Generates a Markdown comparison report.
# 4. Exits non-zero if any benchmark exceeds its baseline by more than 10%.
#
# Usage:
#   bash tests/performance/run.sh [--update-baselines] [--base-url http://localhost:3000]
#
# Environment variables (all optional):
#   PERF_BASE_URL         API server base URL (default: http://localhost:3000)
#   PERF_ITERATIONS       API samples per endpoint (default: 50)
#   PERF_REGRESSION_PCT   Max regression % before failure (default: 10)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PERF_DIR="${REPO_ROOT}/tests/performance"
BENCH_OUTPUT="${PERF_DIR}/bench-output.txt"
RESULTS_FILE="${PERF_DIR}/perf-results.json"
REPORT_FILE="${PERF_DIR}/perf-report.md"

UPDATE_BASELINES=0
for arg in "$@"; do
  if [[ "$arg" == "--update-baselines" ]]; then
    UPDATE_BASELINES=1
  fi
  if [[ "$arg" == --base-url=* ]]; then
    export PERF_BASE_URL="${arg#--base-url=}"
  fi
done

echo "=== Step 1: Contract gas benchmarks ==="
(
  cd "${REPO_ROOT}/contracts"
  cargo bench -p identity-registry --bench registry 2>&1 | tee "${BENCH_OUTPUT}"
)

echo ""
echo "=== Step 2: API performance tests ==="
export PERF_BENCH_OUTPUT="${BENCH_OUTPUT}"
if [[ "${UPDATE_BASELINES}" == "1" ]]; then
  export PERF_UPDATE_BASELINE=1
fi

node --test \
  "${PERF_DIR}/api-performance.test.js" \
  "${PERF_DIR}/contract-gas.test.js" \
  2>&1

echo ""
echo "=== Step 3: Generating report ==="
node "${PERF_DIR}/report.js" \
  --results "${RESULTS_FILE}" \
  --output  "${REPORT_FILE}" \
  ${UPDATE_BASELINES:+"--update"}

echo ""
echo "Report written to: ${REPORT_FILE}"
echo "Done."
