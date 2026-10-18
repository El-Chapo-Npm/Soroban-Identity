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
  transfer.rs     — Ownership transfer: initiate_transfer, accept_transfer, reject_transfer, get_transfer, get_transfer_history
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
| `initiate_transfer(from, to, credential_id)` | Start a transfer of credential ownership; returns the transfer ID |
| `accept_transfer(to, transfer_id)` | Accept a pending transfer (recipient only) |
| `reject_transfer(to, transfer_id)` | Reject a pending transfer (recipient only) |
| `get_transfer(transfer_id)` | Fetch a transfer record by ID |
| `get_transfer_history(credential_id)` | List all transfer IDs recorded for a credential |

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

## Credential transfer

Ownership of a credential can be moved between addresses, but only with the consent of both parties and (for some credential types) the original issuer.

### Transfer flow

1. **Initiation** — the current holder calls `initiate_transfer(from, to, credential_id)`. `from` must be the credential's current subject/holder and must authorize the call. The contract validates the credential exists, is not revoked, suspended, or expired, and that the credential type permits transfers (see [Type-based restrictions](#type-based-restrictions)). A `TransferRecord` is stored with status `Pending` and a `transfer_id` is returned.
2. **Issuer confirmation** — for credential types that require it, the original issuer must confirm the transfer before it can be accepted. Until then the transfer stays `Pending` and `accept_transfer` fails with `TransferNotConfirmed` (61). Types that do not require confirmation skip this step.
3. **Acceptance / rejection** — the recipient calls `accept_transfer(to, transfer_id)` to take ownership, or `reject_transfer(to, transfer_id)` to decline. Only the address named as `to` may call either function. On acceptance the credential's holder is updated to `to` and the transfer status becomes `Accepted`; on rejection the status becomes `Rejected` and the holder is unchanged.
4. **Expiry** — a pending transfer that is not accepted or rejected before `expires_at` can no longer be accepted (`TransferExpired`, 62). A new transfer must be initiated instead.

### Transfer history

Every transfer is appended to the credential's history index (`(TRANSFER_HIST, credential_id)`), so `get_transfer_history(credential_id)` returns the full ordered list of transfer IDs for that credential, including rejected and expired ones. Individual records are fetched with `get_transfer(transfer_id)`. History is retained across ownership changes and is never pruned.

### Type-based restrictions

Whether a credential may be transferred depends on its `CredentialType`:

| Credential type | Transferable | Issuer confirmation |
|---|---|---|
| `Identity` | Yes | Required |
| `Education` | Yes | Not required |
| `Employment` | Yes | Required |
| `Certification` | Yes | Not required |
| `License` | No | — |
| `Membership` | Yes | Not required |

Attempting to initiate a transfer for a non-transferable type fails with `TransferNotAllowed` (60). These rules are enforced at initiation, so a transfer that was valid when created is not invalidated by later rule changes.

### Transfer fees

A configurable fee may be charged on acceptance, set by the admin via `set_transfer_fee(amount, token)`. The fee is paid by the recipient (`to`) at acceptance time and transferred to the contract's fee collector. If the fee is zero, no token transfer is performed. A recipient without sufficient balance or allowance fails with `TransferFeePaymentFailed` (63), and the transfer remains `Pending` so it can be retried.

### Transfer events

| Event | Topic | Payload |
|---|---|---|
| Transfer initiated | `CRED,transfer_init` | `[eventVersion, transferId, credentialId, from, to]` |
| Transfer accepted | `CRED,transfer_accept` | `[eventVersion, transferId, credentialId, from, to]` |
| Transfer rejected | `CRED,transfer_reject` | `[eventVersion, transferId, credentialId, from, to]` |
| Transfer expired | `CRED,transfer_expire` | `[eventVersion, transferId, credentialId, from, to]` |

See [docs/contract-events.md](../../docs/contract-events.md) for the shared event envelope and versioning rules.

### Transfer edge cases

- Transferring to the current holder fails with `TransferToSelf` (64).
- A credential that is revoked, suspended, or expired cannot be transferred (`CredentialRevoked`, `CredentialSuspended`, `CredentialExpired`).
- Only one pending transfer may exist per credential at a time; initiating another fails with `TransferAlreadyPending` (65).
- Accepting or rejecting a transfer that is not `Pending` (already accepted, rejected, or expired) fails with `TransferNotPending` (66).
- Only the designated recipient may accept or reject; any other caller fails with `Unauthorized`.
- A revoked credential cannot be transferred even if a pending transfer exists; the pending transfer is invalidated.
