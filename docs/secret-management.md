# Secret management with HashiCorp Vault

Soroban Identity supports HashiCorp Vault as the source of runtime credentials. The server keeps the existing environment-variable names as its internal configuration interface, but when Vault is enabled it resolves those values before configuration validation. This allows the deployment platform to inject only Vault connection metadata while the application reads API keys, signing keys, webhook credentials, and Stellar deployment keys from Vault.

## Configuration

Set the following non-secret connection settings in the service environment:

| Variable | Purpose |
| --- | --- |
| `VAULT_ENABLED=true` | Explicitly enable Vault. It is also enabled when both `VAULT_ADDR` and `VAULT_SECRET_PATH` are set. |
| `VAULT_ADDR` | Vault HTTPS base URL. |
| `VAULT_SECRET_PATH` or `VAULT_SECRET_PATHS` | KV v2 path, or comma-separated KV v2 paths, to read. |
| `VAULT_ROLE` | Vault JWT auth role for the service or GitHub Actions workflow. |
| `VAULT_JWT` | Optional JWT supplied by the runtime. GitHub Actions may use its OIDC token through the Vault action instead. |
| `VAULT_REFRESH_INTERVAL_SECONDS` | Optional refresh interval. If unset, refresh occurs at 80% of the shortest lease, with a 30-second minimum. |
| `VAULT_AUDIT_LOG_PATH` | Optional mode-600 NDJSON file containing access metadata, never secret values. |
| `VAULT_SECRET_MAPPINGS` | Optional JSON map from Vault keys to existing environment names. |

`VAULT_TOKEN` is supported for local development and break-glass operation, but production services should use short-lived JWT authentication. Do not commit a token, JWT, Vault namespace, or secret value.

Example mapping:

```json
{
  "stellar_deploy_key": "STELLAR_SECRET_KEY",
  "admin_api_key": "ADMIN_API_KEY",
  "vc_proof_private_key": "VC_PROOF_PRIVATE_KEY",
  "email_api_key": "EMAIL_API_KEY"
}
```

A KV v2 secret at `secret/soroban-identity/production` is addressed by the API as `secret/data/soroban-identity/production`. The GitHub Actions workflows use the same path convention and authenticate with the repository’s OIDC identity. The Vault role should bind the repository and branch claims and should grant read access only to the exact paths needed by that workflow.

## Rotation and leases

Secret rotation is performed by writing the new value to the same Vault key and allowing the next lease refresh to update the process environment. For credentials that must be invalidated immediately, revoke the old credential at its provider before writing the replacement. The server schedules a refresh at 80% of the shortest returned lease duration, or at `VAULT_REFRESH_INTERVAL_SECONDS` when explicitly configured. A failed refresh keeps the last valid secret and emits an operational error without printing its value; a future refresh is still scheduled.

The server fails closed during startup when Vault is explicitly enabled and cannot authenticate or read the configured paths. It does not silently fall back to plaintext environment secrets. This prevents a deployment from appearing healthy while using an unexpected credential source.

## Audit logging

When `VAULT_AUDIT_LOG_PATH` is set, each read records the UTC timestamp, service name, path, key names, and lease duration in append-only NDJSON. Values and tokens are never logged. Vault’s own audit device remains the authoritative record for authentication and policy decisions; the application log is a correlation aid for lease refreshes.

## Local development

Vault can be omitted for local development. Copy `server/.env.example`, use non-production test credentials, and leave `VAULT_ENABLED` unset. To exercise the integration locally, run a development Vault server, enable KV v2, write test values, and provide a short-lived `VAULT_TOKEN`. Do not use production paths or credentials in a development Vault.

## GitHub Actions

The production frontend and canary workflows use `hashicorp/vault-action` with GitHub OIDC. Configure `VAULT_ADDR` as an Actions secret and the Vault role name as an Actions variable. The role should allow only the repository and the `main` branch for production deployment, while canary workflows should be restricted through repository environments and required reviewers. The workflows pass the resulting credentials directly to the deployment command and never write them to the repository or build output.
