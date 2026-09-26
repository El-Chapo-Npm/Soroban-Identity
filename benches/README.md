# Performance benchmarks

| Suite | Location | Command |
|---|---|---|
| Contract functions (criterion.rs) | `contracts/identity-registry/benches/registry.rs` | `cd contracts && cargo bench -p identity-registry --bench registry` |
| API endpoints and DB-backed queries | `benches/api/bench.mjs` | `node benches/api/bench.mjs --base http://localhost:3000` |

## What gets measured
- **Contracts:** wall-clock time for each `identity-registry` entry point (`create_did`, `update_did`, `resolve_did`, `has_active_did`, `deactivate_did`, `get_did_count`). The suite also reports the Soroban **CPU instructions** and **memory bytes** used, which covers allocations. Criterion writes HTML reports with charts to `contracts/target/criterion/report/index.html`.
- **API:** p50/p95/p99 latency, error count and client memory for each endpoint. The storage-backed endpoints (`/dids`, `/credentials`) show how database queries perform.

## Comparing commits and regressions
`.github/workflows/benchmarks.yml` benchmarks both the PR head and its base branch:
- Criterion runs with `--save-baseline base` on the base branch and then `--baseline base` on the head.
- `benchmark-action/github-action-benchmark` records the history on `main`, which gives a trend chart on the `gh-pages` branch. It **fails the job when a benchmark gets more than 10% slower** (`alert-threshold: 110%`).
- For the API, `benches/api/compare.mjs` fails when p95 latency grows by more than 10%.

## Hardware
Shared GitHub runners are noisy. To get stable numbers, add a self-hosted runner labelled `benchmark` and set the repository variable `BENCH_RUNNER=benchmark`. The workflow uses `ubuntu-latest` when that variable is not set.

## Baselines
Record baselines from `main` on the dedicated runner. The first run on `main` seeds the history on `gh-pages`. After an intentional performance change, update this section with the new numbers:

| Benchmark | Baseline |
|---|---|
| `identity_registry/create_did` | _set on first `main` run_ |
| `identity_registry/resolve_did` | _set on first `main` run_ |
| `GET /health` p95 | _set on first `main` run_ |
