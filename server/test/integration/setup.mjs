import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execAsync = promisify(exec);

export const QUICKSTART_RPC_URL = 'http://localhost:8000';
export const NETWORK_PASSPHRASE = 'Standalone Network ; February 2017';

const CONTAINER_NAME = 'soroban-identity-rest-it';

export async function waitForRpc(url, timeoutMs = 60_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      const body = await response.json();
      if (response.ok && body?.result?.status === 'healthy') return;
      lastError = new Error(`RPC status: ${body?.result?.status ?? response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? 'unknown error'}`);
}

export async function startQuickstart() {
  const externalUrl = process.env.SOROBAN_RPC_URL;
  if (externalUrl) {
    await waitForRpc(externalUrl);
    return { rpcUrl: externalUrl, stop: async () => {} };
  }

  try {
    const { stdout } = await execAsync(
      `docker ps -a --filter name=${CONTAINER_NAME} --format "{{.Names}}"`,
    );
    if (stdout.trim() === CONTAINER_NAME) {
      await execAsync(`docker rm -f ${CONTAINER_NAME}`);
    }
  } catch {}

  await execAsync(
    `docker run -d --name ${CONTAINER_NAME} -p 8000:8000 ` +
      'stellar/quickstart:testing --standalone --enable-soroban-rpc',
  );
  await waitForRpc(QUICKSTART_RPC_URL);

  return {
    rpcUrl: QUICKSTART_RPC_URL,
    stop: async () => {
      await execAsync(`docker rm -f ${CONTAINER_NAME}`).catch(() => {});
    },
  };
}

export async function createTestEnvironment(rpcUrl = QUICKSTART_RPC_URL) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'soroban-rest-it-'));
  const config = {
    stellarCli: 'stellar',
    sourceAccount: 'SAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    network: 'standalone',
    rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASE,
    contracts: {
      identity: 'CAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      credential: 'CAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      reputation: 'CAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    },
    sorobanInvokeTimeoutMs: 10_000,
    rpcMaxRetries: 1,
    rpcCacheTtlMs: 0,
    eventPollIntervalMs: 0,
    maxBodyBytes: 64 * 1024,
    dataDir,
    credentialStorePath: path.join(dataDir, 'credentials.json'),
    webhookStorePath: path.join(dataDir, 'webhooks.json'),
    auditLogPath: path.join(dataDir, 'audit'),
    adminApiKey: 'integration-admin-key',
    adminActor: 'integration-admin',
    adminIpAllowlist: [],
    corsAllowedOrigins: ['*'],
    healthProbeTimeoutMs: 5_000,
  };

  return {
    config,
    cleanup: async () => rm(dataDir, { recursive: true, force: true }),
  };
}
