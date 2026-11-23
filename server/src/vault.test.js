import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { VaultLeaseManager, loadVaultSecrets } from './vault.js';
import { requestContextStore } from './request-context.js';

test('reads KV v2 secrets, maps keys, and audits metadata without values', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'soroban-vault-'));
  const auditPath = path.join(tempDir, 'vault.ndjson');
  const env = {
    VAULT_ENABLED: 'true',
    VAULT_ADDR: 'https://vault.example.test',
    VAULT_SECRET_PATH: 'secret/data/soroban-identity/production',
    VAULT_TOKEN: 'test-token',
    VAULT_SECRET_MAPPINGS: JSON.stringify({ admin_api_key: 'ADMIN_API_KEY' }),
    VAULT_AUDIT_LOG_PATH: auditPath,
  };
  const calls = [];
  const manager = new VaultLeaseManager({
    env,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ data: { data: { admin_api_key: 'do-not-log', lease_only: true } }, lease_duration: 120 }), { status: 200 });
    },
  });
  const secrets = await manager.refresh();
  manager.stop();
  assert.deepEqual(secrets, { ADMIN_API_KEY: 'do-not-log', lease_only: 'true' });
  assert.equal(calls[0].options.headers['x-vault-token'], 'test-token');
  const audit = await readFile(auditPath, 'utf8');
  assert.match(audit, /admin_api_key/);
  assert.doesNotMatch(audit, /do-not-log/);
  await rm(tempDir, { recursive: true, force: true });
});

test('authenticates with a JWT when no static token is present', async () => {
  const env = {
    VAULT_ENABLED: 'true',
    VAULT_ADDR: 'https://vault.example.test',
    VAULT_SECRET_PATH: 'secret/data/app',
    VAULT_JWT: 'jwt-value',
    VAULT_ROLE: 'github-actions',
  };
  let loginBody;
  const manager = new VaultLeaseManager({
    env,
    fetchImpl: async (url, options) => {
      if (url.endsWith('/v1/auth/jwt/login')) {
        loginBody = JSON.parse(options.body);
        return new Response(JSON.stringify({ auth: { client_token: 'short-lived-token' } }), { status: 200 });
      }
      assert.equal(options.headers['x-vault-token'], 'short-lived-token');
      return new Response(JSON.stringify({ data: { data: { key: 'value' } }, lease_duration: 60 }), { status: 200 });
    },
  });
  const secrets = await manager.refresh();
  manager.stop();
  assert.deepEqual(loginBody, { role: 'github-actions', jwt: 'jwt-value' });
  assert.deepEqual(secrets, { key: 'value' });
});

test('propagates the ambient correlation ID to Vault login and secret reads', async () => {
  const calls = [];
  const manager = new VaultLeaseManager({
    env: {
      VAULT_ENABLED: 'true',
      VAULT_ADDR: 'https://vault.example.test',
      VAULT_SECRET_PATH: 'secret/data/app',
      VAULT_JWT: 'jwt-value',
      VAULT_ROLE: 'test-role',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/v1/auth/jwt/login')) {
        return new Response(JSON.stringify({ auth: { client_token: 'token' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { data: { key: 'value' } } }), { status: 200 });
    },
  });
  await requestContextStore.run({ correlationId: 'vault-chain-correlation-123' }, () => manager.refresh());
  manager.stop();

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.headers['x-correlation-id'], 'vault-chain-correlation-123');
  }
});

test('fails when Vault is enabled without an address or path', async () => {
  const manager = new VaultLeaseManager({ env: { VAULT_ENABLED: 'true' }, fetchImpl: async () => new Response('{}') });
  await assert.rejects(manager.refresh(), /VAULT_ADDR and VAULT_SECRET_PATH/);
  manager.stop();
});

test('downloads Doppler secrets, maps DB and IPFS keys, and audits metadata without values', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'soroban-doppler-'));
  const auditPath = path.join(tempDir, 'secrets.ndjson');
  const env = {
    SECRETS_PROVIDER: 'doppler',
    DOPPLER_TOKEN: 'doppler-token',
    DOPPLER_PROJECT: 'soroban-identity',
    DOPPLER_CONFIG: 'production',
    SECRET_MAPPINGS: JSON.stringify({
      db_primary_url: 'DATABASE_URL',
      ipfs_api_key: 'IPFS_API_KEY',
    }),
    VAULT_AUDIT_LOG_PATH: auditPath,
  };
  const calls = [];
  const manager = new VaultLeaseManager({
    env,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        secrets: {
          db_primary_url: { raw: 'postgres://user:db-password@primary:5432/identity' },
          ipfs_api_key: { raw: 'ipfs-secret-value' },
          log_level: { raw: 'info' },
        },
      }), { status: 200 });
    },
  });

  const secrets = await manager.refresh();
  manager.stop();

  assert.deepEqual(secrets, {
    DATABASE_URL: 'postgres://user:db-password@primary:5432/identity',
    IPFS_API_KEY: 'ipfs-secret-value',
    log_level: 'info',
  });
  assert.match(calls[0].url, /project=soroban-identity/);
  assert.match(calls[0].url, /config=production/);
  assert.equal(calls[0].options.headers.authorization, 'Bearer doppler-token');

  const audit = await readFile(auditPath, 'utf8');
  assert.match(audit, /"provider":"doppler"/);
  assert.match(audit, /db_primary_url/);
  assert.doesNotMatch(audit, /db-password/);
  assert.doesNotMatch(audit, /ipfs-secret-value/);
  await rm(tempDir, { recursive: true, force: true });
});

test('fails closed when Doppler is selected without connection settings', async () => {
  const manager = new VaultLeaseManager({
    env: { SECRETS_PROVIDER: 'doppler' },
    fetchImpl: async () => new Response('{}'),
  });
  await assert.rejects(manager.refresh(), /DOPPLER_TOKEN, DOPPLER_PROJECT and DOPPLER_CONFIG/);
  manager.stop();
});

test('loadVaultSecrets exposes Doppler-mapped values without provider credentials', async () => {
  const env = {
    SECRETS_PROVIDER: 'doppler',
    DOPPLER_TOKEN: 'doppler-token',
    DOPPLER_PROJECT: 'soroban-identity',
    DOPPLER_CONFIG: 'production',
    SECRET_MAPPINGS: JSON.stringify({ db_primary_url: 'DATABASE_URL' }),
  };
  const { manager, secrets } = await loadVaultSecrets({
    env,
    fetchImpl: async () => new Response(JSON.stringify({
      secrets: { db_primary_url: { raw: 'postgres://identity-db' } },
    }), { status: 200 }),
  });
  manager?.stop();
  assert.deepEqual(secrets, { DATABASE_URL: 'postgres://identity-db' });
  assert.equal('DOPPLER_TOKEN' in secrets, false);
});
