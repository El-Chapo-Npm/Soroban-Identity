# Deployment cost optimization

This directory holds the fee-optimized deployment helpers used by
[`scripts/deploy.sh`](../../scripts/deploy.sh), a benchmark script, and notes on
where Soroban Identity's deployment fees come from (#949).

| File | Purpose |
| --- | --- |
| `lib.sh` | Helpers for optimizing, uploading and deploying WASM. `scripts/deploy.sh` sources this file |
| `benchmark.sh` | Reports raw and optimized WASM sizes and how many transactions each deployment flow needs |

## Where deployment fees come from

A Soroban deployment of the three core contracts (identity-registry,
credential-manager, reputation) consists of:

1. **Upload**: one transaction per contract that writes the WASM to the ledger. The resource fee grows with the number of bytes written, so this is by far the largest cost.
2. **Create**: one transaction per contract that creates a contract instance from an uploaded code hash.
3. **Initialize**: one `initialize` call per contract that writes the admin and any config to instance storage.

## Audit of the previous flow

| Finding | Impact | Fix |
| --- | --- | --- |
| `stellar contract deploy --wasm` uploaded all three WASMs on every run, even when that code was already installed | Paid the full upload fee again on each re-run | Upload once per code hash, and skip the upload when the hash is already on-chain (`install_wasm`) |
| WASM was not run through `wasm-opt` | More bytes uploaded than needed | `stellar contract optimize` before upload (`optimize_wasm`) |
| Symbols and debug sections were kept in release builds | More bytes uploaded than needed | `strip = "symbols"`, `debug = 0` in `[profile.release]` |
| Contract addresses were random | A re-run could not tell what was already deployed, so it created duplicates | Deterministic addresses from a fixed salt, and existing contracts are skipped (`existing_contract_id`) |
| `reputation.initialize` wrote `DEFAULT_MIN_INTERVAL` to storage | One unneeded ledger write during initialization, because every read already falls back to the default | Removed the write |
| `credential-manager initialize` was called without `identity_registry_id` | The initialize step failed | The script now passes the registry ID |

## Techniques

### 1. Optimize WASM before uploading

`optimize_wasm` runs `stellar contract optimize` (which uses `wasm-opt`) and writes
`<name>.optimized.wasm` next to the build output. If the installed CLI lacks the
optimizer, the script falls back to the unoptimized build. Set
`SKIP_WASM_OPTIMIZE=1` to turn the step off.

The release profile in `contracts/Cargo.toml` already used `opt-level = "z"`,
`lto = true`, `codegen-units = 1` and `panic = "abort"`. It now also strips
symbols and debug info.

### 2. Upload each code hash only once

`install_wasm` computes the SHA-256 of the WASM locally and checks whether that
hash is already installed (`stellar contract fetch --wasm-hash`). If it is, the
upload is skipped. Contracts are then created from the hash with
`stellar contract deploy --wasm-hash`.

### 3. Deterministic addresses (the Soroban equivalent of CREATE2)

Soroban derives a contract address from the deployer address and a 32-byte
salt, much like EVM `CREATE2`. The salt for each contract is:

```text
sha256("soroban-identity:<contract-name>:<DEPLOY_SALT_VERSION>")
```

This has two effects:

- Addresses are known before deployment: `stellar contract id wasm --salt ... --source-account ...`, or `predicted_contract_id` in `lib.sh`.
- Re-runs are idempotent. If a contract already exists at its predicted address, the script skips the upload, deploy and initialize steps for it. A re-run of a completed deployment submits no transactions.

To deploy a fresh set of contracts from the same account, bump the salt
namespace:

```bash
DEPLOY_SALT_VERSION=v2 scripts/deploy.sh --network testnet
```

### 4. Minimal initialization

`initialize` should only write state that has no safe default. Values with a
default in code, such as the reputation rate-limit window, are read with
`unwrap_or(DEFAULT)` and are not written at deploy time.

Soroban SDK 21 (the version this workspace uses) does not support
`__constructor`. Once the workspace moves to SDK 22 or later, `initialize` can
become a constructor. That would merge the create and initialize steps into a
single transaction per contract, and would also close the window between deploy
and initialize in which another account could call `initialize` first.

## Benchmarking

```bash
contracts/deployment/benchmark.sh           # table
contracts/deployment/benchmark.sh --json    # machine-readable output
SKIP_BUILD=1 contracts/deployment/benchmark.sh
```

The script builds the contracts and reports each WASM's raw and optimized size,
plus the transaction count for a fresh deploy and a re-run under the old and new
flows. Upload fees scale with WASM size, so the size reduction is the main
figure to compare. To get exact fees, run `scripts/deploy.sh --network testnet`
before and after a change and compare the fee charged for each transaction in a
block explorer.

Record results here when you run the benchmark:

| Contract | Raw bytes | Optimized bytes | Saved |
| --- | --- | --- | --- |
| identity_registry | _run `benchmark.sh`_ | | |
| credential_manager | | | |
| reputation | | | |

| Flow | Fresh deploy (txs) | Re-run (txs) |
| --- | --- | --- |
| Before (#949) | 9 (3 upload + 3 create + 3 init) | 9 (all re-uploaded, duplicate contracts) |
| After | 9 (3 upload + 3 create + 3 init) | 0 (everything detected and skipped) |
