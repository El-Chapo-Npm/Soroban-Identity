#!/usr/bin/env bash
#
# Run all fuzz targets with a time budget.
#
# The committed seeds in seeds/<target>/ are copied into the working corpus
# before each run, so a fresh checkout starts from the edge cases we already
# know are worth reaching rather than rediscovering them by chance. The corpus
# itself is gitignored and grows locally as libFuzzer finds new inputs.
#
# Usage:
#   ./run_fuzz.sh [time_per_target_seconds] [target ...]
#
# Examples:
#   ./run_fuzz.sh 60                     # every target, 60s each
#   ./run_fuzz.sh 3600                   # the nightly CI budget
#   ./run_fuzz.sh 300 fuzz_create_did    # one target, 5 minutes

set -euo pipefail

cd "$(dirname "$0")"

TIME_BUDGET="${1:-60}"
shift || true

ALL_TARGETS=("fuzz_create_did" "fuzz_issue_credential" "fuzz_submit_score")
if [ "$#" -gt 0 ]; then
  TARGETS=("$@")
else
  TARGETS=("${ALL_TARGETS[@]}")
fi

echo "Running ${#TARGETS[@]} fuzz target(s) with a ${TIME_BUDGET}s budget each..."
echo

has_crashes=0

for target in "${TARGETS[@]}"; do
  echo "===================================="
  echo "Running: $target"
  echo "===================================="

  mkdir -p "corpus/$target"

  # -n leaves any corpus entry that already exists untouched, so a local
  # corpus built up over previous runs is never overwritten by a seed.
  if [ -d "seeds/$target" ]; then
    cp -n "seeds/$target"/* "corpus/$target/" 2>/dev/null || true
  fi

  echo "Corpus: $(find "corpus/$target" -type f | wc -l) inputs"

  if cargo +nightly fuzz run "$target" "corpus/$target" -- \
      -max_total_time="$TIME_BUDGET" \
      -rss_limit_mb=2048 \
      -print_final_stats=1; then
    echo "✅ $target completed without crashes"
  else
    echo "❌ $target found crashes"
    has_crashes=1

    # List crash artifacts if any
    if [ -d "artifacts/$target" ]; then
      echo "Crash artifacts:"
      ls -lh "artifacts/$target"
    fi
  fi

  echo
done

echo "===================================="
echo "Summary"
echo "===================================="

if [ $has_crashes -eq 0 ]; then
  echo "✅ All fuzz targets passed without crashes"
  exit 0
else
  echo "❌ Some fuzz targets found crashes. See artifacts/ for reproducers."
  echo
  echo "To reproduce a crash:"
  echo "  cargo +nightly fuzz run <target> artifacts/<target>/<crash-file>"
  echo
  echo "To minimize a crash:"
  echo "  cargo +nightly fuzz tmin <target> artifacts/<target>/<crash-file>"
  exit 1
fi
