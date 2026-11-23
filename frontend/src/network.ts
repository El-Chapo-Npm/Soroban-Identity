import type { SorobanIdentityConfig } from "../../sdk/src/types";

export type NetworkName = "testnet" | "mainnet";

export interface FrontendNetworkConfig extends SorobanIdentityConfig {
  name: NetworkName;
  label: string;
  walletConnectChain: string;
  isMainnet: boolean;
}

const networkNames: NetworkName[] = ["testnet", "mainnet"];
export const ACTIVE_NETWORK_STORAGE_KEY = "soroban_identity_active_network";

export function normalizeNetworkName(value: string | undefined): NetworkName {
  return value === "mainnet" ? "mainnet" : "testnet";
}

export const DEFAULT_NETWORK = normalizeNetworkName(import.meta.env.VITE_NETWORK);

export const NETWORK_CONFIGS: Record<NetworkName, FrontendNetworkConfig> = {
  testnet: {
    name: "testnet",
    label: "Testnet",
    rpcUrl:
      import.meta.env.VITE_TESTNET_RPC_URL ??
      "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    walletConnectChain: "stellar:testnet",
    identityRegistryId: import.meta.env.VITE_TESTNET_IDENTITY_REGISTRY_ID ?? "",
    credentialManagerId:
      import.meta.env.VITE_TESTNET_CREDENTIAL_MANAGER_ID ?? "",
    reputationId: import.meta.env.VITE_TESTNET_REPUTATION_ID ?? "",
    isMainnet: false,
  },
  mainnet: {
    name: "mainnet",
    label: "Mainnet",
    rpcUrl:
      import.meta.env.VITE_MAINNET_RPC_URL ??
      "https://soroban-mainnet.stellar.org",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    walletConnectChain: "stellar:mainnet",
    identityRegistryId: import.meta.env.VITE_MAINNET_IDENTITY_REGISTRY_ID ?? "",
    credentialManagerId:
      import.meta.env.VITE_MAINNET_CREDENTIAL_MANAGER_ID ?? "",
    reputationId: import.meta.env.VITE_MAINNET_REPUTATION_ID ?? "",
    isMainnet: true,
  },
};

export const NETWORK_OPTIONS = networkNames.map((name) => NETWORK_CONFIGS[name]);

/**
 * Resolve the active network from the `VITE_NETWORK` env var.
 *
 * Anything other than the literal string "mainnet" falls back to testnet —
 * the safe default for development.
 */
export function getActiveNetwork(): NetworkName {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(ACTIVE_NETWORK_STORAGE_KEY);
      if (stored) return normalizeNetworkName(stored);
    } catch {
      // Storage may be unavailable in private browsing or restricted embeds.
    }
  }
  return DEFAULT_NETWORK;
}

export function persistActiveNetwork(network: NetworkName): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_NETWORK_STORAGE_KEY, network);
  } catch {
    // Keep the in-memory selection usable when storage is unavailable.
  }
}

export function getNetworkConfig(
  network: NetworkName = getActiveNetwork(),
): FrontendNetworkConfig {
  return NETWORK_CONFIGS[network];
}

export function isMainnet(network: NetworkName = getActiveNetwork()): boolean {
  return network === "mainnet";
}
