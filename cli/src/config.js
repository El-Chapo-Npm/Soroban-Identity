import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TESTNET_CONFIG, MAINNET_CONFIG } from '@soroban-identity/sdk';

export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.soroban-id.json');

// Precedence: --config file > ~/.soroban-id.json > env vars > network defaults.
export function loadConfig(file) {
  const target = file ?? DEFAULT_CONFIG_PATH;
  const fromFile = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
  const base = fromFile.network === 'mainnet' ? MAINNET_CONFIG : TESTNET_CONFIG;
  return {
    ...base,
    ...(process.env.SOROBAN_RPC_URL && { rpcUrl: process.env.SOROBAN_RPC_URL }),
    ...(process.env.IDENTITY_REGISTRY_ID && { identityRegistryId: process.env.IDENTITY_REGISTRY_ID }),
    ...(process.env.CREDENTIAL_MANAGER_ID && { credentialManagerId: process.env.CREDENTIAL_MANAGER_ID }),
    ...fromFile,
  };
}
