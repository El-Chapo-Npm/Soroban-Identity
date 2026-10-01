#!/usr/bin/env bash
# Shared, fee-optimized deployment helpers for Soroban Identity contracts (#949).
#
# Source this file; it expects STELLAR_NETWORK, STELLAR_RPC_URL and
# SOURCE_ACCOUNT to be set, and a `retry_command` function to be defined.
#
# Techniques (see contracts/deployment/README.md):
#   1. Optimize WASM with `stellar contract optimize` before upload.
#   2. Upload each WASM once and skip the upload when that code hash is
#      already installed on the network.
#   3. Deploy from the installed hash with a fixed salt, which gives a
#      deterministic contract address (the Soroban equivalent of CREATE2).
#      Re-runs detect the existing contract and skip deployment.

# Salt namespace. Bump DEPLOY_SALT_VERSION to get a fresh set of addresses.
DEPLOY_SALT_VERSION="${DEPLOY_SALT_VERSION:-v1}"

sha256_hex() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | cut -d' ' -f1
  else
    shasum -a 256 | cut -d' ' -f1
  fi
}

# Prints the 32-byte hex salt for a contract name.
contract_salt() {
  printf 'soroban-identity:%s:%s' "$1" "$DEPLOY_SALT_VERSION" | sha256_hex
}

# optimize_wasm <in.wasm> -> prints path of the optimized WASM.
# Falls back to the input file when `stellar contract optimize` is not
# available (older CLI or missing wasm-opt feature).
optimize_wasm() {
  local in="$1"
  local out="${in%.wasm}.optimized.wasm"
  if [[ "${SKIP_WASM_OPTIMIZE:-0}" != "1" ]] &&
    stellar contract optimize --wasm "$in" --wasm-out "$out" >/dev/null 2>&1; then
    echo "$out"
  else
    echo "    (wasm optimize unavailable, using unoptimized build)" >&2
    echo "$in"
  fi
}

# install_wasm <file.wasm> -> prints the installed WASM hash.
# Skips the upload transaction when the code is already on-chain.
install_wasm() {
  local wasm="$1"
  local hash
  hash=$(sha256_hex <"$wasm")
  if stellar contract fetch --wasm-hash "$hash" \
    --network "$STELLAR_NETWORK" --rpc-url "$STELLAR_RPC_URL" \
    --out-file /dev/null >/dev/null 2>&1; then
    echo "    code $hash already installed, skipping upload" >&2
    echo "$hash"
    return 0
  fi
  retry_command stellar contract upload \
    --wasm "$wasm" \
    --source "$SOURCE_ACCOUNT" \
    --network "$STELLAR_NETWORK" \
    --rpc-url "$STELLAR_RPC_URL"
}

# predicted_contract_id <name> -> prints the deterministic contract ID for
# the source account and salt, without submitting a transaction.
predicted_contract_id() {
  stellar contract id wasm \
    --salt "$(contract_salt "$1")" \
    --source-account "$SOURCE_ACCOUNT" \
    --network "$STELLAR_NETWORK" \
    --rpc-url "$STELLAR_RPC_URL"
}

contract_exists() {
  stellar contract fetch --id "$1" \
    --network "$STELLAR_NETWORK" --rpc-url "$STELLAR_RPC_URL" \
    --out-file /dev/null >/dev/null 2>&1
}

# existing_contract_id <name> -> prints the deterministic contract ID if a
# contract already exists there, and fails otherwise.
existing_contract_id() {
  local id
  id=$(predicted_contract_id "$1" 2>/dev/null) || return 1
  [[ -n "$id" ]] && contract_exists "$id" && echo "$id"
}

# deploy_contract <name> <wasm-hash> -> prints the new contract ID.
deploy_contract() {
  retry_command stellar contract deploy \
    --wasm-hash "$2" \
    --salt "$(contract_salt "$1")" \
    --source "$SOURCE_ACCOUNT" \
    --network "$STELLAR_NETWORK" \
    --rpc-url "$STELLAR_RPC_URL"
}
