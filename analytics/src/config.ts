import path from "node:path";

export interface AnalyticsConfig {
  rpcUrl: string;
  networkPassphrase: string;
  identityRegistryId: string;
  credentialManagerId: string;
  startLedger?: number;
  lookbackLedgers: number;
  pollIntervalMs: number;
  trackVerificationTxs: boolean;
  resolveDidCountry: boolean;
  port: number;
  dataFile: string;
  reportToken: string;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

function int(value: string | undefined, fallback: number): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AnalyticsConfig {
  const identityRegistryId = env.IDENTITY_REGISTRY_ID ?? "";
  const credentialManagerId = env.CREDENTIAL_MANAGER_ID ?? "";
  if (!identityRegistryId || !credentialManagerId) {
    throw new Error("IDENTITY_REGISTRY_ID and CREDENTIAL_MANAGER_ID must be set (see .env.example)");
  }

  return {
    rpcUrl: env.RPC_URL ?? "https://soroban-testnet.stellar.org",
    networkPassphrase: env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    identityRegistryId,
    credentialManagerId,
    startLedger: env.START_LEDGER ? int(env.START_LEDGER, 0) : undefined,
    lookbackLedgers: int(env.LOOKBACK_LEDGERS, 17_280), // ~1 day at 5s ledgers
    pollIntervalMs: int(env.POLL_INTERVAL_MS, 5_000),
    trackVerificationTxs: bool(env.TRACK_VERIFICATION_TXS, true),
    resolveDidCountry: bool(env.RESOLVE_DID_COUNTRY, true),
    port: int(env.PORT, 8790),
    dataFile: path.resolve(env.DATA_FILE ?? "./data/analytics.json"),
    reportToken: env.REPORT_TOKEN ?? "",
  };
}
