# Formal Verification

Formal models and machine-checked proofs for the security-critical behaviour
of the Soroban Identity contracts. Tracks issue #957 (TEST-15).

| File | Contents |
| --- | --- |
| [INVARIANTS.md](INVARIANTS.md) | The invariants each contract must maintain, and why each one matters |
| [SPECIFICATIONS.md](SPECIFICATIONS.md) | Per-function pre/postconditions and the Kani harness that checks each one |
| [RESULTS.md](RESULTS.md) | Verification results, the defects found, and the proposed fixes |
| `src/*.rs` | One model per contract |
| `src/proofs/*.rs` | Kani proof harnesses |
| `scripts/verify.sh` | Runs the proofs |

## Scope

| Contract | Verified behaviour |
| --- | --- |
| `identity-registry` | Initialisation, two-step admin handover, pause, and the DID lifecycle (create, deactivate, reactivate) with its count |
| `credential-manager` | Issuer registry, pause, and the credential lifecycle: issue, renew, revoke, expire, verify |
| `revocation-registry` | Bitmap indexing, revocation records, and reversal |
| `governance` | Voting, delegation, quorum/threshold arithmetic, and timelocked execution |

Not covered: `reputation`, `schema-registry`, `selective-disclosure`, and
cryptographic correctness (signatures, Merkle proofs), which rests on the
Soroban host functions rather than on contract logic.

## Approach

### Tool: Kani

[Kani](https://github.com/model-checking/kani) is a bit-precise model checker
for Rust, built on CBMC. For every harness it explores **all** values of the
symbolic (`kani::any()`) inputs, and it checks, beyond the harness's own
assertions, every arithmetic overflow, division by zero, out-of-bounds index
and `unwrap` on `None`.

Kani was chosen over the alternatives for these reasons:

- **Certora Sunbeam** verifies compiled Soroban WASM directly, but its specs
  live in a separate language and it needs a licence. It is a good next step
  for production-bytecode assurance. See [RESULTS.md](RESULTS.md#next-steps).
- **Prusti / Creusot** need annotations inside the contract source, which
  would couple verification to every contract edit.
- **Property-based testing** (proptest) samples inputs, while Kani proves over
  all of them.

### Why models, not the contracts directly

`soroban-sdk` types (`Env`, `Address`, `Map`, storage) are host objects
reached through FFI, which Kani cannot see through. Each contract is therefore
modelled as a plain Rust state machine that:

- keeps every access-control check, state transition and piece of arithmetic
  *exactly* as written in the contract, in the same order, and cites the
  contract function it models;
- reduces addresses to a small integer universe (4 addresses) and collections
  to fixed arrays, which is enough to distinguish admin, pending admin,
  attacker and bystander;
- drops storage TTLs, events, metadata, claims and signatures, none of which
  any property depends on;
- encodes Soroban's semantics explicitly: a single signer per call
  (`require_auth`), and all-or-nothing writes (`atomically`).

Proofs are about the models, so **a model must change whenever its contract
does.** Every model function names the contract function it mirrors. Reviewers
of a contract PR that touches a modelled function should check the model too.

## Running

```bash
cargo install --locked kani-verifier && cargo kani setup   # one-time

cd contracts/verification
scripts/verify.sh                 # current behaviour: 9 harnesses expected to FAIL
scripts/verify.sh --patched       # with the proposed fixes: all expected to pass
scripts/verify.sh --harness gov_execute_never_divides_by_zero
```

`cargo check` (and `cargo check --features patched`) compiles the models
without Kani. The harnesses are behind `cfg(kani)`.

The crate is standalone (it has its own `[workspace]`), so it has no effect on
contract builds, WASM size budgets, or `cargo test` in `contracts/`.

## CI

CI integration is **not included** in this change. When it is added, the job
should run `scripts/verify.sh --patched` once the fixes land, and
`scripts/verify.sh` until then, with the nine known failures allow-listed by
harness name.
