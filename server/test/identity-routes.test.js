import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import {
  Account,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { createIdentityRouter } from '../src/routes/identity.js';

const NETWORK = Networks.TESTNET;
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));

function signedInvocation(functionName, args = []) {
  const source = Keypair.random();
  const contractAddress = xdr.ScAddress.scAddressTypeContract(
    new xdr.ContractId(StrKey.decodeContract(CONTRACT)),
  );
  const operation = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({
      contractAddress,
      functionName,
      args,
    })),
    auth: [],
  });
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: NETWORK,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();
  transaction.sign(source);
  return transaction.toXDR();
}

function request(pathname, body, method = 'POST') {
  const req = Readable.from([Buffer.from(body === undefined || body === null ? '' : JSON.stringify(body))]);
  req.method = method;
  req.url = pathname;
  req.headers = {
    'content-type': 'application/json',
    'x-api-key': 'route-test-key',
  };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function response() {
  return {
    statusCode: undefined,
    headers: undefined,
    body: undefined,
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

function routeConfig(overrides = {}) {
  return {
    adminApiKey: 'route-test-key',
    maxBodyBytes: 1_000_000,
    sorobanNetworkPassphrase: NETWORK,
    contracts: { credential: CONTRACT },
    feeBumpSponsorSecret: Keypair.random().secret(),
    feeBumpMaxFeeStroops: 100_000,
    ...overrides,
  };
}

function batchArgs(length) {
  return [
    stellarAddressScVal(Keypair.random().publicKey()),
    xdr.ScVal.scvVec(Array.from({ length }, (_, index) => xdr.ScVal.scvString(`entry-${index}`))),
  ];
}

function stellarAddressScVal(address) {
  return xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(
    xdr.PublicKey.publicKeyTypeEd25519(StrKey.decodeEd25519PublicKey(address)),
  ));
}

function legacyIssueArgs(issuer) {
  return [
    stellarAddressScVal(issuer),
    xdr.ScVal.scvBytes(Buffer.alloc(32, 1)),
    stellarAddressScVal(Keypair.random().publicKey()),
    xdr.ScVal.scvMap([]),
    xdr.ScVal.scvU32(0),
  ];
}

async function callRoute(router, path, body, method = 'POST') {
  const res = response();
  const handled = await router(request(path, body, method), res, { pathname: path });
  assert.equal(handled, true);
  return res;
}

async function callRouteAsIssuer(router, path, body, issuer, method = 'POST') {
  const req = request(path, body, method);
  req.issuer = issuer;
  req.userId = issuer;
  const res = response();
  const handled = await router(req, res, { pathname: path });
  assert.equal(handled, true);
  return res;
}

function revokeArgs(issuer, id) {
  return [stellarAddressScVal(issuer), xdr.ScVal.scvBytes(Buffer.from(id, 'hex'))];
}

test('batch attestation endpoint submits transactions with at most 50 entries', async () => {
  const submissions = [];
  const router = createIdentityRouter({
    config: routeConfig(),
    soroban: { submitSignedXdr: async (xdrValue) => { submissions.push(xdrValue); return { hash: 'tx-hash' }; } },
  });
  const signedXdr = signedInvocation('issue_attestations_batch', batchArgs(50));

  const res = await callRoute(router, '/attestation/batch', { signedXdr });

  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.json(), { count: 50, transaction: { hash: 'tx-hash' } });
  assert.deepEqual(submissions, [signedXdr]);
});

test('batch attestation endpoint rejects 51 entries without submitting the transaction', async () => {
  const submissions = [];
  const router = createIdentityRouter({
    config: routeConfig(),
    soroban: { submitSignedXdr: async (xdrValue) => submissions.push(xdrValue) },
  });
  const signedXdr = signedInvocation('issue_attestations_batch', batchArgs(51));

  const res = await callRoute(router, '/attestation/batch', { signedXdr });

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'BATCH_TOO_LARGE');
  assert.deepEqual(submissions, []);
});

test('single attestation endpoint binds the signed issuer to the authenticated principal', async () => {
  const issuer = Keypair.random().publicKey();
  const otherIssuer = Keypair.random().publicKey();
  const submissions = [];
  const router = createIdentityRouter({
    config: routeConfig(),
    soroban: { submitSignedXdr: async (signedXdr) => submissions.push(signedXdr) },
  });
  const signedXdr = signedInvocation('issue_attestation', legacyIssueArgs(issuer));

  const res = await callRouteAsIssuer(router, '/attestation', { signedXdr }, otherIssuer);

  assert.equal(res.statusCode, 403);
  assert.equal(res.json().code, 'ATTESTATION_ISSUER_MISMATCH');
  assert.deepEqual(submissions, []);
});

test('fee-bump endpoint returns a sponsor-signed envelope without submitting it', async () => {
  const submissions = [];
  const sponsor = Keypair.random();
  const router = createIdentityRouter({
    config: routeConfig({ feeBumpSponsorSecret: sponsor.secret() }),
    soroban: { submitSignedXdr: async (xdrValue) => submissions.push(xdrValue) },
  });
  const signedXdr = signedInvocation('issue_attestation');

  const res = await callRoute(router, '/transactions/fee-bump', { signedXdr });

  assert.equal(res.statusCode, 200);
  const result = res.json();
  assert.equal(result.sponsor, sponsor.publicKey());
  assert.ok(result.feeBumpXdr);
  assert.deepEqual(submissions, []);
});

test('identity GET reads account attestations from Soroban', async () => {
  const address = Keypair.random().publicKey();
  const accountCalls = [];
  const router = createIdentityRouter({
    config: routeConfig(),
    soroban: {
      resolveDid: async () => ({ id: `did:stellar:${address}` }),
      getAttestationsForAccount: async (account) => {
        accountCalls.push(account);
        return [{ id: '11'.repeat(32), issuer: `did:stellar:${address}`, subject: `did:stellar:${address}`, status: 'active' }];
      },
    },
  });

  const res = await callRoute(router, `/identity/did:stellar:${address}`, null, 'GET');

  assert.equal(res.statusCode, 200);
  assert.deepEqual(accountCalls, [address]);
  assert.equal(res.json().attestations[0].id, '11'.repeat(32));
});

test('DELETE attestation rejects a signed revoke for a different ID', async () => {
  const issuer = Keypair.random().publicKey();
  const id = '22'.repeat(32);
  const submissions = [];
  const router = createIdentityRouter({
    config: routeConfig(),
    soroban: {
      getAttestationById: async () => ({ id, issuer, subject: 'subject', status: 'active' }),
      submitSignedXdr: async (signedXdr) => submissions.push(signedXdr),
    },
  });

  const res = await callRoute(router, `/attestation/${id}`, {
    signedXdr: signedInvocation('revoke_attestation', revokeArgs(issuer, '33'.repeat(32))),
  }, 'DELETE');

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'ATTESTATION_ID_MISMATCH');
  assert.deepEqual(submissions, []);
});

test('DELETE attestation binds the signed issuer and submits a matching revoke', async () => {
  const issuer = Keypair.random().publicKey();
  const otherIssuer = Keypair.random().publicKey();
  const id = '44'.repeat(32);
  const submissions = [];
  const router = createIdentityRouter({
    config: routeConfig(),
    soroban: {
      getAttestationById: async () => ({ id, issuer, subject: 'subject', status: 'active' }),
      submitSignedXdr: async (signedXdr) => { submissions.push(signedXdr); return { hash: 'revoked-tx' }; },
    },
  });

  const mismatch = await callRoute(router, `/attestation/${id}`, {
    signedXdr: signedInvocation('revoke_attestation', revokeArgs(otherIssuer, id)),
  }, 'DELETE');
  assert.equal(mismatch.statusCode, 400);
  assert.equal(mismatch.json().code, 'ATTESTATION_ISSUER_MISMATCH');
  assert.deepEqual(submissions, []);

  const accepted = await callRoute(router, `/attestation/${id}`, {
    signedXdr: signedInvocation('revoke_attestation', revokeArgs(issuer, id)),
  }, 'DELETE');
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().attestationId, id);
  assert.equal(submissions.length, 1);
});
