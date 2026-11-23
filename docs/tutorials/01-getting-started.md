# Tutorial 1: Getting Started

**Level:** Beginner · **Time:** 10 min · **Last checked against:** SDK 0.1.0

You will install the SDK, configure it for Stellar testnet, and check that the contracts respond.

<iframe src="https://codesandbox.io/p/github/El-Chapo-Npm/Soroban-Identity/main?file=docs/tutorials/templates/starter/index.ts&embed=1" style="width:100%;height:500px;border:0" title="Getting started sandbox" sandbox="allow-scripts allow-same-origin"></iframe>

## 1. Install

```bash
npm install @soroban-identity/sdk @stellar/stellar-sdk
```

## 2. Configure

```ts
import type { SorobanIdentityConfig } from "@soroban-identity/sdk";
import { Networks } from "@stellar/stellar-sdk";

export const config: SorobanIdentityConfig = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  identityRegistryId: process.env.IDENTITY_REGISTRY_ID!,
  credentialManagerId: process.env.CREDENTIAL_MANAGER_ID!,
  reputationId: process.env.REPUTATION_ID!,
};
```

`rpcUrl` also accepts an array of URLs for failover.

## 3. Create a funded testnet account

```ts
import { Keypair } from "@stellar/stellar-sdk";

const keypair = Keypair.random();
await fetch(`https://friendbot.stellar.org?addr=${keypair.publicKey()}`);
```

## 4. Check that the contracts respond

```ts
import { IdentityClient } from "@soroban-identity/sdk";

const identity = new IdentityClient(config);
console.log("identity registry initialized:", await identity.isInitialized());
```

## Next

[Tutorial 2: DID Management](./02-did-management.md). If something failed, see [troubleshooting](./troubleshooting.md).
