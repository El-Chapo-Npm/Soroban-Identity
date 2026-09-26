# Tutorial 3: Credential Lifecycle

**Level:** Intermediate · **Time:** 25 min · **Last checked against:** SDK 0.1.0
**Prerequisite:** [Tutorial 2](./02-did-management.md)

This tutorial walks through a credential from issuance to verification to revocation.

## 1. Hash the claims

The contract stores a 32-byte hash of the claims, not the claims themselves.

```ts
import { createHash } from "node:crypto";

const claims = { country: "NG", level: "2" };
const claimsHashHex = createHash("sha256").update(JSON.stringify(claims)).digest("hex");
```

## 2. Issue

The issuer must be registered as an issuer on the credential manager.

```ts
import { CredentialClient } from "@soroban-identity/sdk";

const credentials = new CredentialClient(config);
const issued = await credentials.issueCredential(
  issuerKeypair,
  subjectAddress,
  "Kyc",            // "Kyc" | "Reputation" | "Achievement" | "Custom"
  claims,
  claimsHashHex,
  0                 // expiresAt: 0 means no expiry
);
const credentialId = issued.data!.credentialId;
```

## 3. Verify

```ts
const result = await credentials.verifyCredential(verifierAddress, credentialId);
console.log(result);
```

## 4. Renew or revoke

```ts
await credentials.revokeCredential(issuerKeypair, credentialId);
```

To revoke many credentials at once, use `revokeBatch`. To issue many, use `issueCredentialBatch`.

## Exercises

1. Issue a credential with an expiry one hour ahead, then verify it after it expires.
2. List a subject's credentials with `getCredentialsBySubject`.

See also: [Verifiable credentials (JSON-LD)](../verifiable-credentials-jsonld.md), [Contract events](../contract-events.md).
Next: [Tutorial 4: Reputation System](./04-reputation-system.md).
