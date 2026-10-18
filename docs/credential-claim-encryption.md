# Credential Claim Encryption

Issue #947 (SC-21). Source: [`contracts/credential-manager/src/encryption.rs`](../contracts/credential-manager/src/encryption.rs).

Issue #1049 adds transport encryption for sensitive credential data in transit. See [Request/response encryption](#requestresponse-encryption-issue-1049) below.

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

## Request/response encryption (issue #1049)

The on-chain scheme above protects data at rest. Issue #1049 adds end-to-end encryption for sensitive credential data in transit between the client and the backend API, so that plaintext credentials never appear on the wire.

### Overview

- The backend generates a fresh symmetric key **per session**; no long-lived transport key is reused across sessions.
- Sensitive fields in responses are encrypted with **AES-256-GCM** (authenticated encryption).
- Clients decrypt locally with the session key; the backend never returns plaintext for the covered fields.
- Session keys are rotated on a fixed interval and on demand, and a key exchange protocol establishes the shared key without transmitting it.

### Session key exchange

The session key is derived with an ephemeral X25519 ECDH handshake followed by HKDF-SHA256, so the key itself is never sent over the wire:

1. The client generates an ephemeral X25519 key pair and sends its public key with the session request.
2. The backend generates its own ephemeral X25519 key pair for the session and returns its public key.
3. Both sides compute the shared secret `X25519(ephemeral_sk, peer_ephemeral_pk)`.
4. The 32-byte AES-256-GCM session key is derived as `HKDF-SHA256(shared_secret, salt = client_nonce || server_nonce, info = "soroban-identity/transport/v1", length = 32)`.
5. The handshake is authenticated by binding the session to the caller's existing auth token, so a party without a valid token cannot complete the exchange.

The ephemeral key pairs are discarded when the session ends. Because the key is derived rather than transmitted, an observer of the handshake cannot recover the session key.

### AES-GCM parameters

| Purpose | Algorithm | Parameters |
| --- | --- | --- |
| Session key | X25519 + HKDF-SHA256 | 32-byte key, `info = "soroban-identity/transport/v1"` |
| Field encryption | AES-256-GCM | 32-byte key, random 96-bit (12-byte) nonce per message, 128-bit auth tag |
| Nonce | Random per message | Never reused under the same session key; a nonce collision forces a key rotation |

Each encrypted field is transmitted as `{ "alg": "A256GCM", "kid": <key_id>, "nonce": <base64>, "ct": <base64> }`, where `ct` is the ciphertext with the 16-byte GCM tag appended. The field name and the session id are passed as additional authenticated data (AAD), so a ciphertext cannot be replayed under a different field or session.

### Sensitive fields covered

The following response fields are encrypted when present:

- credential claim values for fields marked sensitive,
- wrapped DEKs and encryption metadata returned by the credential endpoints,
- holder PII (name, date of birth, document numbers),
- access tokens and refresh tokens,
- any field explicitly flagged `sensitive` by the API schema.

Non-sensitive fields (ids, timestamps, status flags, field names) stay in plaintext so clients can route and cache responses without decrypting.

### Key rotation

- Session keys have a maximum lifetime (default 15 minutes) and a maximum message count; whichever is reached first triggers rotation.
- Rotation runs a fresh X25519/HKDF handshake and issues a new `kid`. The old key is retained only long enough to decrypt in-flight responses, then discarded.
- A response always carries the `kid` it was encrypted with, so a client that receives a response across a rotation can still decrypt it.
- If a session key is suspected compromised, the client can request immediate rotation; the backend invalidates the old key and rejects further messages that reference it.

### Client-side decryption

1. Complete the key exchange and derive the session key (see above).
2. For each encrypted field, read `kid`, `nonce`, and `ct`.
3. Decrypt with AES-256-GCM using the session key for that `kid`, the transmitted nonce, and the AAD `field_name || session_id`.
4. Verify the 16-byte auth tag; if verification fails, discard the response and do not use any of its fields.
5. Decode the resulting plaintext according to the field's declared type.

Clients must never log session keys or decrypted sensitive fields, and must zero key material when the session ends.

### Threat model note

Transport encryption protects data in transit and complements, but does not replace, the on-chain claim encryption. It does not protect against a compromised client or backend endpoint, and it does not hide traffic metadata (sizes, timing, endpoints). Confidentiality of stored claims still comes from the on-chain scheme described above.
