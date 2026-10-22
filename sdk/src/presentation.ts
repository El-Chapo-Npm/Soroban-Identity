import { randomBytes, createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import type { Credential, DidDocument, PrivacyPolicyTemplate } from './types';
import { SorobanIdentityError } from './errors';

export type { PrivacyPolicyTemplate };

/** Minimal interface — satisfied by {@link IdentityClient}. */
interface DidResolverLike {
  resolveDid(address: string): Promise<DidDocument>;
}

// ── W3C VC Data Model 2.0 types ─────────────────────────────────────────────

/**
 * A selective-disclosure credential envelope embedded in a
 * {@link VerifiablePresentation}. Contains only the claim fields the holder
 * chose to disclose; the `claimsHash` lets verifiers confirm the disclosed
 * claims against the on-chain hash via `verify_claims_hash`.
 */
export interface VerifiableCredentialSubset {
  '@context': string[];
  type: string[];
  /** Hex-encoded credential ID matching the on-chain record. */
  id: string;
  /** Stellar address of the issuer formatted as `did:stellar:<address>`. */
  issuer: string;
  credentialSubject: {
    /** Stellar address of the subject formatted as `did:stellar:<address>`. */
    id: string;
    [claim: string]: string;
  };
  /** Canonical credential type label (`Kyc`, `Reputation`, etc.). */
  credentialType: string;
  /** Hex SHA-256 of the full off-chain claims payload (from the on-chain record). */
  claimsHash: string;
  /** Unix timestamp (seconds) of original issuance. */
  issuedAt: number;
  /** Unix timestamp (seconds) after which the credential is invalid. 0 = no expiry. */
  expiresAt: number;
}

/**
 * Lightweight proof block attached to a {@link VerifiablePresentation}.
 * Follows the W3C Data Integrity Proof structure.
 */
export interface PresentationProof {
  type: 'DataIntegrityProof';
  /** Unix timestamp (ms) when the proof was created. */
  created: number;
  proofPurpose: 'authentication' | 'assertionMethod';
  cryptosuite: string;
  /** `did:stellar:<address>#key-1` of the signing key. */
  verificationMethod?: string;
  /** Base64url-encoded Ed25519 signature over the canonical presentation JSON. */
  jws?: string;
}

/**
 * W3C VC Data Model 2.0 Verifiable Presentation with selective disclosure.
 *
 * Created by {@link PresentationClient.createPresentation}; verified by
 * {@link PresentationClient.verifyPresentation}.
 */
export interface VerifiablePresentation {
  '@context': string[];
  type: string[];
  /** Unique presentation ID (`urn:presentation:<hex>`). */
  id: string;
  /** DID (`did:stellar:<address>`) of the entity presenting the credential. */
  holder?: string;
  verifiableCredential: VerifiableCredentialSubset[];
  proof?: PresentationProof;
  /** Unix timestamp (ms) when the presentation was created. */
  created: number;
  /** Optional challenge (nonce) the presentation is bound to. */
  challenge?: string;
  /** Unix timestamp (ms) after which the presentation is no longer valid. */
  expiresAt?: number;
}

/**
 * Supported proof formats for a {@link VerifiablePresentation}.
 *
 * - `DataIntegrityProof` — W3C LD-Proofs style detached signature.
 * - `JwtProof2020` — JWT-encoded proof (`jws` holds the compact JWT).
 */
export type PresentationProofFormat = 'DataIntegrityProof' | 'JwtProof2020';

/**
 * Options controlling presentation creation.
 */
export interface CreatePresentationOptions {
  /** Skip verification of the supplied proof signature. */
  skipProofVerification?: boolean;
  /** Challenge (nonce) to bind the presentation to. */
  challenge?: string;
  /** Presentation expiry as a Unix timestamp (ms). */
  expiresAt?: number;
  /** Proof format to emit. Defaults to `DataIntegrityProof`. */
  proofFormat?: PresentationProofFormat;
}

/**
 * Options controlling presentation verification.
 */
export interface VerifyPresentationOptions {
  /** Expected challenge; when set the presentation must carry the same value. */
  challenge?: string;
  /** Current time in ms used for expiry checks. Defaults to `Date.now()`. */
  now?: number;
}

/**
 * A reusable presentation template describing which claims to disclose.
 */
export interface PresentationTemplate {
  /** Template name. */
  name: string;
  /** Claim fields to disclose. */
  fieldsToDisclose: string[];
  /** Optional proof format to use. */
  proofFormat?: PresentationProofFormat;
  /** Optional presentation lifetime in ms from creation. */
  ttlMs?: number;
}

// ── Verification result ──────────────────────────────────────────────────────

/**
 * Reason a {@link VerifiablePresentation} failed structural verification.
 *
 * - `INVALID_CONTEXT` — the required W3C context URL is absent.
 * - `INVALID_TYPE` — `VerifiablePresentation` is not in the `type` array.
 * - `MISSING_CREDENTIALS` — `verifiableCredential` is empty or absent.
 * - `INCOMPLETE_CREDENTIAL` — a credential subset is missing required fields.
 * - `MISSING_CLAIMS` — a credential subset has no `credentialSubject` claims.
 */
export type PresentationVerifyFailReason =
  | 'INVALID_CONTEXT'
  | 'INVALID_TYPE'
  | 'MISSING_CREDENTIALS'
  | 'INCOMPLETE_CREDENTIAL'
  | 'MISSING_CLAIMS'
  | 'CHALLENGE_MISMATCH'
  | 'EXPIRED'
  | 'INVALID_PROOF';

/**
 * Result from {@link PresentationClient.verifyPresentation}.
 *
 * `valid` is `true` when the presentation passes all structural checks.
 * `reason` is present when `valid` is `false`.
 */
export type PresentationVerifyResult =
  | { valid: true }
  | { valid: false; reason: PresentationVerifyFailReason };

// ── PresentationClient ───────────────────────────────────────────────────────

const W3C_VC_CONTEXT_V2 = 'https://www.w3.org/ns/credentials/v2';

/**
 * Client for creating and verifying W3C VC Data Model 2.0 Verifiable
 * Presentations with selective disclosure.
 *
 * **Selective disclosure flow:**
 * 1. Holder calls {@link PresentationClient.createPresentation} with the
 *    full credential and the list of claim fields to share.
 * 2. The presentation is sent to a relying party containing only the chosen
 *    claims alongside the on-chain `claimsHash`.
 * 3. Relying party calls {@link PresentationClient.verifyPresentation} for
 *    structural checks, then uses `CredentialClient.verifyCredential` and
 *    the contract's `verify_claims_hash` for on-chain validation.
 *
 * @example
 * ```ts
 * import { PresentationClient } from '@soroban-identity/sdk';
 *
 * const client = new PresentationClient();
 *
 * // Holder creates a presentation disclosing only 'name' and 'country'
 * const vp = client.createPresentation(credential, ['name', 'country'], holderAddress);
 *
 * // Relying party verifies the presentation structure
 * const result = client.verifyPresentation(vp);
 * if (!result.valid) throw new Error(result.reason);
 * ```
 */
export class PresentationClient {
  /**
   * Create a selective-disclosure Verifiable Presentation.
   *
   * Only the claim fields listed in `fieldsToDisclose` are included in the
   * presentation's `credentialSubject`. The `claimsHash` from the on-chain
   * record is always included so relying parties can verify the disclosed
   * claims against the contract via `verify_claims_hash`.
   *
   * Claim fields not present in the credential are silently omitted.
   *
   * @param credential       Full on-chain credential from
   *                         {@link CredentialClient.getCredential}.
   * @param fieldsToDisclose Claim keys to include in the presentation.
   * @param holderAddress    Optional Stellar address of the presenting party;
   *                         becomes `did:stellar:<address>` in the `holder` field.
   * @returns A {@link VerifiablePresentation} conforming to W3C VC DM 2.0.
   *
   * @example
   * ```ts
   * const vp = client.createPresentation(credential, ['name', 'country']);
   * ```
   */
  async createPresentation(
    credential: Credential,
    fieldsToDisclose: string[],
    holderAddress?: string,
    proofInput?: {
      /** Base64url-encoded Ed25519 signature from the holder over the presentation payload. */
      jws: string;
      /** Client used to resolve the holder's DID and obtain their public key. */
      identityClient: DidResolverLike;
    },
    opts?: CreatePresentationOptions
  ): Promise<VerifiablePresentation> {
    if (proofInput && !holderAddress) {
      throw new SorobanIdentityError(
        'holderAddress is required when proofInput is provided',
        'INVALID_ARGUMENT'
      );
    }

    const disclosedClaims: Record<string, string> = {};
    for (const field of fieldsToDisclose) {
      if (Object.prototype.hasOwnProperty.call(credential.claims, field)) {
        disclosedClaims[field] = credential.claims[field]!;
      }
    }

    const presentationId = `urn:presentation:${randomBytes(16).toString('hex')}`;

    const vc: VerifiableCredentialSubset = {
      '@context': [W3C_VC_CONTEXT_V2],
      type: ['VerifiableCredential'],
      id: `urn:credential:${credential.id}`,
      issuer: `did:stellar:${credential.issuer}`,
      credentialSubject: {
        id: `did:stellar:${credential.subject}`,
        ...disclosedClaims,
      },
      credentialType: credential.credentialType,
      claimsHash: credential.claimsHash,
      issuedAt: credential.issuedAt,
      expiresAt: credential.expiresAt,
    };

    const vp: VerifiablePresentation = {
      '@context': [W3C_VC_CONTEXT_V2],
      type: ['VerifiablePresentation'],
      id: presentationId,
      holder: holderAddress ? `did:stellar:${holderAddress}` : undefined,
      verifiableCredential: [vc],
      created: Date.now(),
      challenge: opts?.challenge,
      expiresAt: opts?.expiresAt,
    };

    if (proofInput) {
      const proofFormat: PresentationProofFormat = opts?.proofFormat ?? 'DataIntegrityProof';
      const proof: PresentationProof = {
        type: proofFormat === 'JwtProof2020' ? 'JwtProof2020' : 'DataIntegrityProof',
        created: vp.created,
        proofPurpose: 'authentication',
        cryptosuite: proofFormat === 'JwtProof2020' ? 'jwt-2020' : 'eddsa-2022',
        verificationMethod: holderAddress ? `did:stellar:${holderAddress}#key-1` : undefined,
        jws: proofInput.jws,
      };

      if (!opts?.skipProofVerification) {
        const didDoc = await proofInput.identityClient.resolveDid(holderAddress!);
        const signerAddress = didDoc.controller;

        // Canonical payload: deterministic function of credential identity + fields
        const payloadBytes = Buffer.from(
          JSON.stringify({
            credentialId: credential.id,
            fieldsToDisclose: [...fieldsToDisclose].sort(),
            holderAddress,
          })
        );

        let sigBytes: Buffer;
        try {
          sigBytes = Buffer.from(proofInput.jws, 'base64url');
        } catch {
          throw new SorobanIdentityError('proof.jws is not valid base64url', 'INVALID_PROOF');
        }

        const keypair = Keypair.fromPublicKey(signerAddress);
        const isValid = keypair.verify(payloadBytes, sigBytes);
        if (!isValid) {
          throw new SorobanIdentityError(
            'proof.jws signature is invalid for the holder\'s DID key',
            'INVALID_PROOF'
          );
        }
      }

      vp.proof = proof;
    }

    return vp;
  }

  /**
   * Verify the structural integrity of a Verifiable Presentation.
   *
   * Checks that the presentation conforms to W3C VC Data Model 2.0 and that
   * every embedded credential subset contains the required fields for
   * on-chain hash verification.
   *
   * **Note:** This method performs off-chain structural checks only. For full
   * verification also call `CredentialClient.verifyCredential` with the
   * credential ID and use the contract's `verify_claims_hash` entry point to
   * confirm the disclosed claims match the on-chain hash.
   *
   * @param presentation The presentation to verify.
   * @returns `{ valid: true }` when all structural checks pass; otherwise
   *   `{ valid: false, reason }` identifying the first failing check.
   *
   * @example
   * ```ts
   * const result = client.verifyPresentation(vp);
   * if (result.valid) {
   *   // proceed to on-chain checks
   * }
   * ```
   */
  verifyPresentation(
    presentation: VerifiablePresentation,
    opts?: VerifyPresentationOptions
  ): PresentationVerifyResult {
    if (!Array.isArray(presentation['@context']) || !presentation['@context'].includes(W3C_VC_CONTEXT_V2)) {
      return { valid: false, reason: 'INVALID_CONTEXT' };
    }
    if (!Array.isArray(presentation.type) || !presentation.type.includes('VerifiablePresentation')) {
      return { valid: false, reason: 'INVALID_TYPE' };
    }
    if (!Array.isArray(presentation.verifiableCredential) || presentation.verifiableCredential.length === 0) {
      return { valid: false, reason: 'MISSING_CREDENTIALS' };
    }

    for (const vc of presentation.verifiableCredential) {
      if (!vc.id || !vc.issuer || !vc.claimsHash || !vc.credentialSubject?.id) {
        return { valid: false, reason: 'INCOMPLETE_CREDENTIAL' };
      }
      const { id: _id, ...claims } = vc.credentialSubject;
      if (Object.keys(claims).length === 0) {
        return { valid: false, reason: 'MISSING_CLAIMS' };
      }
    }

    if (opts?.challenge !== undefined && presentation.challenge !== opts.challenge) {
      return { valid: false, reason: 'CHALLENGE_MISMATCH' };
    }

    const now = opts?.now ?? Date.now();
    if (typeof presentation.expiresAt === 'number' && presentation.expiresAt > 0 && now >= presentation.expiresAt) {
      return { valid: false, reason: 'EXPIRED' };
    }

    if (presentation.proof) {
      const proofType = presentation.proof.type;
      if (proofType !== 'DataIntegrityProof' && proofType !== 'JwtProof2020') {
        return { valid: false, reason: 'INVALID_PROOF' };
      }
      if (!presentation.proof.jws) {
        return { valid: false, reason: 'INVALID_PROOF' };
      }
    }

    return { valid: true };
  }

  /**
   * Create a presentation from a reusable {@link PresentationTemplate}.
   *
   * @param template         Template describing disclosed fields and options.
   * @param credential       Full on-chain credential.
   * @param holderAddress    Optional Stellar address of the presenting party.
   * @param proofInput       Optional proof input (see {@link PresentationClient.createPresentation}).
   * @param opts             Additional creation options; template values are used as defaults.
   */
  async createPresentationFromTemplate(
    template: PresentationTemplate,
    credential: Credential,
    holderAddress?: string,
    proofInput?: {
      jws: string;
      identityClient: DidResolverLike;
    },
    opts?: CreatePresentationOptions
  ): Promise<VerifiablePresentation> {
    const merged: CreatePresentationOptions = {
      ...opts,
      proofFormat: opts?.proofFormat ?? template.proofFormat,
    };
    if (merged.expiresAt === undefined && template.ttlMs !== undefined) {
      merged.expiresAt = Date.now() + template.ttlMs;
    }
    return this.createPresentation(
      credential,
      template.fieldsToDisclose,
      holderAddress,
      proofInput,
      merged
    );
  }

  /**
   * Compute the SHA-256 hash of a set of disclosed claims.
   *
   * The hash is computed over the JSON-serialised `claims` object with keys
   * sorted alphabetically. Relying parties can compare this value against the
   * `claimsHash` stored on-chain via the contract's `verify_claims_hash`
   * function to confirm the disclosed payload is genuine.
   *
   * @param disclosedClaims The `string → string` claims map to hash.
   * @returns 64-character hex SHA-256 of the canonical JSON representation.
   *
   * @example
   * ```ts
   * const hash = client.computeDisclosedClaimsHash({ name: 'Alice', country: 'US' });
   * // pass hash to CredentialClient.verifyClaimsHash() for on-chain confirmation
   * ```
   */
  computeDisclosedClaimsHash(disclosedClaims: Record<string, string>): string {
    const sorted = Object.fromEntries(
      Object.entries(disclosedClaims).sort(([a], [b]) => a.localeCompare(b))
    );
    return createHash('sha256').update(JSON.stringify(sorted), 'utf8').digest('hex');
  }
}

// ── Privacy helpers ──────────────────────────────────────────────────────────

/**
 * Options for {@link buildSelectivePresentation}.
 */
export interface BuildSelectivePresentationOptions extends CreatePresentationOptions {
  /** Stellar address of the presenting party. */
  holderAddress?: string;
  /** Optional proof input (see {@link PresentationClient.createPresentation}). */
  proofInput?: {
    jws: string;
    identityClient: DidResolverLike;
  };
  /** Optional client instance to reuse; a new one is created when omitted. */
  client?: PresentationClient;
}

/**
 * Build a selective-disclosure {@link VerifiablePresentation} from a
 * credential and the set of attributes the holder chose to disclose.
 *
 * This is a thin convenience wrapper around
 * {@link PresentationClient.createPresentation} intended for the frontend
 * selective-disclosure UI. Attributes not present in the credential are
 * silently omitted, and duplicate attribute names are de-duplicated.
 *
 * @param credential          Full on-chain credential.
 * @param disclosedAttributes Claim keys to disclose.
 * @param options             Holder address, proof input and presentation options.
 * @returns A {@link VerifiablePresentation} containing only the disclosed claims.
 *
 * @example
 * ```ts
 * const vp = await buildSelectivePresentation(credential, ['name', 'country'], {
 *   holderAddress,
 *   expiresAt: Date.now() + 60 * 60 * 1000,
 * });
 * ```
 */
export async function buildSelectivePresentation(
  credential: Credential,
  disclosedAttributes: string[],
  options?: BuildSelectivePresentationOptions
): Promise<VerifiablePresentation> {
  const client = options?.client ?? new PresentationClient();
  const fields = Array.from(new Set(disclosedAttributes));
  const { holderAddress, proofInput, client: _client, ...opts } = options ?? {};
  return client.createPresentation(credential, fields, holderAddress, proofInput, opts);
}
