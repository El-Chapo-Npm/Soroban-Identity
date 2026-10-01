# Tutorial 2: DID Management

**Level:** Beginner · **Time:** 15 min · **Last checked against:** SDK 0.1.0
**Prerequisite:** [Tutorial 1](./01-getting-started.md)

## Create a DID

```ts
import { IdentityClient } from "@soroban-identity/sdk";

const identity = new IdentityClient(config);
const created = await identity.createDid(keypair, { name: "Alice" });
console.log("DID:", created.data?.did);
```

## Resolve a DID

```ts
const doc = await identity.resolveDid(keypair.publicKey());
console.log(doc);
```

## Update metadata

```ts
await identity.updateDid(keypair, { name: "Alice", website: "https://alice.example" });
```

Only the controller keypair can update its DID. Signing with another key fails with an authorization error.

## Exercises

1. Resolve a DID that does not exist and handle the error.
2. Pass `{ timeoutSeconds: 60 }` as `CallOptions` to `createDid`.

API reference: `IdentityClient` in the [TypeDoc docs](../index.md).
Next: [Tutorial 3: Credential Lifecycle](./03-credential-lifecycle.md).
