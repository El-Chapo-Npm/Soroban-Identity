# Security Best Practices Guide

Security recommendations for developers integrating with or building on top of Soroban Identity.

---

## 1. Key Management

### Private Key Storage
- **Never store private keys in source code**, environment variables in CI logs, or plaintext configuration files.
- Use a secrets manager (HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager) or an HSM for production key material. See [`docs/secret-management.md`](../secret-management.md) for the server-side implementation.
- Keys used to sign Soroban transactions should reside in a dedicated signing service with strict ACLs, not on the application server itself.

### Key Rotation
- Rotate API keys on a regular schedule (90 days recommended for long-lived keys) and immediately on suspected compromise.
- Use the `POST /admin/api-keys/:id/rotate` endpoint to rotate a key without downtime; the endpoint issues a new key and revokes the old one atomically.
- For Stellar account keys, set up a 2-of-N multisig threshold policy so a single compromised key cannot authorise transactions.

### Recovery Address Security
- Always set a recovery address (`set_recovery_address`) on every DID you control, stored in a different custody path than the primary key.
- The recovery address should be a cold-storage key or a hardware wallet; it is the last line of defence for account recovery.
- Monitor the `(recovery, init)` contract event off-chain. Any unexpected recovery initiation should trigger an immediate `cancel_recovery` call within the 24-hour timelock window.

---

## 2. Secure Credential Storage

### At Rest
- Credentials stored by the server are written to the configured `dataDir`. Ensure this directory is:
  - Encrypted at rest (OS-level encryption or encrypted volume).
  - Readable only by the server process user (mode `0700`).
  - Excluded from backups that leave the security boundary (e.g. unencrypted S3 snapshots).
- Never log full credential payloads; log only IDs and action types.

### In Transit
- All API traffic must use TLS 1.2 or later. Disable older cipher suites and SSLv3/TLSv1.
- Use HSTS (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`) to prevent protocol downgrade attacks.
- Verify that the server's TLS certificate is pinned or validated against a trusted CA in SDK/client integrations.

### Verifiable Credential Claims
- Sensitive claim values (PII, financial data) should be selectively disclosed using the selective-disclosure module (`contracts/selective-disclosure`) rather than stored in full on-chain or in the credential document.
- Encrypt claim payloads before storing them; see [`docs/credential-claim-encryption.md`](../credential-claim-encryption.md).

---

## 3. API Authentication Recommendations

### API Keys
- Issue keys with the **minimum required scopes** (principle of least privilege). Available scopes are documented in [`docs/api-key-scopes.md`](../api-key-scopes.md).
- Set `expiresInDays` for all non-service-account keys; avoid keys with no expiry.
- Transmit API keys in the `Authorization: Bearer <key>` header, not in query parameters (query strings appear in access logs and browser history).

### OAuth 2.0
- For user-delegated access, prefer the OAuth 2.0 Authorization Code flow over API keys. See [`docs/oauth2.md`](../oauth2.md).
- Store OAuth client secrets with the same controls as private keys (secrets manager, not config files).
- Validate `redirect_uri` strictly against the registered value; any prefix/suffix flexibility enables open-redirect attacks.

### Request Signing
- Enable request signing (`REQUEST_SIGNING_ENABLED=true`) in production to prevent replay attacks and detect request tampering. See [`docs/request-signing.md`](../request-signing.md).
- Use a per-request nonce and include a short `X-Timestamp` window (default: 300 seconds) to bound replay windows.

### Rate Limiting and Quota
- The built-in rate limiter (`server/src/middleware/ratelimit.js`) protects against credential-stuffing and enumeration attacks. Do not disable it in production.
- Configure IP-based limits conservatively; attackers behind proxies can share IPs with legitimate users, so per-user limits should be the primary defence.

---

## 4. Common Attack Vectors and Mitigations

### Credential Forgery
- **Threat:** Attacker creates a credential with a forged issuer or subject.
- **Mitigation:** Only addresses in the `issuers` list (enforced on-chain by `credential-manager`) can issue credentials. Verify the issuer address on-chain before trusting a credential.

### DID Hijacking
- **Threat:** Attacker gains control of a DID controller key and deactivates or transfers the DID.
- **Mitigation:** Set a recovery address on every DID. Monitor `(IDENTITY, deact)` and `(recovery, init)` events. Use multi-sig for high-value DIDs.

### Replay Attacks
- **Threat:** Attacker captures a valid API request and re-submits it.
- **Mitigation:** Enable HMAC request signing with nonce tracking. The `NonceStore` in `server/src/request-signing.js` rejects replayed nonces within the configured window.

### Injection via Metadata
- **Threat:** Attacker crafts DID metadata with oversized keys/values to exhaust storage or inflate gas costs.
- **Mitigation:** The contract enforces a hard limit of 10 metadata entries, 64-byte keys, and 256-byte values (`validate_metadata` in `lib.rs`). The server validates payloads at the boundary before forwarding to Soroban.

### Enumeration
- **Threat:** Attacker iterates credential IDs or DID addresses to harvest data.
- **Mitigation:** Use opaque cursor-based pagination (not sequential integer IDs). Rate limiting at the IP and user level further throttles enumeration attempts. See [`docs/cursor-pagination.md`](../cursor-pagination.md).

### Content Security Policy Bypass
- **Threat:** XSS via injected scripts in API responses rendered in a browser context.
- **Mitigation:** CSP headers are set server-wide with a per-request nonce (`setSecurityHeaders` in `server/src/security-headers.js`). See [`docs/content-security-policy.md`](../content-security-policy.md).

### Denial of Service
- **Threat:** Attacker floods the API with large batch operations or high-frequency requests.
- **Mitigation:** `create_dids_batch` is capped at `MAX_BATCH_DIDS = 50`. The DDoS protection layer (`server/src/ddos-protection.js`) applies traffic shaping before any business logic runs. See [`docs/security/rate-limiting-advanced.md`](rate-limiting-advanced.md).

---

## 5. Security Checklist for Integrators

Use this checklist before deploying an integration to production.

### Credential Issuance
- [ ] Issuer address is registered on-chain with `add_issuer` before issuing credentials.
- [ ] Issued credentials include an expiry (`expiresAt`) appropriate for the claim type.
- [ ] Sensitive claim fields are encrypted or selectively disclosed.
- [ ] A webhook is configured to receive `credential.revoked` events for cache invalidation.

### DID Management
- [ ] Every DID has a recovery address set via `set_recovery_address`.
- [ ] Recovery address is stored in a separate custody path (cold wallet or HSM).
- [ ] An off-chain monitor alerts on `(recovery, init)` events within minutes.
- [ ] DID documents do not contain PII in metadata fields (store references, not raw data).

### API Integration
- [ ] API keys carry only the scopes required for the integration.
- [ ] API keys have an expiry and a rotation schedule.
- [ ] API key secrets are stored in a secrets manager, not in `.env` files committed to source control.
- [ ] All requests use TLS; no HTTP fallback is configured.
- [ ] Request signing is enabled for all state-changing endpoints in production.
- [ ] Rate limit headers (`X-RateLimit-*`) are monitored to detect approaching limits.

### Infrastructure
- [ ] The credential data directory (`dataDir`) is encrypted at rest and restricted to the server process.
- [ ] Audit logs (`/admin/audit-logs`) are shipped to a write-once log store.
- [ ] Backup snapshots are encrypted and access-controlled.
- [ ] The server runs as a non-root user with no write access outside `dataDir`.
- [ ] Dependency versions are pinned and monitored for CVEs (Dependabot is configured in `.github/dependabot.yml`).

---

## 6. OWASP References

The following OWASP resources are directly applicable to this system:

| Topic | Resource |
| :--- | :--- |
| API Security | [OWASP API Security Top 10](https://owasp.org/www-project-api-security/) |
| Secret Storage | [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) |
| Authentication | [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) |
| Key Management | [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) |
| Input Validation | [OWASP Input Validation Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html) |
| Transport Security | [OWASP Transport Layer Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html) |
| Logging & Monitoring | [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) |

For incident response procedures specific to this project, see [`docs/security/incident-response.md`](incident-response.md).
