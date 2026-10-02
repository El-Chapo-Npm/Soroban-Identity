# @soroban-identity/cli

Command-line tool for managing Soroban Identity DIDs and verifiable credentials from the terminal.

```bash
npm install -g @soroban-identity/cli
soroban-id --help
```

Requires Node.js 18 or later.

## Quick start

```bash
# 1. Point the CLI at your deployed contracts (interactive)
soroban-id config init

# 2. Register a DID for your account
export SOROBAN_SECRET_KEY=S...
soroban-id create-did --meta name="Alice"

# 3. Issue a credential (you must be a registered issuer)
soroban-id issue GSUBJECT... --type Kyc --claim country=DE --claim level=2 --expires 90d

# 4. Verify it
soroban-id verify <credentialId> --account GYOURACCOUNT...

# 5. Revoke it
soroban-id revoke <credentialId>
```

Any value you leave out is prompted for when running in an interactive terminal.

## Commands

| Command | Description |
| --- | --- |
| `create-did` | Register a DID controlled by the signing account |
| `issue [subject]` | Issue a credential to a subject |
| `verify [credentialId]` | Check that a credential exists, is not revoked, and has not expired |
| `revoke [credentialId]` | Revoke a credential you issued |
| `config init \| show \| get \| set \| path` | Manage configuration |

### `create-did`

| Option | Description |
| --- | --- |
| `-s, --secret-key <secret>` | Controller secret key. Falls back to `SOROBAN_SECRET_KEY`, then a hidden prompt |
| `-m, --meta <key=value>` | DID document metadata entry, repeatable |
| `--meta-file <path>` | JSON object of metadata |
| `-y, --yes` | Skip the confirmation prompt |

### `issue [subject]`

| Option | Description |
| --- | --- |
| `-t, --type <type>` | `Kyc`, `Reputation`, `Achievement` or `Custom` |
| `-c, --claim <key=value>` | Claim entry, repeatable |
| `--claims-file <path>` | JSON object of claims (merged with `--claim`, which wins) |
| `-e, --expires <when>` | `30d`, `12h`, `90m`, an ISO-8601 date, Unix seconds, or `never` (default) |
| `--schema-id <id>` | Validate claims against a registered schema before submitting |
| `-s, --secret-key <secret>` | Issuer secret key |
| `-y, --yes` | Skip the confirmation prompt |

The claims hash is computed locally with the SDK's `hashSubjectClaims`, so it matches the on-chain record.

### `verify [credentialId]`

| Option | Description |
| --- | --- |
| `-a, --account <address>` | Account used to simulate the read. Defaults to `defaultAccount` from config |
| `--details` | Also fetch and print the full credential |

Exits with code `2` when the credential is invalid, so it can be used in scripts:

```bash
soroban-id verify "$ID" --quiet && echo "valid"
```

### `revoke [credentialId]`

| Option | Description |
| --- | --- |
| `-s, --secret-key <secret>` | Issuer secret key |
| `-y, --yes` | Skip the confirmation prompt |

## Global options

| Option | Description |
| --- | --- |
| `--config <path>` | Use a specific config file |
| `--network <name>` | `testnet` (default), `mainnet` or `futurenet` preset |
| `--rpc-url <url>` | Override the RPC URL |
| `--json` | Print results as JSON on stdout. Disables prompts |
| `-q, --quiet` | Suppress non-essential output |
| `--no-input` | Never prompt; fail if a required value is missing |

## JSON output

With `--json`, every command writes a single JSON document to stdout. Progress messages go to stderr, so stdout can be piped straight into `jq`:

```bash
ID=$(soroban-id issue GSUBJECT... -t Achievement -c badge=gold -y --json | jq -r .credentialId)
soroban-id verify "$ID" --json
# { "credentialId": "…", "valid": true }
```

Errors are printed as `{ "error": { "message": "...", "code": "..." } }` and the process exits with code `1`.

## Configuration

Settings are merged from these sources, highest precedence first:

1. Command-line flags (`--network`, `--rpc-url`)
2. The file passed with `--config`
3. Environment variables
4. `.soroban-identity.json` in the current directory or any parent directory
5. The global config file: `~/.config/soroban-identity/config.json` (or `$XDG_CONFIG_HOME/soroban-identity/config.json`, or `$SOROBAN_IDENTITY_CONFIG`)
6. Network presets for `rpcUrl` and `networkPassphrase`

Example config file:

```json
{
  "network": "testnet",
  "identityRegistryId": "CABC...",
  "credentialManagerId": "CDEF...",
  "defaultAccount": "GXYZ..."
}
```

| Key | Environment variable |
| --- | --- |
| `network` | `SOROBAN_IDENTITY_NETWORK` |
| `rpcUrl` | `SOROBAN_RPC_URL` |
| `networkPassphrase` | `SOROBAN_NETWORK_PASSPHRASE` |
| `identityRegistryId` | `IDENTITY_REGISTRY_ID` |
| `credentialManagerId` | `CREDENTIAL_MANAGER_ID` |
| `reputationId` | `REPUTATION_ID` |
| `defaultAccount` | `SOROBAN_IDENTITY_ACCOUNT` |
| `txTimeout` | `SOROBAN_TX_TIMEOUT` |

Secret keys are never read from or written to config files. Pass them with `--secret-key`, the `SOROBAN_SECRET_KEY` environment variable, or the hidden prompt. Prefer the environment variable or the prompt, because flags can end up in shell history.

## Development

From the repository root:

```bash
npm install
npm run build:cli
node cli/dist/index.js --help
```

## Publishing

The package is published by `.github/workflows/cli-publish.yml` when a tag matching `cli-v*` is pushed (for example `cli-v0.1.0`). The workflow needs an `NPM_TOKEN` repository secret. The CLI depends on `@soroban-identity/sdk`, which must be published to npm first.
