import {
  FeeBumpTransaction,
  Keypair,
  StrKey,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

const MIN_BASE_FEE_STROOPS = 100;
const FEE_HEADROOM_MULTIPLIER = 10n;

export class FeeBumpError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'FeeBumpError';
    this.code = code;
    this.status = status;
  }
}

function readFunctionName(xdrString) {
  const bytes = xdrString?.bytes;
  if (!bytes) return '';
  return Buffer.from(bytes).toString('utf8');
}

function invokeDetails(operation) {
  if (operation?.type !== 'invokeHostFunction') return null;
  const invoke = operation.func?.invokeContract;
  if (!invoke) return null;
  const contractAddress = invoke.contractAddress;
  if (contractAddress?.type !== 'scAddressTypeContract') return null;
  const contractBytes = contractAddress.contractId?.value;
  if (!contractBytes) return null;
  return {
    contractId: StrKey.encodeContract(Buffer.from(contractBytes)),
    functionName: readFunctionName(invoke.functionName),
    args: invoke.args ?? [],
  };
}

function hasValidSourceSignature(transaction) {
  if (!transaction.source || !Array.isArray(transaction.signatures) || transaction.signatures.length === 0) {
    return false;
  }
  let sourceKey;
  try {
    sourceKey = Keypair.fromPublicKey(transaction.source);
  } catch {
    return false;
  }
  const hash = transaction.hash();
  return transaction.signatures.some((decorated) => {
    try {
      return sourceKey.verify(hash, Buffer.from(decorated.signature.value));
    } catch {
      return false;
    }
  });
}

/**
 * Construct and sign a fee-bump envelope without submitting it.
 *
 * Only one signed Soroban `invokeHostFunction` operation targeting a
 * configured identity/credential contract is eligible. The sponsor pays a
 * bounded inclusion fee; users remain responsible for signing the inner
 * transaction and any Soroban authorization entries it requires.
 *
 * @param {{signedXdr: string, config: object}} options
 * @returns {{feeBumpXdr: string, hash: string, sponsor: string, feeStroops: string, maxFeeStroops: number}}
 */
export function buildFeeBumpXdr({ signedXdr, config }) {
  if (typeof signedXdr !== 'string' || signedXdr.length === 0 || signedXdr.length > 100_000) {
    throw new FeeBumpError('INVALID_XDR', 'A valid signed transaction XDR is required.');
  }
  const sponsorSecret = config?.feeBumpSponsorSecret;
  if (!sponsorSecret) {
    throw new FeeBumpError('FEE_BUMP_DISABLED', 'Fee-bump sponsorship is not configured.', 503);
  }
  const networkPassphrase = config?.sorobanNetworkPassphrase;
  if (!networkPassphrase) {
    throw new FeeBumpError('NETWORK_NOT_CONFIGURED', 'The Stellar network passphrase is not configured.', 503);
  }

  let sponsor;
  let inner;
  try {
    sponsor = Keypair.fromSecret(sponsorSecret);
    inner = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  } catch {
    throw new FeeBumpError('INVALID_XDR', 'The signed XDR is invalid for the configured Stellar network.');
  }

  if (!(inner instanceof Transaction) || inner instanceof FeeBumpTransaction) {
    throw new FeeBumpError('INVALID_ENVELOPE', 'The inner envelope must be a regular Stellar transaction.');
  }
  if (!hasValidSourceSignature(inner)) {
    throw new FeeBumpError('INNER_SIGNATURE_REQUIRED', 'The inner transaction must contain a valid source-account signature.');
  }
  if (inner.operations.length !== 1) {
    throw new FeeBumpError('UNSUPPORTED_TRANSACTION', 'Only a single Soroban contract invocation can be sponsored.');
  }

  const invocation = invokeDetails(inner.operations[0]);
  if (!invocation) {
    throw new FeeBumpError('UNSUPPORTED_TRANSACTION', 'Only Soroban contract invocation transactions can be sponsored.');
  }
  const allowedContracts = [config.contracts?.identity, config.contracts?.credential]
    .filter((value) => typeof value === 'string' && value.length > 0);
  if (allowedContracts.length === 0 || !allowedContracts.includes(invocation.contractId)) {
    throw new FeeBumpError('CONTRACT_NOT_ALLOWED', 'The transaction targets a contract that is not configured for sponsorship.', 403);
  }

  const configuredMaxFee = Number(config.feeBumpMaxFeeStroops ?? 500_000);
  if (!Number.isSafeInteger(configuredMaxFee) || configuredMaxFee < MIN_BASE_FEE_STROOPS) {
    throw new FeeBumpError('INVALID_SPONSOR_LIMIT', 'The configured sponsor fee limit is invalid.', 503);
  }
  const requestedMaxFee = config.feeBumpRequestedMaxFeeStroops == null
    ? configuredMaxFee
    : Number(config.feeBumpRequestedMaxFeeStroops);
  const maxFee = Math.min(configuredMaxFee, requestedMaxFee);
  if (!Number.isSafeInteger(maxFee) || maxFee < MIN_BASE_FEE_STROOPS) {
    throw new FeeBumpError('INVALID_SPONSOR_LIMIT', 'The requested sponsor fee limit is invalid.');
  }

  // Stellar's SDK requires the base fee to cover at least the inner inclusion
  // fee. Use conservative headroom for Soroban fee-bump envelopes, then enforce
  // the hard total spend ceiling after the SDK has accounted for resource fees.
  const innerFee = BigInt(inner.fee);
  const operationCount = BigInt(inner.operations.length);
  const baseFee = BigInt(MIN_BASE_FEE_STROOPS) > innerFee * FEE_HEADROOM_MULTIPLIER / operationCount
    ? BigInt(MIN_BASE_FEE_STROOPS)
    : (innerFee * FEE_HEADROOM_MULTIPLIER + operationCount - 1n) / operationCount;

  let feeBump;
  try {
    feeBump = TransactionBuilder.buildFeeBumpTransaction(
      sponsor.publicKey(),
      baseFee.toString(),
      inner,
      networkPassphrase,
    );
  } catch (error) {
    throw new FeeBumpError('FEE_BUMP_BUILD_FAILED', error.message);
  }
  const feeStroops = BigInt(feeBump.fee);
  if (feeStroops > BigInt(maxFee)) {
    throw new FeeBumpError(
      'SPONSOR_FEE_LIMIT_EXCEEDED',
      `The estimated sponsor fee (${feeStroops}) exceeds the configured maximum (${maxFee}) stroops.`,
      400,
    );
  }

  feeBump.sign(sponsor);
  return {
    feeBumpXdr: feeBump.toXDR(),
    hash: feeBump.hash().toString('hex'),
    sponsor: sponsor.publicKey(),
    feeStroops: feeStroops.toString(),
    maxFeeStroops: maxFee,
  };
}

/** Read decoded invocation metadata for endpoint-level method checks. */
export function inspectSorobanInvocation(signedXdr, networkPassphrase) {
  let transaction;
  try {
    transaction = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  } catch {
    throw new FeeBumpError('INVALID_XDR', 'The signed XDR is invalid for the configured Stellar network.');
  }
  if (!(transaction instanceof Transaction) || transaction.operations.length !== 1) {
    throw new FeeBumpError('UNSUPPORTED_TRANSACTION', 'A single Soroban contract invocation is required.');
  }
  const invocation = invokeDetails(transaction.operations[0]);
  if (!invocation) throw new FeeBumpError('UNSUPPORTED_TRANSACTION', 'A Soroban contract invocation is required.');
  return { transaction, ...invocation };
}
