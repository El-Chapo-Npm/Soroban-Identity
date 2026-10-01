# Credential Claim Encryption

Issue #947 (SC-21). Source: [`contracts/credential-manager/src/encryption.rs`](../contracts/credential-manager/src/encryption.rs).

## Overview

Soroban ledger state is public. The credential-manager contract therefore never receives plaintext sensitive claims or symmetric keys. Issuers encrypt sensitive fields off-chain. The contract does four things:

- stores the ciphertext and the per-recipient wrapped keys,
- gates who can fetch them through `require_auth` and access grants,
- records encryption metadata for each credential,
- verifies salted commitments when a holder discloses individual fields.

A credential can hold both kinds of claim. Non-sensitive claims stay in the plaintext `claims` map. Sensitive claims go only in the encrypted field map, and the contract rejects any field name that appears in both.

## Encryption standards

| Purpose | Algorithm | Parameters |
| --- | --- | --- |
| Recipient keys | X25519 (RFC 7748) | 32-byte public key, `KEY_ALG_X25519 = 0` |
| Field encryption | XChaCha20-Poly1305 (draft-irtf-cfrg-xchacha) | Random 32-byte DEK per credential, random 24-byte nonce per field, field name as AAD |
| Key wrapping | ECIES: ephemeral X25519 → HKDF-SHA256 (RFC 5869) → XChaCha20-Poly1305 | HKDF `info = "soroban-identity/claim-dek/v1"`, salt = `ephemeral_pk \|\| recipient_pk`; wrapped DEK is 48 bytes (32 + 16-byte tag) |
| Field commitments | SHA-256 | `SHA-256(salt[32] \|\| u32_be(len(name)) \|\| name_utf8 \|\| value_utf8)`, random 32-byte salt per field |

Scheme identifier `ENC_SCHEME_XCHACHA20_X25519 = 0` is recorded in each credential's metadata. A future scheme gets a new identifier. Existing credentials keep the one they were created with.

Limits: at most 32 encrypted fields per credential, field names up to 64 bytes, field ciphertext up to 4096 bytes, and at most 50 readers per credential.

## Key management

- `register_encryption_key(owner, public_key, algorithm) -> version` registers or rotates the owner's X25519 public key. Versions start at 1 and increase on each rotation.
- `revoke_encryption_key(owner)` marks the current key revoked. New grants to a revoked key are rejected.
- `get_encryption_key(owner)`.

Each `WrappedKey` records the `recipient_key_version` it was sealed for. The contract rejects a wrap whose version does not match the recipient's current key. Rotating a key does not re-encrypt existing grants. After rotating, a subject re-grants access with the DEK wrapped to the new key.

## Flow

```mermaid
sequenceDiagram
  participant I as Issuer
  participant C as CredentialManager
  participant S as Subject
  participant V as Verifier
  S->>C: register_encryption_key(pk_s)
  V->>C: register_encryption_key(pk_v)
  I->>C: issue_credential(non-sensitive claims)
  Note over I: DEK ← random; encrypt fields; commit(salt, name, value); wrap DEK to pk_s
  I->>C: attach_encrypted_claims(fields, wrap_s)
  S->>C: get_encrypted_claims() → fields + wrap_s
  Note over S: unwrap DEK, decrypt; re-wrap DEK to pk_v
  S->>C: grant_claim_access(V, wrap_v, fields=[dob], expires_at)
  V->>C: get_encrypted_claims() → {dob} + wrap_v
  S-->>V: disclose (name, value, salt) off-chain
  V->>C: verify_claim_disclosure([...]) → true
```

## Access control

`get_encrypted_claims(reader, credential_id)` succeeds only when all of these hold:

1. `reader` authorizes the call,
2. the credential exists, is not revoked, and is not expired,
3. `reader` has a grant that is not expired (`expires_at = 0` means it never expires).

It returns only the fields the grant covers (an empty `fields` list means all of them), along with the reader's wrapped DEK and the metadata.

The issuer's attach call grants the subject access to all fields automatically. After that, only the subject can issue grants (`grant_claim_access`) or revoke them (`revoke_claim_access`). The subject's own grant cannot be revoked.

**Threat model note:** the grant check controls the contract interface. It does not provide confidentiality, because anyone can read raw ledger entries. Confidentiality comes from the encryption itself: without a wrapped DEK sealed to your key, the ciphertext is unreadable. Revoking a grant stops future fetches through the contract, but a reader who already unwrapped the DEK keeps it. To fully cut off a reader, the issuer must re-issue the credential under a new DEK.

## Partial disclosure

The holder reveals `(field, value, salt)` only for the fields they choose. Anyone can call `verify_claim_disclosure(credential_id, disclosures)`. It returns `true` only if every disclosed triple matches its stored commitment on a live credential, and it reveals nothing about the other fields. Clients can use `claim_commitment(field, value, salt)` to check that their off-chain encoding matches the contract's.

## Metadata

`get_encryption_metadata(credential_id)` returns an `EncryptionMetadata` with these fields:

- `scheme`
- `key_algorithm`
- `encrypted_fields` (names only)
- `encrypted_by`
- `encrypted_at`
- `subject_key_version`

`get_claim_readers(credential_id)` lists the current grant holders.

## Events

Every event is published under the topic `("ENC", <action>)`:

| Action | Data |
| --- | --- |
| `key_reg` | `(v, owner, version, pk)` |
| `key_rev` | `(v, owner, version)` |
| `attached` | `(v, cred_id, issuer, field_count)` |
| `granted` | `(v, cred_id, reader, field_count, expires_at)` |
| `revoked` | `(v, cred_id, reader)` |
| `accessed` | `(v, cred_id, reader)` |

## Errors

| Code | Name |
| --- | --- |
| 33 | `EncryptionKeyNotFound` |
| 34 | `EncryptionKeyRevoked` |
| 35 | `InvalidEncryptionKey` |
| 36 | `EncryptedClaimsNotFound` |
| 37 | `EncryptedClaimsAlreadyAttached` |
| 38 | `InvalidEncryptedField` |
| 39 | `AccessDenied` |
| 40 | `AccessGrantExpired` |
| 41 | `SensitiveClaimInPlaintext` |
| 42 | `TooManyEncryptedFields` |
| 43 | `UnsupportedEncryptionScheme` |
| 44 | `TooManyClaimReaders` |
