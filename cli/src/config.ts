import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { SorobanIdentityConfig } from '@soroban-identity/sdk';

/** Settings persisted in a CLI config file. All fields are optional. */
export interface CliConfig {
  network?: 'testnet' | 'mainnet' | 'futurenet' | 'custom';
  rpcUrl?: string;
  networkPassphrase?: string;
  identityRegistryId?: string;
  credentialManagerId?: string;
  reputationId?: string;
  /** Default issuer/controller public key, used when a command needs a caller address. */
  defaultAccount?: string;
  txTimeout?: number;
}

export const CONFIG_KEYS: (keyof CliConfig)[] = [
  'network',
  'rpcUrl',
  'networkPassphrase',
  'identityRegistryId',
  'credentialManagerId',
  'reputationId',
  'defaultAccount',
  'txTimeout',
];

const NETWORKS: Record<string, { rpcUrl: string; networkPassphrase: string }> = {
  testnet: {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
  },
  futurenet: {
    rpcUrl: 'https://rpc-futurenet.stellar.org',
    networkPassphrase: 'Test SDF Future Network ; October 2022',
  },
  mainnet: {
    rpcUrl: 'https://mainnet.sorobanrpc.com',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
  },
};

/** Project-local config file name, looked up from the current directory upwards. */
export const LOCAL_CONFIG_NAME = '.soroban-identity.json';

/** Global config path: `$SOROBAN_IDENTITY_CONFIG` or `~/.config/soroban-identity/config.json`. */
export function globalConfigPath(): string {
  return (
    process.env.SOROBAN_IDENTITY_CONFIG ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'soroban-identity', 'config.json')
  );
}

function findLocalConfig(start = process.cwd()): string | undefined {
  let dir = resolve(start);
  for (;;) {
    const candidate = join(dir, LOCAL_CONFIG_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function readConfigFile(path: string): CliConfig {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CliConfig;
  } catch (e) {
    throw new Error(`Invalid JSON in config file ${path}: ${(e as Error).message}`);
  }
}

export function writeConfigFile(path: string, config: CliConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

function fromEnv(): CliConfig {
  const env = process.env;
  const cfg: CliConfig = {
    network: env.SOROBAN_IDENTITY_NETWORK as CliConfig['network'],
    rpcUrl: env.SOROBAN_RPC_URL,
    networkPassphrase: env.SOROBAN_NETWORK_PASSPHRASE,
    identityRegistryId: env.IDENTITY_REGISTRY_ID,
    credentialManagerId: env.CREDENTIAL_MANAGER_ID,
    reputationId: env.REPUTATION_ID,
    defaultAccount: env.SOROBAN_IDENTITY_ACCOUNT,
    txTimeout: env.SOROBAN_TX_TIMEOUT ? Number(env.SOROBAN_TX_TIMEOUT) : undefined,
  };
  return Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined)) as CliConfig;
}

/**
 * Resolve the effective config. Precedence (highest first):
 * `overrides` (command-line flags), explicit `--config` file, environment variables, project-local
 * `.soroban-identity.json`, global config file, network presets.
 */
export function loadConfig(
  explicitPath?: string,
  overrides: CliConfig = {}
): { config: CliConfig; sources: string[] } {
  const sources: string[] = [];
  const layers: CliConfig[] = [];

  const globalPath = globalConfigPath();
  if (existsSync(globalPath)) {
    layers.push(readConfigFile(globalPath));
    sources.push(globalPath);
  }
  const localPath = findLocalConfig();
  if (localPath) {
    layers.push(readConfigFile(localPath));
    sources.push(localPath);
  }
  layers.push(fromEnv());
  if (explicitPath) {
    const abs = resolve(explicitPath);
    if (!existsSync(abs)) throw new Error(`Config file not found: ${abs}`);
    layers.push(readConfigFile(abs));
    sources.push(abs);
  }

  const merged: CliConfig = Object.assign({}, ...layers);
  // Switching network on the command line must not reuse another network's endpoints.
  if (overrides.network && overrides.network !== merged.network && NETWORKS[overrides.network]) {
    delete merged.rpcUrl;
    delete merged.networkPassphrase;
  }
  Object.assign(merged, overrides);
  const preset = NETWORKS[merged.network ?? 'testnet'];
  if (preset) {
    merged.rpcUrl ??= preset.rpcUrl;
    merged.networkPassphrase ??= preset.networkPassphrase;
  }
  return { config: merged, sources };
}

/** Convert CLI config into an SDK config, failing with a helpful message on missing fields. */
export function toSdkConfig(
  config: CliConfig,
  required: ('identityRegistryId' | 'credentialManagerId')[]
): SorobanIdentityConfig {
  const missing = required.filter((k) => !config[k]);
  if (!config.rpcUrl) missing.unshift('rpcUrl' as never);
  if (!config.networkPassphrase) missing.unshift('networkPassphrase' as never);
  if (missing.length > 0) {
    throw new Error(
      `Missing configuration: ${missing.join(', ')}. ` +
        `Run "soroban-id config init" or "soroban-id config set <key> <value>".`
    );
  }
  return {
    rpcUrl: config.rpcUrl!,
    networkPassphrase: config.networkPassphrase!,
    identityRegistryId: config.identityRegistryId ?? '',
    credentialManagerId: config.credentialManagerId ?? '',
    reputationId: config.reputationId ?? '',
    txTimeout: config.txTimeout,
  };
}
