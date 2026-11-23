# Seed corpus

Each file here is a starting input for the fuzz target named by its directory.
`run_fuzz.sh` and the CI workflow copy them into `fuzz/corpus/<target>/` before
fuzzing, so every run begins from the edge cases we already know are worth
reaching instead of rediscovering them by chance.

The corpus directory itself is gitignored: it is generated, grows as libFuzzer
finds new inputs, and would otherwise churn on every run. Only these seeds are
committed.

## How a seed becomes an input

libFuzzer hands the target a byte string, and `arbitrary` decodes it into the
target's input struct — consuming bytes field by field, taking lengths for
collections and strings from the bytes it reads. Seeds are therefore raw bytes,
not a readable serialization of the struct.

The practical consequence: **a seed's effect is not obvious from its contents,
and it shifts if the input struct changes**. That is fine — a seed is a
starting point for mutation, not a test case with an expected outcome. Nothing
is asserted about which path a given seed takes, and none of them need updating
when a struct gains a field.

What the seeds do guarantee is a spread of shapes across the decoder:

| Seed | Intent |
| --- | --- |
| `empty` | Every field falls back to its default — the degenerate input |
| `zeros` / `zero-delta` | Empty collections, `false` flags, zero-valued numbers |
| `max-bytes` / `all-ones` | Maximum lengths and numeric extremes |
| `ascii-*` | Valid UTF-8 text, so strings survive conversion intact |
| `invalid-utf8` | Exercises the lossy byte-to-string conversion path |
| `oversized-*` | Values past the contracts' size guards, which must return an error rather than panic |
| `i64-max` / `i64-min` / `max-expiry` | The arithmetic boundaries where accumulation overflows |
| `repeated-max` | Two extreme values in sequence, for overflow on accumulation |

## Adding a seed

Any input that reached a bug is worth keeping, so the regression stays covered:

```bash
# after minimizing a crash
cargo +nightly fuzz tmin fuzz_create_did artifacts/fuzz_create_did/crash-abc123
cp artifacts/fuzz_create_did/minimized-from-abc123 seeds/fuzz_create_did/regression-issue-755
```

Name it after what it covers. Keep seeds small — libFuzzer mutates faster with
short inputs, and a large seed mostly wastes budget.
