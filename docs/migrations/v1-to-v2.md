# Migrating from v1 to v2

This guide covers the v2 SDK and contract interface changes. The transition is additive at the wire level, but callers must update typed imports and credential validation before switching the production network configuration.

## What changed

- SDK exports are grouped by capability (`identity`, `credentials`, `reputation`, and `presentation`).
- Credential verification returns a structured result instead of a boolean so callers can distinguish expiry, revocation, and signature failures.
- Contract clients require an explicit network configuration; implicit testnet defaults were removed.
- Pagination cursors are opaque strings and must not be parsed by clients.

## Why

The v1 surface made it easy to accidentally verify a credential against the wrong network and forced applications to collapse actionable verification failures into a generic `false` result. v2 makes those boundaries explicit and leaves room for backwards-compatible cursor changes.

## How to migrate

Before:

```ts
import { verifyCredential } from '@soroban-identity/sdk'
const valid = await verifyCredential(credential)
if (!valid) throw new Error('Invalid credential')
```

After:

```ts
import { createIdentityClient } from '@soroban-identity/sdk'

const client = createIdentityClient({
  rpcUrl: process.env.SOROBAN_RPC_URL!,
  networkPassphrase: process.env.SOROBAN_NETWORK_PASSPHRASE!,
})

const result = await client.credentials.verify(credential)
if (!result.valid) {
  throw new Error(`Credential rejected: ${result.reason}`)
}
```

## Compatibility matrix

| Component | v1 | v2 | Notes |
| --- | --- | --- | --- |
| SDK | 1.x | 2.x | Upgrade application imports and client configuration. |
| Contracts | 1.x | 2.x | Deploy v2 beside v1 and migrate identities in batches. |
| Node.js | 18+ | 20+ | v2 CI and supported runtime use Node.js 20 or newer. |
| Rust | 1.74+ | 1.80+ | Use the toolchain in `rust-toolchain.toml`. |

## Common pitfalls

- Do not parse or persist cursor internals; pass the complete cursor back to the next request.
- Do not use a v1 network passphrase with a v2 client.
- Keep v1 contract IDs in the read path until the migration verification report is complete.
- Treat `expired`, `revoked`, and `invalid_signature` as separate user-facing outcomes.

## Breaking-change checklist

- [ ] Update SDK imports and network configuration.
- [ ] Update verification error handling.
- [ ] Regenerate API and contract bindings.
- [ ] Run unit, integration, and contract tests.
- [ ] Deploy and verify on testnet.
- [ ] Monitor error rates for one release window.
- [ ] Remove the v1 fallback only after all clients have migrated.

Estimated effort: **2–4 engineering hours** for a typical SDK integration, excluding contract deployment and production canary monitoring.
