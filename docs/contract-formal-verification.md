# Contract formal verification

> **Issue:** [TEST-15 #943](https://github.com/El-Chapo-Npm/Soroban-Identity/issues/943)  
> **Scope:** `contracts/verification/`  
> **Tool:** [Kani](https://model-checking.github.io/kani/) (CBMC backend)

Formal verification proves that critical contract functions satisfy mathematical invariants for **all possible inputs**, not just the ones covered by unit tests. This document explains what is verified, how to run it, and how it fits into CI.

---

## Overview

The verification suite lives entirely in `contracts/verification/`. It uses **Kani**, a bit-precise model checker for Rust that compiles source code to CBMC and exhaustively explores execution paths within a configurable loop-unwind bound.

```
contracts/verification/
├── Cargo.toml            # verification crate (kani feature-gated harnesses)
├── src/lib.rs            # crate root
├── harnesses/            # Kani proof functions, one file per contract
├── properties/           # human-readable formal specifications (Markdown)
└── results/
    └── verification_report.md   # documented outcomes and known defects
```

50 harnesses cover all 7 contracts. The current run is **49 pass / 1 documented defect** (GOV-D01, see [Known defects](#known-defects)).

---

## Why Kani?

| Tool | Applicable to Soroban/WASM? | Notes |
|------|-----------------------------|-------|
| **Kani** | ✅ Yes | Rust-native; `no_std` crates verified by substituting Kani stubs for OS primitives |
| KEVM | ❌ No | Targets EVM bytecode; Soroban compiles to WASM |
| Certora | ❌ No | Requires CVL specifications and Solidity ABI stubs; no Soroban adapter |
| Move Prover | ❌ No | Move-specific |
| Prusti | ⚠️ Partial | Rust-native but weaker arithmetic reasoning for `u64`/`i64` bit operations |

Kani harnesses are plain `#[kani::proof]` functions in Rust — no separate specification language. All harnesses are gated behind the `kani` Cargo feature so `cargo check` succeeds without Kani installed.

---

## Running verification locally

### Prerequisites

```bash
# Requires Rust nightly ≥ 2024-01-01
cargo install --locked kani-verifier
cargo kani setup
```

### Run all harnesses

```bash
cd contracts
cargo kani --manifest-path verification/Cargo.toml
```

### Run a single harness

```bash
cargo kani --harness identity_registry::did_create_increments_count \
    --manifest-path verification/Cargo.toml
```

### Adjust the loop-unwind bound

If Kani reports `unwinding assertion failed`, increase the bound:

```bash
cargo kani --harness <name> --default-unwind 16 \
    --manifest-path verification/Cargo.toml
```

The default is `--default-unwind 8`, which is the bound used in CI.

---

## Verified contracts and properties

Each contract has a detailed specification in `contracts/verification/properties/<contract>.md`. The table below lists every harness that runs in CI with its current status.

### `identity-registry`

Full specification: [`properties/identity_registry.md`](../contracts/verification/properties/identity_registry.md)

| Harness | Property verified | Status |
|---------|-------------------|--------|
| `did_count_never_underflows` | `DID_COUNT` never goes below 0 | ✅ PASS |
| `create_did_increments_count_by_one` | `create_did` increments `DID_COUNT` and `TOTAL_DIDS` by exactly 1 | ✅ PASS |
| `deactivate_did_decrements_count_by_one` | `deactivate_did` decrements `DID_COUNT` by exactly 1; `TOTAL_DIDS` unchanged | ✅ PASS |
| `double_deactivate_does_not_double_decrement` | Second deactivation returns error; count not decremented again | ✅ PASS |
| `did_count_le_total_dids_invariant` | `DID_COUNT ≤ TOTAL_DIDS` across 4-step sequences | ✅ PASS |
| `paused_contract_blocks_all_writes` | All write ops return `ContractPaused`; state unchanged | ✅ PASS |
| `service_count_capped_at_max` | `add_service` returns error at `MAX_SERVICES` (10) | ✅ PASS |
| `total_dids_is_monotone` | `TOTAL_DIDS` is non-decreasing | ✅ PASS |

### `credential-manager`

Full specification: [`properties/credential_manager.md`](../contracts/verification/properties/credential_manager.md)

| Harness | Property verified | Status |
|---------|-------------------|--------|
| `revoke_is_idempotent_in_error` | Second revocation returns `CredentialRevoked`; counter unchanged | ✅ PASS |
| `revoked_count_le_total_issued` | `revoked_count ≤ total_issued` across 3-step sequences | ✅ PASS |
| `issue_rejects_past_expiry` | `issue_credential` fails when `expires_at ≤ now` (and `≠ 0`) | ✅ PASS |
| `issue_accepts_future_or_zero_expiry` | `issue_credential` succeeds when `expires_at > now` or `== 0` | ✅ PASS |
| `reentrancy_guard_prevents_nested_issue` | `EXECUTING` flag blocks nested `issue_credential` | ✅ PASS |
| `upgrade_execute_requires_elapsed_timelock` | `execute_upgrade` rejects before the 24-hour timelock | ✅ PASS |
| `nonce_strictly_increases_on_issue` | Nonce increments on each issuance; IDs are distinct after re-issuance | ✅ PASS |
| `paused_contract_blocks_issue_and_revoke` | Write ops fail while paused; state unchanged | ✅ PASS |

### `reputation`

Full specification: [`properties/reputation.md`](../contracts/verification/properties/reputation.md)

| Harness | Property verified | Status |
|---------|-------------------|--------|
| `score_never_goes_negative` | Score ≥ 0 for arbitrary 4-delta sequence | ✅ PASS |
| `score_never_negative_with_extreme_deltas` | All-`i64::MIN` deltas still produce ≥ 0 | ✅ PASS |
| `score_clamps_at_zero_after_subtraction` | Clamp prevents underflow after large positive + large negative | ✅ PASS |
| `rate_limit_blocks_submission_within_window` | Same reporter blocked within configured window | ✅ PASS |
| `rate_limit_allows_submission_outside_window` | Allowed at or after `last_ledger + window` | ✅ PASS |
| `linear_decay_never_increases_score` | Linear-decayed score ≤ original and ≥ 0 | ✅ PASS |
| `exponential_decay_never_increases_score` | Exponential-decayed score ≤ original and ≥ 0 | ✅ PASS |
| `rate_limit_window_stays_in_bounds` | Window ∈ [10, 50000] after `set_min_interval` | ✅ PASS |
| `history_never_exceeds_max` | Ring-buffer capped at `MAX_HISTORY` (50) | ✅ PASS |
| `batch_submit_score_rejects_oversized_batches` | Batch > 20 rejected | ✅ PASS |
| `dispute_id_is_monotone_and_unique` | Dispute IDs strictly increasing and unique | ✅ PASS |

### `governance`

Full specification: [`properties/governance.md`](../contracts/verification/properties/governance.md)

| Harness | Property verified | Status |
|---------|-------------------|--------|
| `execute_requires_voting_closed_and_timelock_elapsed` | Execution rejected before `voting_ends_at + timelock` | ✅ PASS |
| `execute_succeeds_after_timelock_with_quorum` | Execution accepted after timelock with 100% quorum | ✅ PASS |
| `no_double_voting` | Second vote from same address rejected | ✅ PASS |
| `zero_votes_triggers_divide_by_zero_defect` | Zero votes hit `QuorumNotMet` before threshold division — defect documented | ✅ PASS (see [GOV-D01](#gov-d01)) |
| `total_voting_power_never_zero` | `total_voting_power` helper returns ≥ 1 | ✅ PASS |
| `proposal_id_is_monotone` | Proposal IDs strictly increasing | ✅ PASS |
| `quorum_check_is_correct` | Zero votes cannot meet a non-zero quorum | ✅ PASS |
| `unanimous_yes_always_meets_threshold` | 100% yes always meets any ≤ 100% threshold | ✅ PASS |

### `revocation-registry`

Full specification: [`properties/revocation_registry.md`](../contracts/verification/properties/revocation_registry.md)

| Harness | Property verified | Status |
|---------|-------------------|--------|
| `bit_set_once_and_stays_set` | Bit is set and stays set after successful revocation | ✅ PASS |
| `double_set_returns_already_revoked` | Second set returns `Err(AlreadyRevoked)`; bitmap unchanged | ✅ PASS |
| `reverse_revocation_clears_bit` | Clear after set makes `is_revoked` return `false` | ✅ PASS |
| `out_of_bounds_index_is_rejected` | OOB index returns `InvalidBitmapIndex`; bitmap unchanged | ✅ PASS |
| `batch_revocation_is_atomic` | Batch does not partially write on validation failure | ✅ PASS |
| `rev_count_le_total_rev` | `rev_count ≤ total_rev` maintained through revoke/reverse | ✅ PASS |
| `identical_bitmaps_produce_identical_root_input` | Fresh bitmaps have identical word arrays | ✅ PASS |

### `schema-registry`

Full specification: [`properties/schema_registry.md`](../contracts/verification/properties/schema_registry.md)

| Harness | Property verified | Status |
|---------|-------------------|--------|
| `zero_hash_is_always_rejected` | All-zeros `schema_hash` rejected | ✅ PASS |
| `field_count_outside_bounds_is_rejected` | 0 or > 50 fields rejected | ✅ PASS |
| `field_length_bounds_are_enforced` | Name > 128 or description > 512 chars rejected | ✅ PASS |
| `backward_compat_rejects_dropped_required_fields` | Dropping a required field fails compatibility check | ✅ PASS |
| `backward_compat_allows_superset_of_required_fields` | Superset with new optional fields passes | ✅ PASS |
| `backward_compat_is_sound` | `check_backward_compat` is sound for arbitrary 1-field pairs | ✅ PASS |
| `total_schema_count_is_monotone` | `TOTAL_SCH` non-decreasing | ✅ PASS |
| `first_version_has_zero_previous_id` | v1 schema has all-zero `previous_version_id` | ✅ PASS |

### `selective-disclosure`

Full specification: [`properties/selective_disclosure.md`](../contracts/verification/properties/selective_disclosure.md)

| Harness | Property verified | Status |
|---------|-------------------|--------|
| `correct_hash_produces_valid_result` | Matching disclosure hash → `valid=true` | ✅ PASS |
| `tampered_hash_produces_invalid_result` | Mismatched disclosure hash → `valid=false` | ✅ PASS |
| `expired_proof_is_rejected` | Proof past `expires_at` returns `ProofExpired` | ✅ PASS |
| `verified_flag_set_at_most_once` | `verified` flag transitions `false→true` once, stays `true` | ✅ PASS |
| `attribute_count_bounds_are_enforced` | 0 or > 50 attributes rejected | ✅ PASS |
| `proof_data_size_bound_is_enforced` | `proof_data` > 256 bytes rejected | ✅ PASS |
| `total_disc_is_monotone` | `TOTAL_DISC` non-decreasing | ✅ PASS |
| `commitment_id_is_deterministic` | Same inputs produce the same `commitment_id` | ✅ PASS |

---

## Known defects

The verification run found three defects in `governance` and one code-quality issue. Full analysis is in [`results/verification_report.md`](../contracts/verification/results/verification_report.md).

### GOV-D01

**Severity:** High  
**Contract:** `contracts/governance/src/lib.rs`, `execute_proposal`  
**Description:** When `execute_proposal` is called after voting closes but no votes were cast, the expression `yes_votes * 100 / total_votes` divides by zero, causing a Soroban WASM trap.  
**Current status:** The quorum check fires before the threshold check in the zero-vote case, so the trap is unreachable as-coded. However, it is a code quality defect: reordering those checks would expose the panic.  
**Fix:**

```rust
let total_votes = proposal.yes_votes + proposal.no_votes;
if total_votes == 0 {
    return Err(GovernanceError::QuorumNotMet);
}
```

### GOV-D02

**Severity:** Low  
**Description:** `governance::initialize` returns `Err(NotInitialized)` when the contract is already initialized. The correct variant is `AlreadyInitialized` (consistent with every other contract in the workspace).

### GOV-G01

**Severity:** Medium  
**Description:** `delegate_vote` stores the delegation in `DELEGATIONS` storage, but `vote` never reads it. Vote delegation has no effect. Either wire it into `vote` or remove the stub until it is fully implemented.

### GOV-D03

**Severity:** Low  
**Description:** `yes_votes += power` is not overflow-safe. Recommended: use `saturating_add`.

---

## CI integration

Verification runs automatically via `.github/workflows/formal-verification.yml` on every pull request targeting `main` and on a nightly schedule.

Each harness is a separate matrix job. A failing harness fails only its own job, so CI output attributes failures to the specific property rather than a monolithic verification step. The nightly run uses `--default-unwind 8` for all harnesses.

Time budget: if a single harness exceeds 10 minutes it is split into a separate dedicated job. Monitor harness wall-clock times in the Actions run summary.

---

## Writing a new harness

1. Add the property to the relevant `contracts/verification/properties/<contract>.md` file first. Define the invariant in the structured Markdown format used by the existing specs (data model → access control → state transitions → invariants).

2. Add the Kani proof function to `contracts/verification/harnesses/<contract>.rs`:

```rust
#[cfg(feature = "kani")]
#[kani::proof]
fn my_new_property() {
    // Construct an unconstrained environment
    let count: u32 = kani::any();
    kani::assume(count < 1_000);

    // Call the function under test (via stubs for Soroban env)
    let result = my_function(count);

    // Assert the property
    assert!(result >= 0);
}
```

3. Run locally to confirm it passes:

```bash
cargo kani --harness <module>::my_new_property \
    --manifest-path contracts/verification/Cargo.toml
```

4. Add the harness to the properties table in `contracts/verification/README.md` and to the relevant section of this document.

---

## Limitations

### Cross-contract calls

The `credential-manager` calls `identity-registry.has_active_did` during issuance. This interaction is modelled with a boolean stub (`subject_has_did`) rather than verified end-to-end. Composing both contracts into a joint harness to cover this path is planned but not in the current scope.

### Soroban SDK stubs

The Soroban `Env` (storage, events, crypto, ledger) cannot be instantiated in Kani. All harnesses use hand-written stubs that model the documented contract of each SDK call. Bugs inside the SDK itself are out of scope.

### Loop unwind bound

The current bound of `--default-unwind 8` means loop-heavy paths (e.g. the full 1024-slot revocation bitmap, the 50-entry history ring buffer) are covered at reduced scale. The fuzz harnesses in `fuzz/` provide complementary coverage for larger input sizes.

### Cryptographic assumptions

Properties that depend on SHA-256 collision resistance (credential ID uniqueness, disclosure hash integrity) are verified under the standard cryptographic assumption. The harnesses model SHA-256 as injective; they do not verify the SHA-256 implementation.

---

## Related

- [`contracts/verification/README.md`](../contracts/verification/README.md) — infrastructure overview and tool rationale
- [`contracts/verification/results/verification_report.md`](../contracts/verification/results/verification_report.md) — full run report with per-harness results and defect analysis
- [`contracts/verification/properties/`](../contracts/verification/properties/) — per-contract formal specifications
- [Security and DDoS incident response](./security/incident-response.md)
- [Contracts README](../contracts/README.md)
