# Fuzz Testing for Soroban Identity Contracts

This directory contains [cargo-fuzz](https://github.com/rust-fuzz/cargo-fuzz) targets for the Soroban Identity smart contracts. Fuzzing uses [libFuzzer](https://llvm.org/docs/LibFuzzer.html) to generate arbitrary inputs and surface unexpected panics, integer overflows, or storage key collisions that deterministic unit tests would miss.

## Prerequisites

Install `cargo-fuzz`:

```bash
cargo install cargo-fuzz
```

Requires a nightly Rust toolchain:

```bash
rustup install nightly
```

## Available Fuzz Targets

### 1. `fuzz_create_did`

Exercises `identity-registry::create_did` with arbitrary metadata maps.

**What it tests:**
- Metadata maps with random keys, values, and entry counts
- Boundary cases (empty maps, max-size maps, oversized strings)
- Sequential operations: `create_did` → `update_did` → `deactivate_did`
- Invariants: `did_exists` and `has_active_did` consistency

**Run:**
```bash
cd fuzz
cargo +nightly fuzz run fuzz_create_did -- -max_total_time=60
```

### 2. `fuzz_issue_credential`

Exercises `credential-manager::issue_credential` with arbitrary claims and expiry values.

**What it tests:**
- Claim maps with random keys and values
- Expiry timestamps including edge cases (0, `u64::MAX`, near-current values)
- All four `CredentialType` variants (`Kyc`, `Reputation`, `Achievement`, `Custom`)
- Revocation and verification after issuance
- Arithmetic overflows in expiry comparisons

**Run:**
```bash
cd fuzz
cargo +nightly fuzz run fuzz_issue_credential -- -max_total_time=60
```

### 3. `fuzz_submit_score`

Exercises `reputation::submit_score` with boundary delta values.

**What it tests:**
- Score deltas including `i64::MIN`, `i64::MAX`, zero, and random values
- Accumulation of multiple score submissions (potential overflow)
- Reason strings of arbitrary length and content
- Sybil check thresholds at boundary values
- History retrieval after arbitrary submissions

**Run:**
```bash
cd fuzz
cargo +nightly fuzz run fuzz_submit_score -- -max_total_time=60
```

## Running All Targets

`run_fuzz.sh` seeds the corpus, runs each target, and reports crashes:

```bash
cd fuzz
./run_fuzz.sh 60                     # every target, 60s each
./run_fuzz.sh 3600                   # the nightly CI budget
./run_fuzz.sh 300 fuzz_create_did    # one target, 5 minutes
```

## Coverage

Fuzzing covers all three deployable contracts. The other crates under
`contracts/` — `shared-errors` and `soroban-identity-interface` — are `rlib`
support crates with no entry points of their own, and are exercised through the
contracts that depend on them.

| Contract | Target | Entry points reached |
| --- | --- | --- |
| `identity-registry` | `fuzz_create_did` | `create_did`, `update_did`, `resolve_did`, `did_exists`, `has_active_did`, `deactivate_did` |
| `credential-manager` | `fuzz_issue_credential` | `issue_credential`, `revoke_credential`, `verify_credential` |
| `reputation` | `fuzz_submit_score` | `submit_score`, `get_score`, `get_history`, sybil threshold checks |

Each target also asserts invariants rather than only looking for panics — for
example that `did_exists` is true after a successful `create_did` and false
after a failed one. A contract that returns a wrong answer without crashing is
a bug the fuzzer would otherwise walk straight past.

Beyond reachability, generate a line-level report for a specific target with
the [coverage instructions](#coverage-reports) below.

### Known gaps

- Administrative entry points (issuer allow-listing, admin transfer) are
  covered by unit tests but not fuzzed.
- Each target drives one contract in isolation; cross-contract sequences — a
  credential issued against a DID that is deactivated mid-flight — are not yet
  modelled.

## Interpreting Results

### No crashes

If fuzzing completes without finding crashes, you'll see output like:

```
#2097152 DONE   cov: 534 ft: 1234 corp: 56/12Kb exec/s: 34952 rss: 128Mb
```

This means libFuzzer executed 2,097,152 inputs and found no panics.

### Crash found

If fuzzing discovers a crash, it will:
1. Save the input that caused the crash to `fuzz/artifacts/<target>/crash-<hash>`
2. Print a stack trace showing the panic location

**Example:**
```
#42 CRASHED: <error message>
artifact_prefix='fuzz/artifacts/fuzz_create_did/'; Test unit written to crash-abc123
```

To reproduce the crash:

```bash
cargo +nightly fuzz run fuzz_create_did fuzz/artifacts/fuzz_create_did/crash-abc123
```

### Minimizing crashes

If a crash is found, you can minimize the input to the smallest test case that still triggers the issue:

```bash
cargo +nightly fuzz tmin fuzz_create_did fuzz/artifacts/fuzz_create_did/crash-abc123
```

## Coverage Reports

Generate a coverage report showing which lines were exercised:

```bash
cargo +nightly fuzz coverage fuzz_create_did
cargo cov -- show target/x86_64-unknown-linux-gnu/coverage/x86_64-unknown-linux-gnu/release/fuzz_create_did \
    --format=html --instr-profile=fuzz/coverage/fuzz_create_did/coverage.profdata > coverage.html
```

Open `coverage.html` in a browser to see line-by-line coverage for the contract code.

## CI Integration

`.github/workflows/fuzz.yml` runs each contract's target on its own matrix job.
The time budget depends on what triggered the run:

| Trigger | Budget per contract |
| --- | --- |
| Pull request / push to `main` | 120s |
| Nightly schedule (02:00 UTC) | 1 hour |
| Manual dispatch | 1 hour, or whatever you pass |

Two budgets rather than one because they answer different questions. A pull
request needs a fast answer to "did this change break something obvious", and
an hour-long check nobody waits for is a check nobody reads. Finding genuinely
novel inputs takes far longer than any pull request should block for, so that
work happens nightly.

The nightly run is also the one nobody is watching, so a crash there **opens a
GitHub issue** labelled `fuzzing` — reusing the existing open issue for the
same target rather than filing a fresh one every night. Pull request failures
appear in the checks list and need no such prompting. Either way the reproducer
is uploaded as the `fuzz-crash-<target>` artifact.

## Corpus Management

libFuzzer builds a corpus of interesting inputs as it runs, stored in
`fuzz/corpus/<target>/`. That directory is gitignored — it is generated and
churns on every run. Committed starting inputs live in `fuzz/seeds/<target>/`
instead, and are copied into the corpus before each run; see
[`seeds/README.md`](seeds/README.md) for what they cover and how to add one.

In CI the corpus is cached between runs, so each night starts from the inputs
previous nights found interesting rather than rediscovering the shallow paths
every time. Coverage compounds instead of resetting.

To keep an input that found a bug, minimize it and add it to the seeds so the
regression stays covered:

```bash
cargo +nightly fuzz tmin fuzz_create_did artifacts/fuzz_create_did/crash-abc123
cp artifacts/fuzz_create_did/minimized-from-abc123 seeds/fuzz_create_did/regression-issue-755
```

## Troubleshooting

### Out of memory

If fuzzing hits memory limits, increase `rss_limit_mb`:

```bash
cargo +nightly fuzz run fuzz_create_did -- -rss_limit_mb=4096
```

### Slow progress

If fuzzing makes slow progress (low `exec/s`), try:

- Reducing the time budget (`-max_total_time=30`)
- Running with more cores (`-workers=4`)
- Profiling the target to identify slow paths

### False positives

If fuzzing finds a "crash" that is actually a graceful contract error (e.g., `MetadataTooLarge`), verify that the contract returns `Result<_, ContractError>` and does not panic. Fuzz targets should use `try_*` methods and ignore expected errors.

## References

- [cargo-fuzz book](https://rust-fuzz.github.io/book/cargo-fuzz.html)
- [libFuzzer documentation](https://llvm.org/docs/LibFuzzer.html)
- [Arbitrary crate](https://docs.rs/arbitrary/latest/arbitrary/)

## Related Issues

- [#558](https://github.com/fridaypetra55-afk/Soroban-Identity/issues/558) — Add fuzz testing
- [#561](https://github.com/fridaypetra55-afk/Soroban-Identity/issues/561) — Duplicate of #558
