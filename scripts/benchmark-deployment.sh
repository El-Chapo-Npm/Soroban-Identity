#!/usr/bin/env bash
# Produce a deterministic deployment audit without submitting transactions.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_FILE="${1:-$ROOT_DIR/deployment-costs.csv}"
TARGET_DIR="$ROOT_DIR/contracts/target/wasm32-unknown-unknown/release"
mkdir -p "$(dirname "$OUT_FILE")"
if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required to build the deployment artifacts" >&2
  exit 1
fi
START=$(date +%s)
(cd "$ROOT_DIR/contracts" && cargo build --target wasm32-unknown-unknown --release)
BUILD_SECONDS=$(( $(date +%s) - START ))
printf 'contract,wasm_bytes,wasm_sha256,build_seconds,deterministic_salt\n' > "$OUT_FILE"
for contract in identity_registry credential_manager reputation; do
  wasm="$TARGET_DIR/${contract}.wasm"
  if [[ ! -f "$wasm" ]]; then
    echo "missing artifact: $wasm" >&2
    exit 1
  fi
  bytes=$(wc -c < "$wasm" | tr -d ' ')
  sha=$(sha256sum "$wasm" | awk '{print $1}')
  salt=$(printf 'soroban-identity:%s' "$contract" | sha256sum | awk '{print substr($1,1,64)}')
  printf '%s,%s,%s,%s,%s\n' "$contract" "$bytes" "$sha" "$BUILD_SECONDS" "$salt" >> "$OUT_FILE"
done
echo "Deployment audit written to $OUT_FILE"
