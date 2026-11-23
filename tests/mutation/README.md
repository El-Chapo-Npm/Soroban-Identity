# Mutation Testing

Mutation testing validates the *quality* of the contract test suite by injecting
artificial defects (mutants) into the code and checking that at least one test fails.
We use [`cargo-mutants`](https://mutants.rs) — the Rust equivalent of Stryker.

## Mutation operators
Configured in `contracts/.cargo/mutants.toml`:

| Category | Examples |
|---|---|
| Arithmetic | `+` ↔ `-`, `*` ↔ `/`, `+=` ↔ `-=` |
| Logical | `&&` ↔ `\|\|`, removal of `!` |
| Conditionals | `==` ↔ `!=`, `<` ↔ `<=`, `>` ↔ `>=` |
| Return values | functions return `Default`, `true`/`false`, `Ok(())` |

Test files, `target/` and `Debug`/`Display` impls are excluded.

## Running locally
```bash
./tests/mutation/run-mutation.sh                      # whole workspace
./tests/mutation/run-mutation.sh -p identity-registry # one crate
MUTATION_THRESHOLD=80 ./tests/mutation/run-mutation.sh
```
Reports are written to `tests/mutation/reports/` (`mutation-report.md`,
`mutants.out/outcomes.json`, `missed.txt`, `caught.txt`).

## Score
`score = (caught + timeout) / (caught + missed + timeout)`. Unviable mutants
(which do not compile) are excluded. The target is **> 70 %**; the run fails below it.

## Handling survivors
1. Open `mutants.out/missed.txt` to see each surviving mutant.
2. Decide whether it reveals a missing assertion/scenario (add a test) or an
   equivalent mutant (add it to `exclude_re` with a comment).
3. Re-run for the affected crate with `-p <crate>` to confirm it is caught.

## CI
`.github/workflows/mutation.yml` runs weekly (Sunday 03:00 UTC) and on manual
dispatch, uploads the report as an artifact and posts it to the job summary.
