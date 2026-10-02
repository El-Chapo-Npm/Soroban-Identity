#!/usr/bin/env node
import { Command } from 'commander';
import { configCommand } from './commands/config';
import { createDidCommand } from './commands/create-did';
import { issueCommand } from './commands/issue';
import { revokeCommand } from './commands/revoke';
import { verifyCommand } from './commands/verify';
import { output, printError } from './output';
import { promptState } from './prompts';
import type { GlobalOptions } from './commands/shared';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require('../package.json') as { version: string };

const program = new Command('soroban-id')
  .description('Manage Soroban Identity DIDs and verifiable credentials from the terminal')
  .version(version)
  .option('--config <path>', 'use a specific config file')
  .option('--network <name>', 'network preset: testnet, mainnet, futurenet')
  .option('--rpc-url <url>', 'override the Soroban RPC URL')
  .option('--json', 'machine-readable JSON output (disables prompts)')
  .option('-q, --quiet', 'suppress non-essential output')
  .option('--no-input', 'never prompt; fail if a required value is missing')
  .hook('preAction', (cmd) => {
    const opts = cmd.opts<GlobalOptions>();
    output.json = Boolean(opts.json);
    output.quiet = Boolean(opts.quiet);
    promptState.enabled = opts.input !== false;
  });

program.addCommand(createDidCommand());
program.addCommand(issueCommand());
program.addCommand(verifyCommand());
program.addCommand(revokeCommand());
program.addCommand(configCommand());

program.parseAsync(process.argv).catch((err: unknown) => {
  // Ctrl+C inside an @inquirer prompt.
  if ((err as Error)?.name === 'ExitPromptError') {
    process.exitCode = 130;
    return;
  }
  printError(err);
});
