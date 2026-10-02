/**
 * The four commands, plus `config`.
 *
 * Every command supports `--dry-run`, which prints exactly what would be sent to
 * the network (including the encoded revocation reason) and exits without
 * touching the RPC — that is what the tests exercise.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import {
  REVOCATION_REASONS,
  RevocationReason,
  encodeRevocationReason,
  normalizeRevocationReason,
} from "@soroban-identity/sdk";
import { CliFailure, EXIT_CODES, printResult } from "./output";
import { askValue } from "./prompts";
import { configTemplate, defaultConfigPath, resolveConfig, type CliConfig } from "./config";
import {
  canonicalClaimsHash,
  credentialsClient,
  identityClient,
  keypairFromSecret,
  parseExpiry,
  parsePairs,
} from "./context";

export interface GlobalOptions {
  json?: boolean;
  config?: string;
  rpcUrl?: string;
  network?: string;
  identityRegistryId?: string;
  credentialManagerId?: string;
  reputationId?: string;
  yes?: boolean;
  dryRun?: boolean;
}

const VALID_TYPES = ["Kyc", "Reputation", "Achievement", "Custom"] as const;

function loadConfig(options: GlobalOptions): CliConfig {
  return resolveConfig({
    configPath: options.config,
    rpcUrl: options.rpcUrl,
    network: options.network,
    identityRegistryId: options.identityRegistryId,
    credentialManagerId: options.credentialManagerId,
    reputationId: options.reputationId,
  }).config;
}

/** Everything a dry run needs to show, without a network call. */
function dryRunPayload(config: CliConfig, args: Record<string, unknown>): Record<string, unknown> {
  return {
    dryRun: true,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    identityRegistryId: config.identityRegistryId,
    credentialManagerId: config.credentialManagerId,
    args,
  };
}

export function registerCommands(program: Command): void {
  program
    .command("create-did")
    .description("create a DID for a Stellar account")
    .option("--secret <secret>", "secret key of the DID controller (or $SOROBAN_IDENTITY_SECRET)")
    .option("--metadata <key=value>", "DID metadata entry (repeatable)", collect, [])
    .action(async (opts: Record<string, unknown>) => {
      const global = program.opts<GlobalOptions>();
      const secret = await askValue({
        provided: (opts.secret as string) ?? process.env.SOROBAN_IDENTITY_SECRET,
        question: "Controller secret key?",
        code: "SECRET_REQUIRED",
        secret: true,
        yes: global.yes,
      });
      const keypair = keypairFromSecret(secret);
      const metadata = parsePairs((opts.metadata as string[]) ?? [], "metadata");
      const config = loadConfig(global);

      if (global.dryRun) {
        return printResult(
          dryRunPayload(config, { controller: keypair.publicKey(), metadata }),
          { json: global.json, command: "create-did" }
        );
      }

      const client = identityClient(config);
      const result = await client.createDid(keypair, metadata);
      return printResult(
        { controller: keypair.publicKey(), did: result.data.did, txHash: result.txHash },
        { json: global.json, command: "create-did" }
      );
    });

  program
    .command("issue-credential")
    .description("issue a credential to a subject")
    .option("--secret <secret>", "secret key of the issuer (or $SOROBAN_IDENTITY_SECRET)")
    .option("--subject <address>", "subject account address")
    .option("--type <type>", `credential type: ${VALID_TYPES.join(", ")}`)
    .option("--claim <key=value>", "claim entry (repeatable)", collect, [])
    .option("--expires-at <when>", "unix seconds or ISO-8601 date (default: never)")
    .action(async (opts: Record<string, unknown>) => {
      const global = program.opts<GlobalOptions>();
      const secret = await askValue({
        provided: (opts.secret as string) ?? process.env.SOROBAN_IDENTITY_SECRET,
        question: "Issuer secret key?",
        code: "SECRET_REQUIRED",
        secret: true,
        yes: global.yes,
      });
      const subject = await askValue({
        provided: opts.subject as string,
        question: "Subject address?",
        code: "SUBJECT_REQUIRED",
        yes: global.yes,
      });
      const type = (await askValue({
        provided: opts.type as string,
        question: `Credential type (${VALID_TYPES.join("/")})?`,
        code: "TYPE_REQUIRED",
        yes: global.yes,
      })) as (typeof VALID_TYPES)[number];
      if (!VALID_TYPES.includes(type)) {
        throw new CliFailure("INVALID_TYPE", `unknown credential type "${type}"`, EXIT_CODES.usage, {
          valid: VALID_TYPES,
        });
      }
      const claims = parsePairs((opts.claim as string[]) ?? []);
      const expiresAt = parseExpiry(opts.expiresAt as string | undefined);
      const claimsHash = canonicalClaimsHash(claims);
      const keypair = keypairFromSecret(secret);
      const config = loadConfig(global);

      if (global.dryRun) {
        return printResult(
          dryRunPayload(config, {
            issuer: keypair.publicKey(),
            subject,
            credentialType: type,
            claims,
            claimsHash,
            expiresAt,
          }),
          { json: global.json, command: "issue-credential" }
        );
      }

      const client = credentialsClient(config);
      const result = await client.issueCredential(
        keypair,
        subject,
        type,
        claims,
        claimsHash,
        expiresAt
      );
      return printResult(
        {
          credentialId: result.data.credentialId,
          subject,
          claimsHash,
          expiresAt,
          txHash: result.txHash,
        },
        { json: global.json, command: "issue-credential" }
      );
    });

  program
    .command("verify")
    .description("verify a credential")
    .option("--credential-id <hex>", "32-byte credential id (hex)")
    .option("--caller <G...>", "address to simulate the call from (defaults to the issuer-less zero account)")
    .action(async (opts: Record<string, unknown>) => {
      const global = program.opts<GlobalOptions>();
      const credentialId = await askValue({
        provided: opts.credentialId as string,
        question: "Credential id (hex)?",
        code: "CREDENTIAL_ID_REQUIRED",
        yes: global.yes,
      });
      const caller = (opts.caller as string) ?? "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
      const config = loadConfig(global);

      if (global.dryRun) {
        return printResult(dryRunPayload(config, { credentialId, caller }), {
          json: global.json,
          command: "verify",
        });
      }

      const client = credentialsClient(config);
      const result = await client.verifyCredential(caller, credentialId);
      return printResult(result, { json: global.json, command: "verify" });
    });

  program
    .command("revoke")
    .description("revoke a credential, recording why")
    .option("--secret <secret>", "secret key of the issuer (or $SOROBAN_IDENTITY_SECRET)")
    .option("--credential-id <hex>", "32-byte credential id (hex)")
    .option("--reason <reason>", `why it is revoked: ${REVOCATION_REASONS.join(", ")}`)
    .action(async (opts: Record<string, unknown>) => {
      const global = program.opts<GlobalOptions>();
      const secret = await askValue({
        provided: (opts.secret as string) ?? process.env.SOROBAN_IDENTITY_SECRET,
        question: "Issuer secret key?",
        code: "SECRET_REQUIRED",
        secret: true,
        yes: global.yes,
      });
      const credentialId = await askValue({
        provided: opts.credentialId as string,
        question: "Credential id (hex)?",
        code: "CREDENTIAL_ID_REQUIRED",
        yes: global.yes,
      });
      const rawReason = await askValue({
        provided: opts.reason as string,
        question: `Revocation reason (${REVOCATION_REASONS.join("/")})?`,
        code: "REASON_REQUIRED",
        yes: global.yes,
      });
      // Accepts "Superseded", "superseded", "admin_revoked", "Admin Revoked".
      const reason: RevocationReason | undefined = normalizeRevocationReason(rawReason);
      if (!reason) {
        throw new CliFailure(
          "UNKNOWN_REASON",
          `unknown revocation reason "${rawReason}" — expected one of: ${REVOCATION_REASONS.join(", ")}`,
          EXIT_CODES.usage,
          { valid: REVOCATION_REASONS }
        );
      }
      const keypair = keypairFromSecret(secret);
      const config = loadConfig(global);

      if (global.dryRun) {
        return printResult(
          dryRunPayload(config, {
            issuer: keypair.publicKey(),
            credentialId,
            reason,
            // The contract decodes a contracttype enum, not a bare symbol.
            reasonScValXdr: encodeRevocationReason(reason).toXDR("base64"),
          }),
          { json: global.json, command: "revoke" }
        );
      }

      const client = credentialsClient(config);
      const result = await client.revokeCredential(keypair, credentialId, reason);
      return printResult(
        {
          credentialId,
          reason: result.data.revocationReason,
          revokedAt: result.data.revokedAt,
          txHash: result.txHash,
        },
        { json: global.json, command: "revoke" }
      );
    });

  const configCommand = program.command("config").description("work with the CLI config file");

  configCommand
    .command("init")
    .description(`write a config file (default: ${defaultConfigPath()})`)
    .option("--force", "overwrite an existing file")
    .option("--identity-registry-id <id>", "identity-registry contract id")
    .option("--credential-manager-id <id>", "credential-manager contract id")
    .option("--reputation-id <id>", "reputation contract id")
    .action((opts: Record<string, unknown>) => {
      const global = program.opts<GlobalOptions>();
      const fallback = defaultConfigPath();
      const target = (opts.config as string) ?? global.config ?? process.env.SOROBAN_IDENTITY_CONFIG ?? fallback;
      if (fs.existsSync(target) && !opts.force) {
        throw new CliFailure(
          "CONFIG_EXISTS",
          `${target} already exists — pass --force to overwrite`,
          EXIT_CODES.config
        );
      }
      // The same flags exist on the program (global) level, so accept either.
      const template = configTemplate({
        identityRegistryId:
          (opts.identityRegistryId as string) ?? global.identityRegistryId ?? "",
        credentialManagerId:
          (opts.credentialManagerId as string) ?? global.credentialManagerId ?? "",
        reputationId: (opts.reputationId as string) ?? global.reputationId ?? "",
      });
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(template, null, 2) + "\n", "utf8");
      return printResult({ configPath: target, config: template }, {
        json: global.json,
        command: "config init",
      });
    });

  configCommand
    .command("show")
    .description("print the config that would be used, and where each value comes from")
    .action(() => {
      const global = program.opts<GlobalOptions>();
      const resolved = resolveConfig({
        configPath: global.config,
        rpcUrl: global.rpcUrl,
        network: global.network,
        identityRegistryId: global.identityRegistryId,
        credentialManagerId: global.credentialManagerId,
        reputationId: global.reputationId,
      });
      return printResult(
        { configPath: resolved.configPath ?? null, config: resolved.config, origin: resolved.origin },
        { json: global.json, command: "config show" }
      );
    });
}

/** Commander collector for repeatable `key=value` flags. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
