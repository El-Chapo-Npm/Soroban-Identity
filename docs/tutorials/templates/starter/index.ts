import { IdentityClient, type SorobanIdentityConfig } from "@soroban-identity/sdk";
import { Keypair, Networks } from "@stellar/stellar-sdk";

const config: SorobanIdentityConfig = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  identityRegistryId: process.env.IDENTITY_REGISTRY_ID ?? "",
  credentialManagerId: process.env.CREDENTIAL_MANAGER_ID ?? "",
  reputationId: process.env.REPUTATION_ID ?? "",
};

const keypair = Keypair.random();
await fetch(`https://friendbot.stellar.org?addr=${keypair.publicKey()}`);

const identity = new IdentityClient(config);
const created = await identity.createDid(keypair, { name: "starter" });
console.log("Created DID:", created.data?.did);
console.log("Resolved:", await identity.resolveDid(keypair.publicKey()));
