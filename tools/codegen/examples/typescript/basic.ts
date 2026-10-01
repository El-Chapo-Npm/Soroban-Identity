/**
 * TypeScript client example for the Soroban Identity API.
 *
 * Install:  npm install @soroban-identity/client-ts
 * Run:      npx tsx examples/typescript/basic.ts
 *
 * Requires a running Soroban Identity server on http://localhost:7400
 * See tools/codegen/README.md for server instructions.
 */
import {
  CredentialsApi,
  createConfiguration,
  IssueCredentialRequest,
  ServerConfiguration,
  SystemApi,
} from "@soroban-identity/client-ts";

async function main(): Promise<void> {
  const config = createConfiguration({
    baseServer: new ServerConfiguration("http://localhost:7400", {}),
  });

  const system = new SystemApi(config);
  const info = await system.getServerInfo();
  console.log("Server:", info.version, "| api", info.apiVersion);

  const credentials = new CredentialsApi(config);

  const issued = await credentials.issueCredential({
    id: "cred-doc11-001",
    subject: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    issuer: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF",
    expiresAt: 1893456000,
    claims: { tier: "silver" },
  } as IssueCredentialRequest);
  console.log("Issued:", issued.id);

  const page = await credentials.listCredentials(10, undefined, "next");
  console.log("Total credentials:", page.items.length);

  const resolved = await credentials.verifyCredential(issued.id);
  console.log("Verified:", resolved.verified);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});