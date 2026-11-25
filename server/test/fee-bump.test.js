import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Account,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { buildFeeBumpXdr, FeeBumpError } from '../src/fee-bump.js';

const NETWORK = Networks.TESTNET;
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));
const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 8));

function makeSignedInvocation({ contract = CONTRACT, sign = true } = {}) {
  const source = Keypair.random();
  const contractAddress = xdr.ScAddress.scAddressTypeContract(
    new xdr.ContractId(StrKey.decodeContract(contract)),
  );
  const invokeArgs = new xdr.InvokeContractArgs({
    contractAddress,
    functionName: 'issue_attestations_batch',
    args: [],
  });
  const operation = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(invokeArgs),
    auth: [],
  });
  const transaction = new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: NETWORK,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();
  if (sign) transaction.sign(source);
  return transaction.toXDR();
}

function config(sponsor = Keypair.random(), overrides = {}) {
  return {
    feeBumpSponsorSecret: sponsor.secret(),
    feeBumpMaxFeeStroops: 10_000,
    sorobanNetworkPassphrase: NETWORK,
    contracts: { identity: '', credential: CONTRACT },
    ...overrides,
  };
}

test('builds an outer fee-bump envelope signed by the configured sponsor', () => {
  const sponsor = Keypair.random();
  const result = buildFeeBumpXdr({ signedXdr: makeSignedInvocation(), config: config(sponsor) });
  const envelope = TransactionBuilder.fromXDR(result.feeBumpXdr, NETWORK);

  assert.ok(envelope instanceof FeeBumpTransaction);
  assert.equal(result.sponsor, sponsor.publicKey());
  assert.equal(envelope.signatures.length, 1);
  assert.ok(sponsor.verify(envelope.hash(), Buffer.from(envelope.signatures[0].signature.value)));
  assert.equal(result.feeStroops, envelope.fee);
  assert.ok(Number(result.feeStroops) <= result.maxFeeStroops);
});

test('rejects an inner transaction without a valid source-account signature', () => {
  assert.throws(
    () => buildFeeBumpXdr({ signedXdr: makeSignedInvocation({ sign: false }), config: config() }),
    (error) => error instanceof FeeBumpError && error.code === 'INNER_SIGNATURE_REQUIRED',
  );
});

test('rejects contract calls outside the configured allowlist', () => {
  assert.throws(
    () => buildFeeBumpXdr({ signedXdr: makeSignedInvocation({ contract: OTHER_CONTRACT }), config: config() }),
    (error) => error instanceof FeeBumpError && error.code === 'CONTRACT_NOT_ALLOWED',
  );
});

test('rejects a sponsor fee that would exceed the hard spend ceiling', () => {
  assert.throws(
    () => buildFeeBumpXdr({ signedXdr: makeSignedInvocation(), config: config(undefined, { feeBumpMaxFeeStroops: 1000 }) }),
    (error) => error instanceof FeeBumpError && error.code === 'SPONSOR_FEE_LIMIT_EXCEEDED',
  );
});

test('fee bump is disabled when no sponsor secret is configured', () => {
  assert.throws(
    () => buildFeeBumpXdr({ signedXdr: makeSignedInvocation(), config: config(undefined, { feeBumpSponsorSecret: '' }) }),
    (error) => error instanceof FeeBumpError && error.status === 503,
  );
});
