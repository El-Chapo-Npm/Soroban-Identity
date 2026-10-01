import { Command } from 'commander';
import { resolve } from 'node:path';
import {
  CONFIG_KEYS,
  LOCAL_CONFIG_NAME,
  globalConfigPath,
  loadConfig,
  readConfigFile,
  writeConfigFile,
  type CliConfig,
} from '../config';
import { info, printResult, table } from '../output';
import { askChoice, askText } from '../prompts';
import type { GlobalOptions } from './shared';

function targetPath(opts: { local?: boolean }, globals: GlobalOptions): string {
  if (globals.config) return resolve(globals.config);
  return opts.local ? resolve(LOCAL_CONFIG_NAME) : globalConfigPath();
}

function parseKey(key: string): keyof CliConfig {
  if (!CONFIG_KEYS.includes(key as keyof CliConfig)) {
    throw new Error(`Unknown config key "${key}". Valid keys: ${CONFIG_KEYS.join(', ')}`);
  }
  return key as keyof CliConfig;
}

export function configCommand(): Command {
  const config = new Command('config').description('Manage CLI configuration');

  config
    .command('init')
    .description('Interactively create a config file')
    .option('--local', `write ./${LOCAL_CONFIG_NAME} instead of the global config`)
    .option('--identity-registry-id <id>', 'identity registry contract ID')
    .option('--credential-manager-id <id>', 'credential manager contract ID')
    .option('--default-account <address>', 'default caller address')
    .action(async (opts, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const path = targetPath(opts, globals);
      const existing = readConfigFile(path);
      const network = await askChoice(globals.network ?? existing.network, {
        name: 'network',
        flag: '--network',
        message: 'Network:',
        choices: ['testnet', 'mainnet', 'futurenet', 'custom'] as const,
        default: 'testnet',
      });
      const next: CliConfig = { ...existing, network };
      if (network === 'custom') {
        next.rpcUrl = await askText(globals.rpcUrl ?? existing.rpcUrl, { name: 'rpcUrl', flag: '--rpc-url', message: 'RPC URL:' });
        next.networkPassphrase = await askText(existing.networkPassphrase, {
          name: 'networkPassphrase',
          flag: 'config set networkPassphrase',
          message: 'Network passphrase:',
        });
      } else if (globals.rpcUrl) {
        next.rpcUrl = globals.rpcUrl;
      }
      next.identityRegistryId = await askText(opts.identityRegistryId, {
        name: 'identityRegistryId',
        flag: '--identity-registry-id',
        message: 'Identity registry contract ID:',
        default: existing.identityRegistryId ?? '',
      });
      next.credentialManagerId = await askText(opts.credentialManagerId, {
        name: 'credentialManagerId',
        flag: '--credential-manager-id',
        message: 'Credential manager contract ID:',
        default: existing.credentialManagerId ?? '',
      });
      next.defaultAccount = await askText(opts.defaultAccount, {
        name: 'defaultAccount',
        flag: '--default-account',
        message: 'Default account address (optional):',
        default: existing.defaultAccount ?? '',
      });
      for (const k of CONFIG_KEYS) if (next[k] === '') delete next[k];
      writeConfigFile(path, next);
      info(`Wrote ${path}`);
      printResult({ path, config: next }, () => table(Object.entries(next)));
    });

  config
    .command('show')
    .description('Print the effective configuration and where it was loaded from')
    .action((_opts, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const { config: effective, sources } = loadConfig(globals.config);
      printResult({ config: effective, sources }, () =>
        [table(Object.entries(effective)), '', `Sources: ${sources.length ? sources.join(', ') : '(defaults only)'}`].join('\n')
      );
    });

  config
    .command('get <key>')
    .description('Print one effective config value')
    .action((key: string, _opts, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const k = parseKey(key);
      const value = loadConfig(globals.config).config[k];
      printResult({ [k]: value ?? null }, () => String(value ?? ''));
    });

  config
    .command('set <key> <value>')
    .description('Set a config value')
    .option('--local', `write ./${LOCAL_CONFIG_NAME} instead of the global config`)
    .action((key: string, value: string, opts, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const k = parseKey(key);
      const path = targetPath(opts, globals);
      const current = readConfigFile(path);
      (current as Record<string, unknown>)[k] = k === 'txTimeout' ? Number(value) : value;
      writeConfigFile(path, current);
      printResult({ path, [k]: current[k] }, () => `Set ${k} in ${path}`);
    });

  config
    .command('path')
    .description('Print the config file path that "config set" writes to')
    .option('--local', 'print the project-local path')
    .action((opts, cmd: Command) => {
      const path = targetPath(opts, cmd.optsWithGlobals<GlobalOptions>());
      printResult({ path }, () => path);
    });

  return config;
}
