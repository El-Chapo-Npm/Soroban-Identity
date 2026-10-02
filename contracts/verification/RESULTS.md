# Verification Results

**Status as of 2026-09-28:** the models and the 27 harnesses are written and
compile (`cargo check`, with and without `--features patched`). The Kani
proofs have **not yet been executed**, because Kani is not installed in the
environment where this was written. The *Expected* column below comes from
tracing each harness through the model by hand. Every defect listed was
independently confirmed by reading the contract source, and X-1 by Cargo's
own warning. Replace *Expected* with the actual Kani outcome on the first run
of `scripts/verify.sh`.

## Summary

| | Harnesses | Expected pass | Expected fail |
| --- | --- | --- | --- |
| identity-registry | 7 | 5 | 2 (ID-1) |
| credential-manager | 9 | 8 | 1 (CM-1) |
| revocation-registry | 5 | 2 | 3 (RR-1, RR-2, RR-3) |
| governance | 6 | 3 | 3 (GOV-1, GOV-2, GOV-3) |
| **Total** | **27** | **18** | **9** |
| With `--features patched` | 27 | 27 | 0 |

## Per-harness results

| Harness | Spec | Expected (current) | Expected (patched) |
| --- | --- | --- | --- |
| `id_initialize_once` | S-ID-1 | ✅ pass | ✅ |
| `id_did_count_matches_active` | S-ID-2 | ✅ pass | ✅ |
| `id_pending_admin_nominated_by_current_admin` | S-ID-3 | ❌ **fail** (ID-1) | ✅ |
| `id_stale_proposal_cannot_seize_admin` | S-ID-3a | ❌ **fail** (ID-1) | ✅ |
| `id_admin_change_is_authorised` | S-ID-4 | ✅ pass | ✅ |
| `id_pause_freezes_dids` | S-ID-5 | ✅ pass | ✅ |
| `id_did_transitions_are_authorised` | S-ID-6 | ✅ pass | ✅ |
| `cm_issuance_requires_registered_issuer` | S-CM-1 | ✅ pass | ✅ |
| `cm_revocation_is_permanent` | S-CM-2 | ✅ pass | ✅ |
| `cm_revocation_is_authorised` | S-CM-3 | ✅ pass | ✅ |
| `cm_renewal_is_authorised_and_monotonic` | S-CM-4 | ✅ pass | ✅ |
| `cm_deregistered_issuer_cannot_extend_validity` | S-CM-5 | ❌ **fail** (CM-1) | ✅ |
| `cm_verify_is_sound` | S-CM-6 | ✅ pass | ✅ |
| `cm_pause_freezes_credentials` | S-CM-7 | ✅ pass | ✅ |
| `cm_revoked_count_matches` | S-CM-8 | ✅ pass | ✅ |
| `cm_admin_controls_are_admin_only` | S-CM-9 | ✅ pass | ✅ |
| `rr_no_index_panic` | S-RR-1 | ✅ pass | ✅ |
| `rr_init_bitmap_capacity_no_overflow` | S-RR-2 | ❌ **fail** (RR-3) | ✅ |
| `rr_bits_records_and_count_agree` | S-RR-3 | ❌ **fail** (RR-1) | ✅ |
| `rr_record_owned_by_issuer` | S-RR-4 | ❌ **fail** (RR-2) | ✅ |
| `rr_only_issuer_or_admin_clears` | S-RR-5 | ✅ pass | ✅ |
| `gov_execute_never_divides_by_zero` | S-GOV-1 | ✅ pass | ✅ |
| `gov_single_vote_per_address` | S-GOV-2 | ✅ pass | ✅ |
| `gov_execution_once_and_after_timelock` | S-GOV-3 | ✅ pass | ✅ |
| `gov_tally_bounded_by_total_power` | S-GOV-4 | ❌ **fail** (GOV-1) | ✅ |
| `gov_delegation_moves_voting_power` | S-GOV-5 | ❌ **fail** (GOV-2) | ✅ |
| `gov_no_arithmetic_overflow` | S-GOV-6 | ❌ **fail** (GOV-3) | ✅ |

## Findings

Severity reflects impact if the issue is exploited on mainnet.

### X-1 · High · Release builds do not enable overflow checks

Every contract crate sets `overflow-checks = true` in its own `Cargo.toml`
under `[profile.release]`. Cargo **ignores profiles in workspace members**.
Only `contracts/Cargo.toml` counts, and its `[profile.release]` does not set
the option. Every Cargo command in `contracts/` prints the warning:

```
warning: profiles for the non root package will be ignored, specify profiles at the workspace root
```

As a result, the deployed WASM wraps on overflow instead of trapping. This
turns GOV-3 and RR-3 from denial-of-service bugs into silent state corruption.

**Fix:** add `overflow-checks = true` to `[profile.release]` in
`contracts/Cargo.toml`, and remove the per-crate profiles.

### GOV-1 · Critical · Unregistered addresses vote, and quorum can be met with a single vote

`voting_power` returns 1 for any address missing from the weight map, and
`total_voting_power` sums only the map. Anyone can therefore vote with any
number of fresh addresses, and each vote pushes the tally past 100% of the
"total". With an empty weight map, `total_voting_power` is 1, so a single
vote meets any quorum. Counterexample from `gov_tally_bounded_by_total_power`:
empty weights, four voters, a tally of 4 against a total power of 1.

**Fix:** unregistered addresses have power 0 (`unwrap_or(0)`), and `vote`
rejects zero-power voters.

### GOV-2 · High · Delegation has no effect

`delegate_vote` stores `(DELEGATIONS, voter) → delegate`, but no function ever
reads it. The delegator keeps full voting power, and the delegate gains none.
Anyone relying on delegation to hand over their vote is silently ignored,
while the delegator can still vote as well.

**Fix:** in `voting_power`, return 0 for a voter who has delegated, and add
the weights of everyone delegating to the voter. Also forbid delegating after
voting on an open proposal, and vice versa.

### GOV-3 · Medium · Tally arithmetic can overflow

`set_voting_weights` accepts any `u64` weights. Then `yes_votes += power`,
the weight sum in `total_voting_power`, and `total_votes * 100` can each
overflow. With X-1, the result wraps: a large "yes" vote could wrap the tally
to a small number, and an overflowing `total * 100` makes a passing vote fail
quorum, or the reverse.

**Fix:** reject weight tables whose sum exceeds `u64::MAX / 100`.

### ID-1 · High · A stale admin proposal survives `transfer_admin`

`transfer_admin` sets `ADMIN` directly and leaves `PENDING_ADMIN` untouched.
Sequence: admin A calls `propose_admin(B)`, then changes their mind and calls
`transfer_admin(C)`. B can still call `accept_admin` and take the contract
from C, including its `upgrade` right. C never approved this, and A no longer
has any authority.

**Fix:** clear `PENDING_ADMIN` in `transfer_admin`, or remove `transfer_admin`
entirely in favour of the two-step flow. `transfer_admin` also panics with a
string instead of returning `ContractError::Unauthorized`, which is
inconsistent with `propose_admin`.

### ID-2 · Low · `initialize` has no authorisation

Anyone can call `initialize` on a freshly deployed contract and become admin.
This is safe only if deploy and initialise happen in the same transaction.
The same pattern exists in revocation-registry and governance.

**Fix:** use a constructor (`__constructor`, soroban-sdk ≥ 22), or require
`admin.require_auth()` and document atomic deployment. This is not a Kani
property, because it concerns the deployment process.

### CM-1 · Medium · A de-registered issuer can still renew its credentials

`renew_credential` checks that the caller is the credential's issuer, but not
that the issuer is still registered. After the admin calls `remove_issuer(X)`,
for example because X's key was compromised, X can still extend every
credential it issued, indefinitely.

**Fix:** call `require_issuer` in `renew_credential`. Revocation by a removed
issuer is deliberately still allowed, since it only narrows validity.

### RR-1 · High · Re-revoking a credential id orphans a revoked slot

Revocation records are keyed by `credential_id` alone, and `revoke_credential`
does not check for an existing record. Revoking id X at index 5 and then again
at index 6 overwrites the record. Bit 5 stays set with no record pointing to
it, so it can never be reversed, `REV_COUNT` over-counts, and whatever
credential occupies slot 5 is permanently revoked.

**Fix:** reject `revoke_credential` when an active record for the id exists
(`AlreadyRevoked`).

### RR-2 · High · Any issuer can hijack another issuer's revocation record

Given the same keying, issuer B can call `revoke_credential` for issuer A's
credential id, using an index in B's own bitmap. The record now says
`issuer = B`, so A can no longer reverse its own revocation
(`RevocationReversalUnauthorized`), and A's bit is orphaned as in RR-1.

**Fix:** as for RR-1, and also reject a re-revocation after reversal by a
different issuer. Longer term, key records by `(issuer, credential_id)`.

### RR-3 · Low · `init_bitmap` capacity overflow

`(capacity + 63) / 64` overflows for `capacity > u32::MAX - 63`. With overflow
checks on, the call traps, which is harmless. With X-1 it wraps to
`word_count = 0`, creating an empty bitmap that the issuer can never replace,
because `init_bitmap` refuses to overwrite.

**Fix:** `capacity.div_ceil(64)`.

## Properties that hold

These have no counterexample in the model: access control on DIDs, issuers,
pause, issuance, early revocation and bit clearing; that revocation is
permanent in credential-manager; that `verify_credential` is sound; the
pause guarantees; the count invariants in identity-registry and
credential-manager; bitmap index safety; and governance's
single-vote, single-execution and timelock guarantees, plus its freedom from
division by zero.

## Next steps

1. Run `scripts/verify.sh` with Kani and record the actual outcomes above.
2. Open follow-up issues for X-1, GOV-1, GOV-2, ID-1, RR-1 and RR-2, and fix
   the contracts. The `patched` feature shows the target behaviour.
3. Add CI (see [README.md](README.md#ci)).
4. Extend the coverage to `reputation` (score aggregation and decay
   arithmetic) and `schema-registry`.
5. For assurance at the bytecode level, run Certora Sunbeam against the
   release WASM, re-using these specifications.
