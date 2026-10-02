# Contract Coverage

Line and branch coverage for the Soroban contracts using
[`cargo-llvm-cov`](https://github.com/taiki-e/cargo-llvm-cov).

## Requirements
| Metric | Minimum |
|---|---|
| Line coverage | **80 %** |
| Branch coverage | **70 %** (measured on nightly, where `--branch` is supported) |

CI fails when either metric drops below its threshold. Override locally with
`COVERAGE_LINE_MIN` / `COVERAGE_BRANCH_MIN`.

## Exclusions
Test modules (`tests/`, `test.rs`, `*_test.rs`), `target/`, `fuzz/` and generated
`contractimport!` bindings are excluded via `--ignore-filename-regex`.

## Running locally
```bash
rustup toolchain install nightly --component llvm-tools-preview
cargo +nightly install cargo-llvm-cov
RUSTUP_TOOLCHAIN=nightly ./contracts/coverage/coverage.sh
open contracts/coverage/report/html/index.html
```

Outputs in `contracts/coverage/report/`:
- `html/` — annotated source view (covered/uncovered lines and branches highlighted)
- `coverage.json` — machine-readable summary
- `lcov.info` — uploaded to Codecov
- `summary.md` — table also posted to the GitHub job summary

## Code review & trends
`.github/workflows/contracts-coverage.yml` uploads `lcov.info` to Codecov under the
`contracts` flag (see `codecov.yml`). Codecov adds PR comments, inline line
annotations in the diff, and the coverage trend dashboard at
`https://app.codecov.io/gh/El-Chapo-Npm/Soroban-Identity`.
