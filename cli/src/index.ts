#!/usr/bin/env node
/**
 * `soroban-identity` — manage DIDs and credentials from the terminal.
 *
 * Output contract: with `--json` a single JSON object is written to stdout on
 * success and to stderr on failure; exit codes are 0 ok, 1 failure, 2 usage,
 * 3 configuration (see cli/README.md).
 */

import { Command } from "commander";
import { registerCommands } from "./commands";
import { EXIT_CODES, printError, toCliFailure } from "./output";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require("../package.json") as { version: string };

const program = new Command();

program
  .name("soroban-identity")
  .description("Create DIDs and manage credentials on Soroban Identity")
  .version(pkg.version)
  .option("--json", "machine-readable JSON output (errors go to stderr as JSON)")
  .option("--config <path>", "path to the config file")
  .option("--rpc-url <url>", "Soroban RPC endpoint (overrides the config file)")
  .option("--network <name>", "network preset: testnet | futurenet | mainnet")
  .option("--identity-registry-id <id>", "identity-registry contract id")
  .option("--credential-manager-id <id>", "credential-manager contract id")
  .option("--reputation-id <id>", "reputation contract id")
  .option("-y, --yes", "never prompt: fail instead of asking for missing values")
  .option("--dry-run", "print what would be submitted and exit without calling the network");

registerCommands(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  const failure = toCliFailure(error);
  // `process.argv[2]` is the subcommand when it is not a flag.
  const command = process.argv[2]?.startsWith("-") ? undefined : process.argv[2];
  printError(failure, { json: program.opts().json, command });
  process.exit(failure.exitCode ?? EXIT_CODES.failure);
});
