# Secret management with an environment vault

Soroban Identity resolves runtime credentials from an external vault before configuration validation. HashiCorp Vault and Doppler are supported; the application keeps the existing environment-variable names as its internal interface, so the deployment platform only injects connection metadata and never stores secret values in the repository or container images. This covers API keys, signing keys, Stellar deployment keys, the Postgres connection string (`DATABASE_URL`) and the IPFS API key (`IPFS_API_KEY`).

## Configuration

Set the following non-secret connection settings in the service environment:

| Variable | Purpose |
| --- | --- |
| `SECRETS_PROVIDER` | `vault` (default) or `doppler`. |
| `SECRET_MAPPINGS` | JSON map from provider keys to existing environment names. `VAULT_SECRET_MAPPINGS` remains supported as an alias. |
| `SECRETS_REFRESH_INTERVAL_SECONDS` | Optional refresh interval. If unset, Vault uses 80% of the shortest lease (30-second minimum) and Doppler refreshes every 15 minutes. |
| `VAULT_AUDIT_LOG_PATH` | Optional mode-600 NDJSON file containing access metadata, never secret values. |

HashiCorp Vault configuration:

| Variable | Purpose |
| --- | --- |
| `VAULT_ENABLED=true` | Explicitly enable Vault. It is also enabled when both `VAULT_ADDR` and `VAULT_SECRET_PATH` are set. |
| `VAULT_ADDR` | Vault HTTPS base URL. |
| `VAULT_SECRET_PATH` or `VAULT_SECRET_PATHS` | KV v2 path, or comma-separated KV v2 paths, to read. |
| `VAULT_ROLE` | Vault JWT auth role for the service or GitHub Actions workflow. |
| `VAULT_JWT` | Optional JWT supplied by the runtime. GitHub Actions may use its OIDC token through the Vault action instead. |

`VAULT_TOKEN` is supported for local development and break-glass operation, but production services should use short-lived JWT authentication. Do not commit a token, JWT, Vault namespace, or secret value.

Doppler configuration (set `SECRETS_PROVIDER=doppler`):

| Variable | Purpose |
| --- | --- |
| `DOPPLER_TOKEN` | Service token with read access to the config. Inject from the deployment platform. |
| `DOPPLER_PROJECT` | Doppler project slug. |
| `DOPPLER_CONFIG` | Doppler config slug, for example `production`. |
| `DOPPLER_API_URL` | Optional override of the Doppler secrets download endpoint. |

The server fails closed when Doppler is selected but any of `DOPPLER_TOKEN`, `DOPPLER_PROJECT` or `DOPPLER_CONFIG` is missing. Doppler secrets are downloaded over HTTPS with bearer authentication and mapped with the same `SECRET_MAPPINGS` table; refresh re-downloads the config without ever logging values.

Example mapping:

```json
{
  "stellar_deploy_key": "STELLAR_SECRET_KEY",
  "admin_api_key": "ADMIN_API_KEY",
  "vc_proof_private_key": "VC_PROOF_PRIVATE_KEY",
  "email_api_key": "EMAIL_API_KEY",
  "db_primary_url": "DATABASE_URL",
  "ipfs_api_key": "IPFS_API_KEY"
}
```

A KV v2 secret at `secret/soroban-identity/production` is addressed by the API as `secret/data/soroban-identity/production`. The GitHub Actions workflows use the same path convention and authenticate with the repository’s OIDC identity. The Vault role should bind the repository and branch claims and should grant read access only to the exact paths needed by that workflow.

## Rotation and leases

Secret rotation is performed by writing the new value to the same provider key and allowing the next refresh to update the process environment. For credentials that must be invalidated immediately, revoke the old credential at its provider before writing the replacement. Vault refreshes at 80% of the shortest returned lease duration; Doppler refreshes every 15 minutes. Set `SECRETS_REFRESH_INTERVAL_SECONDS` to override either cadence. A failed refresh keeps the last valid secret and emits an operational error without printing its value; a future refresh is still scheduled.

The server fails closed during startup when a provider is explicitly configured and cannot authenticate or read the configured secrets. It does not silently fall back to plaintext environment secrets. This prevents a deployment from appearing healthy while using an unexpected credential source.

## Audit logging

When `VAULT_AUDIT_LOG_PATH` is set, each read records the UTC timestamp, service name, provider, path or Doppler config, key names, and lease duration in append-only NDJSON. Values and tokens are never logged. The provider's own audit log remains authoritative for authentication and policy decisions; the application log is a correlation aid for refreshes.

Deployment manifests must not carry fallback values for secrets. `infrastructure/deployment/docker-compose.yml` uses required interpolation for `POSTGRES_PASSWORD` and `REPLICATION_PASSWORD`, so Compose fails fast if the vault-injected values are absent.

## Local development

Vault can be omitted for local development. Copy `server/.env.example`, use non-production test credentials, and leave `VAULT_ENABLED` unset. To exercise the integration locally, run a development Vault server, enable KV v2, write test values, and provide a short-lived `VAULT_TOKEN`. Do not use production paths or credentials in a development Vault.

## GitHub Actions

The production frontend and canary workflows use `hashicorp/vault-action` with GitHub OIDC. Configure `VAULT_ADDR` as an Actions secret and the Vault role name as an Actions variable. The role should allow only the repository and the `main` branch for production deployment, while canary workflows should be restricted through repository environments and required reviewers. The workflows pass the resulting credentials directly to the deployment command and never write them to the repository or build output.
