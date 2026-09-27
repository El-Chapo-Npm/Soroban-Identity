# `@soroban-identity/cli`

Manage DIDs and credentials on Soroban Identity from the terminal.

```bash
npm install -g @soroban-identity/cli
soroban-identity --help
```

The CLI is a thin layer over [`@soroban-identity/sdk`](../sdk): the same
contract calls, with the plumbing (config file, key handling, JSON output) done
for you.

## Configuration

`config init` writes the file; command-line flags and environment variables
override it, and what you do not pass it will ask for interactively (only when
stdin is a TTY — with `--yes`, in a pipe or in CI a missing value fails instead
of hanging).

Resolution order, lowest precedence first:

| Source | Identity |
| --- | --- |
| config file | `--config <path>` → `$SOROBAN_IDENTITY_CONFIG` → `$XDG_CONFIG_HOME/soroban-identity/config.json` → `~/.config/soroban-identity/config.json` |
| environment | `SOROBAN_IDENTITY_RPC_URL`, `SOROBAN_IDENTITY_NETWORK`, `SOROBAN_IDENTITY_IDENTITY_REGISTRY_ID`, `SOROBAN_IDENTITY_CREDENTIAL_MANAGER_ID`, `SOROBAN_IDENTITY_REPUTATION_ID`, `SOROBAN_IDENTITY_SECRET` |
| flags | `--rpc-url`, `--network`, `--identity-registry-id`, `--credential-manager-id`, `--reputation-id`, `--secret` |

```bash
soroban-identity config init \
  --identity-registry-id CD5M...JA7T \
  --credential-manager-id CBL6...P3FH \
  --reputation-id CAZ7...J0K

soroban-identity config show      # what would be used, and where each value came from
```

`--network testnet|futurenet|mainnet` selects a preset (RPC url + passphrase);
`config show` tells you which source won for every field. Secrets are only ever
read from `--secret`, `$SOROBAN_IDENTITY_SECRET` or a hidden prompt, and are
never printed.

## Commands

```bash
# 1. a DID for a Stellar account (controller key signs)
soroban-identity create-did --secret S... --metadata role=auditor

# 2. issue a credential to a subject
soroban-identity issue-credential --secret S... \
  --subject G... --type Kyc \
  --claim name=Alice --claim country=UA \
  --expires-at 2026-12-31T00:00:00Z

# 3. verify it
soroban-identity verify --credential-id 8f3a...  # 64 hex chars

# 4. revoke it, recording why
soroban-identity revoke --secret S... --credential-id 8f3a... --reason Superseded
```

`--expires-at` takes unix seconds or an ISO-8601 date (`0`, the default, means
"never expires"). `--claim` is repeatable and the claims hash the contract stores
is computed for you as SHA-256 over the claims with sorted keys.

### Revocation reasons

`--reason` accepts one of the contract's variants — `Compromised`, `Expired`,
`Superseded`, `Lost`, `AdminRevoked` — and also the looser forms you would type
by hand (`superseded`, `admin_revoked`, `Admin Revoked`). Anything else fails
before a transaction is built:

```console
$ soroban-identity revoke --credential-id 8f3a... --reason typo
error: unknown revocation reason "typo" — expected one of: Compromised, Expired, Superseded, Lost, AdminRevoked
```

The reason is stored on-chain, indexed per reason and emitted with the `revoked`
event, so `verify` and your own indexer can tell *why* a credential was pulled.

### Scripting

`--json` writes a single JSON object to stdout on success and to stderr on
failure, so pipelines stay clean:

```bash
soroban-identity --json verify --credential-id 8f3a... | jq '.data.valid'
```

```json
{ "ok": true, "command": "verify", "data": { "valid": true, "reason": null } }
```

```json
{ "ok": false, "command": "revoke", "error": { "code": "UNKNOWN_REASON", "message": "...", "details": { "valid": ["Compromised", "..."] } } }
```

| Exit code | Meaning |
| --- | --- |
| `0` | the command succeeded |
| `1` | the operation failed (RPC error, contract error, transaction not accepted) |
| `2` | bad usage: unknown flag, invalid value, missing required argument |
| `3` | configuration problem (no config file, unreadable JSON, missing contract id) |

### Dry runs

`--dry-run` prints exactly what would be submitted — including the encoded
reason ScVal — and exits without opening an RPC connection. Useful in review, in
CI, and for checking that your config resolves the way you expect:

```console
$ soroban-identity --json --dry-run revoke --credential-id 8f3a... --reason Superseded
{"ok":true,"command":"revoke","data":{"dryRun":true,"rpcUrl":"https://soroban-testnet.stellar.org",...,"args":{"credentialId":"8f3a...","reason":"Superseded","reasonScValXdr":"AAAAEQAAAAEAAAABAAAADwAAAAhTdXBlcnNlZGVkAAA="}}}
```

## Development

```bash
npm run build:sdk        # the CLI resolves @soroban-identity/sdk
npm run build:cli
npm run test:cli         # spawns dist/index.js; all tests are dry runs
```

Tests live in `cli/test/` and drive the built binary, so a flag or exit code
that changes shows up as a test failure rather than as a surprised user.
