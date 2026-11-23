/**
 * CLI tests.
 *
 * These spawn the built CLI (`dist/index.js`) rather than importing its modules,
 * so what is tested is what a user runs: the flags, the JSON contract and the
 * exit codes. Everything here uses `--dry-run`, so no test touches the network.
 */

import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { Keypair } from "@stellar/stellar-sdk";

const exec = promisify(execFile);
const CLI = path.resolve(__dirname, "..", "dist", "index.js");
const SECRET = Keypair.random().secret();

const CONFIG = {
  rpcUrl: "https://rpc.example.invalid",
  networkPassphrase: "Test SDF Network ; September 2015",
  identityRegistryId: "CD5MO3M3LYM5JLYXD27ARVECRKQXLJJSNBWMAUJ6ST3F4FXBGGXTJA7T",
  credentialManagerId: "CBL6HX4NVYVHRJ4FRP2RTT2HRFHPFRSGH2NHQFFQXPBXFPBX2DPXP3FH",
  reputationId: "CAZ72HKQ7WNQSOFJK7QVJXHZPHZTEST71NX2JZ2M3C4D5E6F7G8H9J0K",
};

function tempConfig(overrides: Record<string, unknown> = {}): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "si-cli-"));
  const file = path.join(dir, "config.json");
  writeFileSync(file, JSON.stringify({ ...CONFIG, ...overrides }, null, 2));
  return { dir, file };
}

function emptyHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "si-cli-empty-"));
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  try {
    const { stdout, stderr } = await exec("node", [CLI, ...args], {
      timeout: 30_000,
      env: { ...process.env, SOROBAN_IDENTITY_SECRET: SECRET, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

describe("soroban-identity CLI", () => {
  it("lists the four DID/credential commands in --help", async () => {
    const { code, stdout } = await run(["--help"]);

    expect(code).toBe(0);
    for (const command of ["create-did", "issue-credential", "verify", "revoke", "config"]) {
      expect(stdout).toContain(command);
    }
  });

  it("dry-runs a revocation and prints the encoded reason", async () => {
    const { file } = tempConfig();
    const { code, stdout } = await run([
      "--config", file, "--json", "--dry-run",
      "revoke", "--credential-id", "aa".repeat(32), "--reason", "superseded",
    ]);

    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload.ok).toBe(true);
    expect(payload.data.dryRun).toBe(true);
    expect(payload.data.args.reason).toBe("Superseded");
    // The reason travels as Vector[Symbol("Superseded")], not as a bare symbol.
    expect(payload.data.args.reasonScValXdr.length).toBeGreaterThan(0);
    expect(payload.data.rpcUrl).toBe(CONFIG.rpcUrl);
  });

  it("rejects a reason the contract cannot decode, with exit code 2", async () => {
    const { file } = tempConfig();
    const { code, stderr } = await run([
      "--config", file, "--json", "--dry-run",
      "revoke", "--credential-id", "aa".repeat(32), "--reason", "because-i-said-so",
    ]);

    expect(code).toBe(2);
    const payload = JSON.parse(stderr);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("UNKNOWN_REASON");
    expect(payload.error.details.valid).toContain("Compromised");
  });

  it("fails with CONFIG_MISSING when no config file exists anywhere", async () => {
    const home = emptyHome();
    const { code, stderr } = await run(
      ["--json", "--dry-run", "verify", "--credential-id", "aa".repeat(32)],
      { XDG_CONFIG_HOME: home, HOME: home }
    );

    expect(code).toBe(3);
    const payload = JSON.parse(stderr);
    expect(payload.error.code).toBe("CONFIG_MISSING");
  });

  it("resolves the RPC url with flag > env > config file precedence", async () => {
    const { file } = tempConfig({ rpcUrl: "https://from-file.invalid" });

    const fromFile = JSON.parse(
      (await run(["--config", file, "--json", "--dry-run", "verify", "--credential-id", "aa".repeat(32)], { SOROBAN_IDENTITY_RPC_URL: "" })).stdout
    );
    expect(fromFile.data.rpcUrl).toBe("https://from-file.invalid");

    const fromEnv = JSON.parse(
      (await run(["--config", file, "--json", "--dry-run", "verify", "--credential-id", "aa".repeat(32)], { SOROBAN_IDENTITY_RPC_URL: "https://from-env.invalid" })).stdout
    );
    expect(fromEnv.data.rpcUrl).toBe("https://from-env.invalid");

    const fromFlag = JSON.parse(
      (await run(["--config", file, "--rpc-url", "https://from-flag.invalid", "--json", "--dry-run", "verify", "--credential-id", "aa".repeat(32)], { SOROBAN_IDENTITY_RPC_URL: "https://from-env.invalid" })).stdout
    );
    expect(fromFlag.data.rpcUrl).toBe("https://from-flag.invalid");
  });

  it("writes a config file with config init and reports origins with config show", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "si-cli-init-"));
    const target = path.join(dir, "nested", "config.json");

    const init = await run([
      "--json", "config", "init", "--config", target,
      "--identity-registry-id", CONFIG.identityRegistryId,
      "--credential-manager-id", CONFIG.credentialManagerId,
      "--reputation-id", CONFIG.reputationId,
    ]);
    expect(init.code).toBe(0);
    expect(JSON.parse(readFileSync(target, "utf8")).credentialManagerId).toBe(CONFIG.credentialManagerId);

    const show = await run(["--json", "config", "show", "--config", target]);
    expect(show.code).toBe(0);
    const payload = JSON.parse(show.stdout);
    expect(payload.data.configPath).toBe(target);
    expect(payload.data.origin.credentialManagerId).toContain("file:");
  });

  it("builds create-did and issue-credential intents without a network call", async () => {
    const { file } = tempConfig();

    const did = JSON.parse(
      (await run(["--config", file, "--json", "--dry-run", "create-did", "--metadata", "role=auditor"])).stdout
    );
    expect(did.data.args.metadata).toEqual({ role: "auditor" });

    const issue = JSON.parse(
      (await run([
        "--config", file, "--json", "--dry-run", "issue-credential",
        "--subject", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "--type", "Kyc",
        "--claim", "name=Alice",
        "--claim", "country=UA",
        "--expires-at", "2026-12-31T00:00:00Z",
      ])).stdout
    );
    // Sorted keys, so the same claims always produce the same hash.
    expect(issue.data.args.claimsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(issue.data.args.expiresAt).toBe(Math.floor(Date.parse("2026-12-31T00:00:00Z") / 1000));
  });

  it("does not prompt when --yes is set and a value is missing", async () => {
    const { file } = tempConfig();
    const { code, stderr } = await run(
      ["--config", file, "--json", "--yes", "--dry-run", "issue-credential", "--type", "Kyc"],
      { SOROBAN_IDENTITY_SECRET: "" }
    );

    expect(code).toBe(2);
    expect(JSON.parse(stderr).error.code).toBe("SECRET_REQUIRED");
  });
});
