/**
 * Configuration resolution.
 *
 * Order of precedence, lowest first:
 *
 *   1. the config file (see below)
 *   2. environment variables (`SOROBAN_IDENTITY_*`)
 *   3. command-line flags
 *
 * The config file is the first of these that exists:
 *   `--config <path>` → `$SOROBAN_IDENTITY_CONFIG` →
 *   `$XDG_CONFIG_HOME/soroban-identity/config.json` →
 *   `~/.config/soroban-identity/config.json`
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CliFailure, EXIT_CODES } from "./output";

export interface CliConfig {
  rpcUrl: string;
  networkPassphrase: string;
  identityRegistryId: string;
  credentialManagerId: string;
  reputationId: string;
  txTimeout?: number;
}

export interface NetworkPreset {
  networkPassphrase: string;
  rpcUrl: string;
}

export const NETWORK_PRESETS: Record<string, NetworkPreset> = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
  },
  futurenet: {
    networkPassphrase: "Test SDF Future Network ; October 2022",
    rpcUrl: "https://rpc-futurenet.stellar.org",
  },
  mainnet: {
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    rpcUrl: "https://mainnet.sorobanrpc.com",
  },
};

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim().length > 0
    ? env.XDG_CONFIG_HOME
    : path.join(os.homedir(), ".config");
  return path.join(base, "soroban-identity", "config.json");
}

export interface ConfigSources {
  /** `--config <path>` */
  configPath?: string;
  /** `--rpc-url <url>` */
  rpcUrl?: string;
  /** `--network <testnet|futurenet|mainnet>` */
  network?: string;
  identityRegistryId?: string;
  credentialManagerId?: string;
  reputationId?: string;
}

export interface ResolvedConfig {
  config: CliConfig;
  /** Where each value came from — printed by `config show`, handy in bug reports. */
  origin: Record<string, string>;
  configPath?: string;
}

const FIELD_ENV: Record<keyof CliConfig, string | undefined> = {
  rpcUrl: "SOROBAN_IDENTITY_RPC_URL",
  networkPassphrase: "SOROBAN_IDENTITY_NETWORK_PASSPHRASE",
  identityRegistryId: "SOROBAN_IDENTITY_IDENTITY_REGISTRY_ID",
  credentialManagerId: "SOROBAN_IDENTITY_CREDENTIAL_MANAGER_ID",
  reputationId: "SOROBAN_IDENTITY_REPUTATION_ID",
  txTimeout: undefined,
};

export function resolveConfig(
  sources: ConfigSources = {},
  env: NodeJS.ProcessEnv = process.env,
  readFile: (file: string) => string = (file) => fs.readFileSync(file, "utf8")
): ResolvedConfig {
  const candidate = sources.configPath ?? env.SOROBAN_IDENTITY_CONFIG ?? defaultConfigPath(env);
  const origin: Record<string, string> = {};

  let fileConfig: Partial<CliConfig> = {};
  let usedPath: string | undefined;
  if (fs.existsSync(candidate)) {
    usedPath = candidate;
    try {
      fileConfig = JSON.parse(readFile(candidate)) as Partial<CliConfig>;
    } catch (error) {
      throw new CliFailure(
        "CONFIG_INVALID",
        `${candidate} is not valid JSON: ${(error as Error).message}`,
        EXIT_CODES.config
      );
    }
    for (const key of Object.keys(fileConfig)) origin[key] = `file:${candidate}`;
  } else if (sources.configPath ?? env.SOROBAN_IDENTITY_CONFIG) {
    // An explicitly requested file that does not exist is an error, a missing
    // default file is not.
    throw new CliFailure(
      "CONFIG_NOT_FOUND",
      `config file not found: ${candidate}`,
      EXIT_CODES.config
    );
  }

  const preset = sources.network
    ? NETWORK_PRESETS[sources.network]
    : env.SOROBAN_IDENTITY_NETWORK
      ? NETWORK_PRESETS[env.SOROBAN_IDENTITY_NETWORK]
      : undefined;
  if (sources.network && !NETWORK_PRESETS[sources.network]) {
    throw new CliFailure(
      "UNKNOWN_NETWORK",
      `unknown network "${sources.network}" — known presets: ${Object.keys(NETWORK_PRESETS).join(", ")}`,
      EXIT_CODES.usage
    );
  }
  if (preset) origin.networkPassphrase = `preset:${sources.network ?? env.SOROBAN_IDENTITY_NETWORK}`;

  const pick = (key: keyof CliConfig, flag: string | undefined): string | undefined => {
    if (flag !== undefined && flag !== "") {
      origin[key] = "flag";
      return flag;
    }
    const envName = FIELD_ENV[key];
    const fromEnv = envName ? env[envName] : undefined;
    if (fromEnv !== undefined && fromEnv !== "") {
      origin[key] = `env:${envName}`;
      return fromEnv;
    }
    return undefined;
  };

  const config: CliConfig = {
    rpcUrl:
      pick("rpcUrl", sources.rpcUrl) ??
      fileConfig.rpcUrl ??
      preset?.rpcUrl ??
      NETWORK_PRESETS.testnet.rpcUrl,
    networkPassphrase:
      pick("networkPassphrase", undefined) ??
      fileConfig.networkPassphrase ??
      preset?.networkPassphrase ??
      NETWORK_PRESETS.testnet.networkPassphrase,
    identityRegistryId: pick("identityRegistryId", sources.identityRegistryId) ?? fileConfig.identityRegistryId ?? "",
    credentialManagerId: pick("credentialManagerId", sources.credentialManagerId) ?? fileConfig.credentialManagerId ?? "",
    reputationId: pick("reputationId", sources.reputationId) ?? fileConfig.reputationId ?? "",
    txTimeout: fileConfig.txTimeout,
  };

  const missing = (["identityRegistryId", "credentialManagerId", "reputationId"] as const).filter(
    (key) => !config[key] || config[key].trim().length === 0
  );
  if (missing.length > 0) {
    throw new CliFailure(
      "CONFIG_MISSING",
      `missing contract id(s): ${missing.join(", ")}. Run "soroban-identity config init", pass the flags, or set ${missing
        .map((key) => FIELD_ENV[key])
        .join(", ")}.`,
      EXIT_CODES.config,
      { missing, configPath: usedPath ?? candidate }
    );
  }

  return { config, origin, configPath: usedPath };
}

/** Config file template written by `config init`. */
export function configTemplate(partial: Partial<CliConfig> = {}): CliConfig {
  return {
    rpcUrl: partial.rpcUrl ?? NETWORK_PRESETS.testnet.rpcUrl,
    networkPassphrase: partial.networkPassphrase ?? NETWORK_PRESETS.testnet.networkPassphrase,
    identityRegistryId: partial.identityRegistryId ?? "",
    credentialManagerId: partial.credentialManagerId ?? "",
    reputationId: partial.reputationId ?? "",
  };
}
