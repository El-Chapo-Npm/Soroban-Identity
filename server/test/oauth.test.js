import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { OAuthService, OAuthError, parseScope } from '../src/oauth.js';

async function makeService(overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oauth-test-'));
  return new OAuthService({
    dataDir: dir,
    oauthAuthCodeTtlMs: 60_000,
    oauthAccessTokenTtlMs: 60_000,
    oauthRefreshTokenTtlMs: 60_000,
    ...overrides,
  });
}

test('parseScope splits and dedupes a space-delimited scope string', () => {
  assert.deepEqual(parseScope('credentials:read  credentials:write credentials:read'), [
    'credentials:read',
    'credentials:write',
  ]);
  assert.deepEqual(parseScope(''), []);
  assert.deepEqual(parseScope(undefined), []);
});

test('registerClient requires at least one redirect_uri', async () => {
  const service = await makeService();
  await assert.rejects(
    () => service.registerClient({ name: 'x', redirectUris: [] }),
    (err) => err instanceof OAuthError && err.code === 'invalid_request',
  );
});

test('registerClient rejects an unknown scope', async () => {
  const service = await makeService();
  await assert.rejects(
    () => service.registerClient({ redirectUris: ['https://app.example.com/cb'], scopes: ['not:a:scope'] }),
    (err) => err instanceof OAuthError && err.code === 'invalid_scope',
  );
});

test('registerClient returns a usable client_id/client_secret pair', async () => {
  const service = await makeService();
  const client = await service.registerClient({
    name: 'Partner',
    redirectUris: ['https://app.example.com/cb'],
    scopes: ['credentials:read'],
  });
  assert.ok(client.clientId.startsWith('client_'));
  assert.ok(client.clientSecret.startsWith('secret_'));
  assert.deepEqual(client.scopes, ['credentials:read']);

  const stored = await service.getClient(client.clientId);
  assert.notEqual(stored.hashedSecret, client.clientSecret, 'the raw secret must never be stored verbatim');
});

test('authorize rejects an unregistered redirect_uri', async () => {
  const service = await makeService();
  const client = await service.registerClient({ redirectUris: ['https://app.example.com/cb'], scopes: ['credentials:read'] });
  await assert.rejects(
    () => service.authorize({
      clientId: client.clientId,
      redirectUri: 'https://evil.example.com/cb',
      scope: 'credentials:read',
      ownerScopes: ['credentials:read'],
    }),
    (err) => err instanceof OAuthError && err.code === 'invalid_request',
  );
});

test('authorize rejects a scope the approving caller does not itself hold', async () => {
  const service = await makeService();
  const client = await service.registerClient({
    redirectUris: ['https://app.example.com/cb'],
    scopes: ['credentials:read', 'credentials:write'],
  });
  await assert.rejects(
    () => service.authorize({
      clientId: client.clientId,
      redirectUri: 'https://app.example.com/cb',
      scope: 'credentials:write',
      ownerScopes: ['credentials:read'],
    }),
    (err) => err instanceof OAuthError && err.code === 'invalid_scope' && err.status === 403,
  );
});

test('authorize rejects a scope the client itself is not registered for', async () => {
  const service = await makeService();
  const client = await service.registerClient({ redirectUris: ['https://app.example.com/cb'], scopes: ['credentials:read'] });
  await assert.rejects(
    () => service.authorize({
      clientId: client.clientId,
      redirectUri: 'https://app.example.com/cb',
      scope: 'admin:write',
      ownerScopes: ['*'],
    }),
    (err) => err instanceof OAuthError && err.code === 'invalid_scope',
  );
});

async function fullGrant(service, { scope = 'credentials:read' } = {}) {
  const client = await service.registerClient({ redirectUris: ['https://app.example.com/cb'], scopes: ['credentials:read', 'credentials:write'] });
  const { code } = await service.authorize({
    clientId: client.clientId,
    redirectUri: 'https://app.example.com/cb',
    scope,
    ownerScopes: ['*'],
    subject: 'admin',
  });
  const tokens = await service.exchangeAuthorizationCode({
    code,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    redirectUri: 'https://app.example.com/cb',
  });
  return { client, tokens };
}

test('the full authorization_code grant issues a working access + refresh token pair', async () => {
  const service = await makeService();
  const { tokens } = await fullGrant(service);
  assert.equal(tokens.token_type, 'Bearer');
  assert.equal(tokens.scope, 'credentials:read');
  assert.ok(tokens.access_token.startsWith('at_'));
  assert.ok(tokens.refresh_token.startsWith('rt_'));

  const grant = await service.validateAccessToken(tokens.access_token);
  assert.deepEqual(grant.scopes, ['credentials:read']);
  assert.equal(grant.oauth, true);
});

test('an authorization code cannot be exchanged twice', async () => {
  const service = await makeService();
  const client = await service.registerClient({ redirectUris: ['https://app.example.com/cb'], scopes: ['credentials:read'] });
  const { code } = await service.authorize({
    clientId: client.clientId,
    redirectUri: 'https://app.example.com/cb',
    scope: 'credentials:read',
    ownerScopes: ['*'],
  });
  const exchange = () => service.exchangeAuthorizationCode({
    code,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    redirectUri: 'https://app.example.com/cb',
  });
  await exchange();
  await assert.rejects(exchange, (err) => err instanceof OAuthError && err.code === 'invalid_grant');
});

test('exchangeAuthorizationCode rejects a wrong client_secret', async () => {
  const service = await makeService();
  const client = await service.registerClient({ redirectUris: ['https://app.example.com/cb'], scopes: ['credentials:read'] });
  const { code } = await service.authorize({
    clientId: client.clientId,
    redirectUri: 'https://app.example.com/cb',
    scope: 'credentials:read',
    ownerScopes: ['*'],
  });
  await assert.rejects(
    () => service.exchangeAuthorizationCode({ code, clientId: client.clientId, clientSecret: 'wrong', redirectUri: 'https://app.example.com/cb' }),
    (err) => err instanceof OAuthError && err.code === 'invalid_client' && err.status === 401,
  );
});

test('refresh token rotation issues a new pair and invalidates the old refresh token', async () => {
  const service = await makeService();
  const { client, tokens } = await fullGrant(service);

  const rotated = await service.exchangeRefreshToken({
    refreshToken: tokens.refresh_token,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
  });
  assert.notEqual(rotated.access_token, tokens.access_token);
  assert.notEqual(rotated.refresh_token, tokens.refresh_token);

  await assert.rejects(
    () => service.exchangeRefreshToken({ refreshToken: tokens.refresh_token, clientId: client.clientId, clientSecret: client.clientSecret }),
    (err) => err instanceof OAuthError && err.code === 'invalid_grant',
  );
});

test('refresh cannot widen scope beyond the original grant', async () => {
  const service = await makeService();
  const { client, tokens } = await fullGrant(service, { scope: 'credentials:read' });
  await assert.rejects(
    () => service.exchangeRefreshToken({
      refreshToken: tokens.refresh_token,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      scope: 'credentials:read credentials:write',
    }),
    (err) => err instanceof OAuthError && err.code === 'invalid_scope',
  );
});

test('introspect reports active:true for a live token and active:false after revocation', async () => {
  const service = await makeService();
  const { tokens } = await fullGrant(service);

  const active = await service.introspect(tokens.access_token);
  assert.equal(active.active, true);
  assert.equal(active.scope, 'credentials:read');

  await service.revoke(tokens.access_token);
  const revoked = await service.introspect(tokens.access_token);
  assert.deepEqual(revoked, { active: false });
});

test('introspect reports active:false for a garbage token without throwing', async () => {
  const service = await makeService();
  const result = await service.introspect('not-a-real-token');
  assert.deepEqual(result, { active: false });
});

test('an expired access token is treated as inactive', async () => {
  const service = await makeService({ oauthAccessTokenTtlMs: 1 });
  const { tokens } = await fullGrant(service);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(await service.validateAccessToken(tokens.access_token), null);
  assert.deepEqual(await service.introspect(tokens.access_token), { active: false });
});

test('clients and tokens survive a reload from disk', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oauth-test-'));
  const service1 = new OAuthService({ dataDir: dir });
  const { tokens } = await fullGrant(service1);

  const service2 = new OAuthService({ dataDir: dir });
  const grant = await service2.validateAccessToken(tokens.access_token);
  assert.ok(grant);
  assert.deepEqual(grant.scopes, ['credentials:read']);
});
