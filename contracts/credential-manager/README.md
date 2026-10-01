# credential-manager

Soroban smart contract for issuing, verifying, and revoking verifiable credentials.

## Module structure

```
src/
  lib.rs          — Contract entry point; thin wrappers that delegate to submodules
  types.rs        — CredentialType enum and Credential struct
  keys.rs         — Storage key constants and key-builder helpers
  issuer.rs       — Issuer registry: add_issuer, remove_issuer, require_issuer
  credential.rs   — Credential lifecycle: issue_credential, get_credential, get_subject_credentials
  revocation.rs   — Revocation: revoke_credential, verify_credential
  suspension.rs   — Temporary suspension: suspend_credential, reactivate_credential, get_credential_status
```

## Contract functions

| Function | Description |
|---|---|
| `initialize(admin)` | Set the contract admin |
| `add_issuer(issuer)` | Register a trusted issuer (admin only) |
| `remove_issuer(issuer)` | Remove a trusted issuer (admin only) |
| `issue_credential(issuer, subject, type, claims, sig, expires_at)` | Issue a credential; returns its 32-byte ID |
| `revoke_credential(issuer, credential_id)` | Revoke a credential (original issuer only) |
| `verify_credential(credential_id)` | Succeed if the credential exists and is not revoked, suspended, expired, or not yet active |
| `suspend_credential(issuer, credential_id, reason)` | Temporarily suspend a credential (original issuer only) |
| `reactivate_credential(issuer, credential_id)` | Lift a suspension (original issuer only) |
| `get_suspension(credential_id)` | The active `SuspensionRecord`, or `None` |
| `is_credential_suspended(credential_id)` | Whether the credential is currently suspended |
| `get_credential_status(credential_id)` | `Active`, `Suspended`, `Revoked`, `Expired`, or `NotYetActive` |
| `get_credential(credential_id)` | Fetch a credential by ID |
| `get_subject_credentials(subject)` | List all credential IDs issued to a subject |

## Issuer credential ring buffer

Each issuer's reverse-lookup index (`get_issuer_credentials`) is capped at `MAX_ISSUER_CREDS` (10,000) entries. Once an issuer reaches the cap, issuing a new credential evicts the oldest entry (FIFO) to make room — the credential itself is **not** deleted or revoked, only its reference in that issuer's index is dropped. An `evicted` event (topic `CRED,evicted`, payload `[eventVersion, issuer, evictedId]`, see [docs/contract-events.md](../../docs/contract-events.md)) is emitted whenever this happens, so off-chain indexers can detect the eviction and re-index the dropped credential ID by other means (e.g. `get_subject_credentials`) if needed.

## Credential suspension

Suspension is a reversible alternative to revocation, for credentials that should stop verifying for a while (an open investigation, a suspected but unconfirmed key compromise, an unmet condition) without being permanently revoked.

- `suspend_credential(issuer, credential_id, reason)` stores a `SuspensionRecord` (`reason`, `suspended_by`, `suspended_at`) and emits `CRED,suspended`. `reason` is a `SuspensionReason`: `Unspecified`, `UnderInvestigation`, `SuspectedKeyCompromise`, `ConditionUnmet`, `SubjectRequest` or `Administrative`.
- `reactivate_credential(issuer, credential_id)` removes the record and emits `CRED,unsuspend`.
- While suspended, `verify_credential` and `verify_credential_as_delegate` fail with `CredentialSuspended` (51), `verify_credentials_batch` reports the credential as invalid, and any credential that lists it as a prerequisite fails with `PrerequisiteNotMet`. Unlike revocation, suspension does not cascade: dependants verify again once the parent is reactivated.
- Revocation stays permanent. A revoked credential cannot be suspended, a suspended credential can still be revoked, and a revoked credential cannot be reactivated (`CredentialRevoked`). Reactivating a credential that is not suspended fails with `CredentialNotSuspended` (52).
- Reactivation does not touch the expiry, so a credential that expired while suspended stays expired.

The suspension record lives in its own storage entry (`(SUSPEND, credential_id)`) rather than as a field on `Credential`, so credentials stored before this feature still decode.
