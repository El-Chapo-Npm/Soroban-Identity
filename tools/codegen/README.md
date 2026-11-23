# Soroban Identity — API Client Codegen

This workspace generates typed API clients for the Soroban Identity Server API
(`server/openapi.json`) using [OpenAPI Generator](https://openapi-generator.tech).

## What you get

| Language   | Generator          | Package                                      | Location                        |
| ---------- | ------------------ | -------------------------------------------- | ------------------------------- |
| TypeScript | `typescript-fetch` | `@soroban-identity/client-ts`                | `generated/typescript/`         |
| Python     | `python` (urllib3) | `soroban-identity-python`                    | `generated/python/`             |
| Go         | `go`               | `github.com/El-Chapo-Npm/Soroban-Identity/tools/codegen/generated/go` | `generated/go/` |

## Layout

- `config/*.yaml` — per-language generator options
- `spec/openapi.json` — pinned copy of `server/openapi.json` (regenerated on every run)
- `scripts/generate.mjs` — pins the spec, invokes the generator, applies publish metadata
- `scripts/generate-docker.sh` — runs the whole flow inside a Docker container (no local Java needed)
- `examples/` — runnable per-language usage samples

## Prerequisites

- Node.js 20+ (for the npm wrapper CLI)
- Java 21+ (the OpenAPI Generator CLI itself)
- or Docker (use `scripts/generate-docker.sh` instead)
- Per-language toolchains for building: TypeScript (`npm`), Python 3.12+ (`pip`), Go 1.23+

## Regenerate

```bash
cd tools/codegen
npm install
npm run generate        # all three clients
npm run generate:ts     # or just one
npm run generate:python
npm run generate:go
```

The script:

1. copies `server/openapi.json` → `spec/openapi.json`,
2. regenerates the target client(s) into `generated/<lang>/` (outputs are wiped first, so no stale files),
3. applies deterministic publish metadata:
   - **TS**: author, description, repository, `publishConfig` on `package.json`
   - **Python**: dist name `soroban-identity-python`, authors, repository URL in `pyproject.toml`/`setup.py`, removes generated `test/` scaffolding
   - **Go**: pins the module path, removes generated `test/` scaffolding, runs `gofmt`

## Verify

```bash
# TypeScript
cd generated/typescript && npm install && npm run build

# Python
cd generated/python && pip install -e . && python -c "import soroban_identity_client; print('ok')"

# Go
cd generated/go && go build ./... && go vet ./...
```

Regression/formatting checks for all three run in CI (`.github/workflows/codegen.yml`), which
also regenerates and fails on any diff, so the committed clients always match the spec.

## Examples

Each example targets a running server on `http://localhost:7400`.

```bash
# TypeScript (from tools/codegen)
npx tsx examples/typescript/basic.ts

# Python (from tools/codegen)
python examples/python/basic.py

# Go (from tools/codegen)
cd examples/go && go run .
```

## Publishing (maintainers only)

Release tagging uses the `clients-*` tag convention and `.github/workflows/publish-clients.yml`:

- **TypeScript** → npm registry (needs `NPM_TOKEN` secret; package is `@soroban-identity/client-ts`)
- **Python** → PyPI (needs `PYPI_TOKEN` secret; dist name `soroban-identity-python`)
- **Go** → published by tagging the module version; the module lives in-repo at
  `tools/codegen/generated/go`, so a `clients-go/v0.1.0` style tag is used for `go get`.

Both triggers require the corresponding secrets to be configured in the repository.

## Repaired spec notes

`server/openapi.json` was structurally broken and has been repaired as part of this work
(deduplicated `components`, moved 7 misplaced path entries, resolved cross-path `$ref`s,
normalized OAS 3.1-style `type` arrays, added `operationId`s to all operations, and made
`expiresAt` the single canonical expiry key). The remaining lint debt is pre-existing:
~19 `security-defined` errors and a few warnings where endpoints do not yet declare a
`security` requirement. `docs/openapi.yaml` also has gaps against `lib/rules` — fixing
those is tracked separately and is intentionally **not** part of this generator PR.