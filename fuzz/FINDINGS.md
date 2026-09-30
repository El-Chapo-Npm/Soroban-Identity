# Fuzz findings

Issue #821. This file is the place crash artifacts get written up after a
`cargo fuzz` run. A crash is not closed until a regression test in
`contracts/` fails on the minimized input and passes after the fix.

## Run used for this change

`cargo test -p did-bridge` and `cargo test -p credential-manager --lib`
were run locally. A full `cargo +nightly fuzz run` was not executed in this
environment because `libfuzzer-sys` needs a nightly toolchain and a
libFuzzer-capable linker that are not assumed on every machine. CI
(`.github/workflows/fuzz.yml`) still time-boxes every target, including the
batch, revoke, and bridge targets, to 120 seconds on pull requests and one
hour on the nightly schedule.

## Categorized results

| Target | Result | Follow-up |
| --- | --- | --- |
| `fuzz_verify_credentials_batch` | No new crash reproduced while fixing the batch module so it compiles and reports `Suspended`. | Regression: `test_batch_verification_reports_suspended_as_invalid` and the existing batch tests in `credential-manager`. |
| `fuzz_resolve_external_did` | Invalid proofs must not be cached. Covered by a deterministic test rather than a libFuzzer artifact. | `invalid_proof_does_not_cache` in `contracts/bridge`. |
| Existing identity, credential, and reputation targets | No new artifact was checked in. | Keep the seeds under `fuzz/seeds/`. |

## Invariants the targets assert

- A batch result's `valid` flag is true only when `reason` is `Valid`.
- Batch length never exceeds 50. Over-cap input returns `BatchTooLarge` instead of panicking.
- `fail_fast` returns a prefix of the input, not a longer vector.
- A bridge cache entry exists only after a proof that matches the oracle root.
- `did_exists` stays consistent with a successful `create_did` in `fuzz_create_did`.

## Not claimed

This pass did not fuzz every public function of every contract. Schema
registry, revocation registry, selective disclosure, and governance admin
flows are still unit-tested only. Cross-contract sequences are still out of
scope for the libFuzzer targets.
