# Encryption at rest

`server/src/encryption-at-rest.js` implements envelope encryption:

- **Field encryption:** AES-256-GCM with a fresh data key (DEK) per value. The tenant id and field path are bound as AAD, so ciphertext cannot be moved between tenants or fields.
- **Key management:** DEKs are wrapped by a per-tenant, versioned key-encryption key (KEK). `LocalKms` derives KEKs from `ENCRYPTION_MASTER_KEY` via HKDF. In production, swap in an AWS KMS or Vault Transit adapter that exposes the same `wrap`/`unwrap`/`currentVersion`/`rotate` interface.
- **Rotation:** `kms.rotate(tenant)` bumps the KEK version. Old envelopes stay readable, and `FieldEncryptor#rewrap` migrates them to the current version without touching the data.
- **Audit:** every encrypt, decrypt and rewrap emits an audit event (tenant, field, key version — never plaintext).
- **Encrypted data:** credential claims, PII in DID metadata, API keys and secrets (`SENSITIVE_FIELDS`), and backups (`encryptBackup`/`decryptBackup`).
- **Database TDE:** enable storage-level encryption on the managed database (e.g. RDS `storage_encrypted = true`) as a second layer.
