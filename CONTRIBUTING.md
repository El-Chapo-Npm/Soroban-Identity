# Contributing to Soroban Identity

Thanks for taking the time to contribute. This guide covers everything you need to go from zero to a merged PR.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
By participating you agree to uphold it. Report unacceptable behaviour to the maintainers via a GitHub Discussion.

---

## Prerequisites

Install these before anything else. The versions listed are what CI uses — mismatches are the most common source of local failures.

| Tool | Version | Install |
|---|---|---|
| Rust | stable (≥ 1.78) | [rustup.rs](https://rustup.rs/) |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| `rustfmt` + `clippy` | bundled with stable | `rustup component add rustfmt clippy` |
| Stellar CLI | ≥ 21.0.0 | [Stellar CLI docs](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli) |
| Node.js | 18 LTS | [nodejs.org](https://nodejs.org/) |
| npm | ≥ 9 (bundled with Node 18) | — |

Verify your setup:

```bash
rustc --version          # rustc 1.xx.x (...)
cargo fmt --version      # rustfmt x.x.x-stable
cargo clippy --version   # clippy x.x.x (...)
stellar --version        # stellar x.x.x
node --version           # v18.x.x
npm --version            # 9.x.x or 10.x.x
```

---

## Local Setup

### 1. Fork and clone

```bash
git clone https://github.com/<your-username>/Soroban-Identity.git
cd Soroban-Identity
```

### 2. Build the Soroban contracts

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release
```

### 3. Install and build the TypeScript SDK

```bash
cd sdk
npm ci
npm run build
```

### 4. Install the frontend

```bash
cd frontend
npm ci
```

### 5. Configure the frontend environment

```bash
cp frontend/.env.example frontend/.env
# Edit frontend/.env and fill in contract IDs after deployment
```

### 6. (Optional) Run the server locally

```bash
cd server
cp .env.example .env
npm ci
npm start
```

---

## Running Tests

Run all test suites before opening a PR. Every suite must pass locally.

### Contracts

```bash
# Run all contract unit tests
cd contracts
cargo test

# Run tests for a specific contract
cd contracts/identity-registry
cargo test

cd contracts/credential-manager
cargo test

cd contracts/reputation
cargo test
```

### Lint and format check (contracts)

```bash
cd contracts
cargo fmt --check      # must produce no diff
cargo clippy --all-targets --all-features -- -D warnings   # must produce no warnings
```

### SDK

```bash
cd sdk
npm run lint           # ESLint — must exit 0
npm run format:check   # Prettier — must produce no diff
npm run type-check     # TypeScript — must produce no errors
npm test               # Vitest unit tests
```

### Frontend

```bash
cd frontend
npm run lint           # ESLint + react-hooks plugin — must exit 0
npm run format:check   # Prettier — must produce no diff
npx tsc --noEmit       # TypeScript — must produce no errors
npm test               # Vitest unit tests
node scripts/validate-locales.js   # i18n key sync check
```

### Server

```bash
cd server
node --test            # Node built-in test runner
```

---

## Branch Naming

Branch names must use one of these prefixes followed by a short slug:

| Prefix | When to use |
|---|---|
| `feat/` | New feature or enhancement |
| `fix/` | Bug fix |
| `docs/` | Documentation only |
| `devops/` | CI, tooling, build scripts |
| `refactor/` | Code restructure with no behaviour change |
| `test/` | Adding or fixing tests only |

Examples:

```
feat/credential-type-filter
fix/expire-credential-ttl
docs/architecture-diagrams
devops/eslint-frontend
```

---

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

```
<type>(<scope>): <short summary>

[optional body]

[optional footer: Closes #N]
```

**Types:** `feat`, `fix`, `docs`, `devops`, `refactor`, `test`, `chore`

**Scope:** the affected package or area, e.g. `credential-manager`, `sdk`, `frontend`, `ci`

Examples:

```
feat(credential-manager): add expire_credential permissionless sweep
fix(identity-registry): replace expect/panic with typed errors in transfer_admin
docs(architecture): add Mermaid lifecycle state diagrams
devops(ci): add clippy and fmt gate to contracts CI
```

Keep the summary line under 72 characters. Use the body for the *why*, not the *what*.

---

## PR Process

1. **Open an issue first** (or find an existing one) — every PR should reference an issue.
2. **Create your branch** from `main` using the naming convention above.
3. **Make your changes** and ensure all test suites pass locally.
4. **Update the changelog** — if your change affects the SDK, add an entry to the `[Unreleased]` section in `sdk/CHANGELOG.md`.
5. **Open the PR** against `main` and fill in the template:
   - Link the issue: `Closes #N` (GitHub auto-closes the issue on merge)
   - Describe *what* changed and *why*
   - Note any migration steps or breaking changes
6. **Address review feedback** — at least one maintainer approval is required before merge.
7. **Squash or rebase** if requested to keep the commit history clean.

### PR checklist

Before requesting review, confirm:

- [ ] All contract tests pass: `cargo test` in `contracts/`
- [ ] Clippy is clean: `cargo clippy --all-targets --all-features -- -D warnings`
- [ ] Rust formatting is clean: `cargo fmt --check`
- [ ] SDK lint is clean: `npm run lint` in `sdk/`
- [ ] SDK format is clean: `npm run format:check` in `sdk/`
- [ ] SDK tests pass: `npm test` in `sdk/`
- [ ] Frontend lint is clean: `npm run lint` in `frontend/`
- [ ] Frontend type check passes: `npx tsc --noEmit` in `frontend/`
- [ ] i18n keys are in sync: `node scripts/validate-locales.js` in `frontend/`
- [ ] PR description references the related issue (`Closes #N`)
- [ ] `sdk/CHANGELOG.md` updated (SDK changes only)
- [ ] No secrets or `.env` files committed

---

## Internationalization (i18n)

The frontend uses `react-i18next` for internationalization with dynamic locale switching and local storage persistence. The English locale file `frontend/src/locales/en.json` is the source of truth. All other locale files (`es.json`, `fr.json`, `zh.json`, and future locales) must stay in sync with it.

### Translation Workflow

1. **Source of Truth**: Add new text and keys to `frontend/src/locales/en.json`.
2. **Translate to Supported Languages**: Add the corresponding translation keys and values to:
   - `frontend/src/locales/es.json` (Spanish)
   - `frontend/src/locales/fr.json` (French)
   - `frontend/src/locales/zh.json` (Chinese)
3. **Usage in Components**:
   - Use the `useTranslation` hook: `const { t } = useTranslation();`
   - Render translated strings: `t('credentials.verifyCredential')` or with variables `t('credentials.expiresInDays', { count })`.
4. **Dates and Times**:
   - Use `formatDate` or `formatTimestamp` from `frontend/src/utils/formatDate.ts` which automatically utilizes `date-fns` with locale-aware formatting.
5. **RTL Support**:
   - Locales such as Arabic (`ar`), Hebrew (`he`), etc., are automatically recognized and set the document `dir="rtl"` attribute.
6. **Validate Locales**:
   - Run the validation script to verify that no keys are missing across any language:

```bash
cd frontend
npm run validate:locales
```

---

## Questions?

Open a [GitHub Discussion](../../discussions) or leave a comment on the relevant issue. Do not open a blank PR to ask questions.
