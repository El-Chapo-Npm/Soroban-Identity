import { describe, it, expect, beforeEach } from 'vitest';
import { PresentationClient } from './presentation';
import type { Credential, VerifiablePresentation } from './types';
import { Keypair } from '@stellar/stellar-sdk';
import { randomBytes } from 'node:crypto';

describe('W3C Verifiable Presentations', () => {
  let client: PresentationClient;
  let holderKeypair: Keypair;
  let mockCredential: Credential;

  beforeEach(() => {
    client = new PresentationClient();
    holderKeypair = Keypair.random();

    mockCredential = {
      id: randomBytes(32).toString('hex'),
      subject: 'GBCEXAMPLEADDRESS123',
      issuer: 'GCISSUERADDRESS456',
      credentialType: 'KYC',
      claims: {
        name: 'Alice Smith',
        country: 'US',
        dateOfBirth: '1990-01-15',
        email: 'alice@example.com'
      },
      claimsHash: randomBytes(32).toString('hex'),
      signature: randomBytes(64).toString('hex'),
      issuedAt: Math.floor(Date.now() / 1000) - 86400,
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
      revoked: false,
      version: 1,
      lastModifiedAt: Math.floor(Date.now() / 1000),
      activationTime: 0,
      activationCancelled: false,
      schemaHash: randomBytes(32).toString('hex')
    };
  });

  describe('W3C Context Support', () => {
    it('should create a presentation with default W3C context', async () => {
      const vp = await client.createPresentation(
        mockCredential,
        ['name', 'country'],
        holderKeypair.publicKey()
      );

      expect(vp['@context']).toContain('https://www.w3.org/ns/credentials/v2');
      expect(vp.type).toContain('VerifiablePresentation');
    });

    it('should create a presentation with custom W3C contexts', async () => {
      const customContexts = [
        'https://www.w3.org/ns/credentials/v2',
        'https://w3id.org/security/suites/ed25519-2020/v1',
        'https://example.org/contexts/medical/v1'
      ];

      const vp = await client.createPresentation(
        mockCredential,
        ['name', 'country'],
        holderKeypair.publicKey(),
        undefined,
        {
          w3cContext: customContexts
        }
      );

      expect(vp['@context']).toEqual(customContexts);
    });

    it('should create a presentation with custom W3C types', async () => {
      const customTypes = ['VerifiablePresentation', 'MedicalPresentation', 'CredentialBundle'];

      const vp = await client.createPresentation(
        mockCredential,
        ['name', 'country'],
        holderKeypair.publicKey(),
        undefined,
        {
          w3cType: customTypes
        }
      );

      expect(vp.type).toEqual(customTypes);
    });
  });

  describe('Verifier Binding', () => {
    it('should create a presentation with verifier DID', async () => {
      const verifierDid = 'did:stellar:GVERIFIERADDRESS789';

      const vp = await client.createPresentation(
        mockCredential,
        ['name', 'country'],
        holderKeypair.publicKey(),
        undefined,
        {
          verifierDid
        }
      );

      expect(vp.verifierDid).toBe(verifierDid);
    });

    it('should create a presentation without verifier DID', async () => {
      const vp = await client.createPresentation(
        mockCredential,
        ['name', 'country'],
        holderKeypair.publicKey()
      );

      expect(vp.verifierDid).toBeUndefined();
    });
  });

  describe('Selective Disclosure with W3C', () => {
    it('should disclose only specified fields in W3C format', async () => {
      const vp = await client.createPresentation(
        mockCredential,
        ['name', 'country'],
        holderKeypair.publicKey(),
        undefined,
        {
          w3cContext: ['https://www.w3.org/ns/credentials/v2']
        }
      );

      const vc = vp.verifiableCredential[0];
      expect(vc).toBeDefined();
      expect(vc.credentialSubject.name).toBe('Alice Smith');
      expect(vc.credentialSubject.country).toBe('US');
      expect(vc.credentialSubject.dateOfBirth).toBeUndefined();
      expect(vc.credentialSubject.email).toBeUndefined();
    });

    it('should include W3C metadata in disclosed credentials', async () => {
      const vp = await client.createPresentation(
        mockCredential,
        ['name'],
        holderKeypair.publicKey()
      );

      const vc = vp.verifiableCredential[0];
      expect(vc['@context']).toContain('https://www.w3.org/ns/credentials/v2');
      expect(vc.type).toContain('VerifiableCredential');
      expect(vc.id).toContain('urn:credential:');
      expect(vc.issuer).toBe(`did:stellar:${mockCredential.issuer}`);
    });
  });

  describe('W3C Presentation Verification', () => {
    it('should verify a valid W3C presentation', async () => {
      const vp = await client.createPresentation(
        mockCredential,
        ['name', 'country'],
        holderKeypair.publicKey(),
        undefined,
        {
          challenge: 'test-challenge-123',
          w3cContext: ['https://www.w3.org/ns/credentials/v2']
        }
      );

      const result = client.verifyPresentation(vp, {
        challenge: 'test-challenge-123'
      });

      expect(result.valid).toBe(true);
    });

    it('should reject presentation with missing W3C context', () => {
      const invalidVp = {
        '@context': [],
        type: ['VerifiablePresentation'],
        id: 'urn:presentation:test',
        verifiableCredential: [{
          '@context': ['https://www.w3.org/ns/credentials/v2'],
          type: ['VerifiableCredential'],
          id: 'urn:credential:test',
          issuer: 'did:stellar:GCISSUER',
          credentialSubject: { id: 'did:stellar:GCSUBJECT', name: 'Test' },
          credentialType: 'Test',
          claimsHash: '0'.repeat(64),
          issuedAt: Date.now(),
          expiresAt: Date.now() + 86400000
        }],
        created: Date.now()
      };

      const result = client.verifyPresentation(invalidVp);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('INVALID_CONTEXT');
    });

    it('should reject presentation with invalid W3C type', () => {
      const invalidVp = {
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        type: ['InvalidType'],
        id: 'urn:presentation:test',
        verifiableCredential: [{
          '@context': ['https://www.w3.org/ns/credentials/v2'],
          type: ['VerifiableCredential'],
          id: 'urn:credential:test',
          issuer: 'did:stellar:GCISSUER',
          credentialSubject: { id: 'did:stellar:GCSUBJECT', name: 'Test' },
          credentialType: 'Test',
          claimsHash: '0'.repeat(64),
          issuedAt: Date.now(),
          expiresAt: Date.now() + 86400000
        }],
        created: Date.now()
      };

      const result = client.verifyPresentation(invalidVp);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('INVALID_TYPE');
    });
  });

  describe('Challenge Binding', () => {
    it('should verify presentation with matching challenge', async () => {
      const challenge = 'verifier-nonce-' + randomBytes(16).toString('hex');

      const vp = await client.createPresentation(
        mockCredential,
        ['name', 'country'],
        holderKeypair.publicKey(),
        undefined,
        { challenge }
      );

      const result = client.verifyPresentation(vp, { challenge });
      expect(result.valid).toBe(true);
    });

    it('should reject presentation with mismatched challenge', async () => {
      const vp = await client.createPresentation(
        mockCredential,
        ['name', 'country'],
        holderKeypair.publicKey(),
        undefined,
        { challenge: 'challenge-1' }
      );

      const result = client.verifyPresentation(vp, { challenge: 'challenge-2' });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('CHALLENGE_MISMATCH');
    });
  });

  describe('Expiry Handling', () => {
    it('should verify presentation within expiry time', async () => {
      const expiresAt = Date.now() + 3600000; // 1 hour from now

      const vp = await client.createPresentation(
        mockCredential,
        ['name', 'country'],
        holderKeypair.publicKey(),
        undefined,
        { expiresAt }
      );

      const result = client.verifyPresentation(vp, { now: Date.now() });
      expect(result.valid).toBe(true);
    });

    it('should reject expired presentation', async () => {
      const expiresAt = Date.now() - 1000; // 1 second ago

      const vp = await client.createPresentation(
        mockCredential,
        ['name', 'country'],
        holderKeypair.publicKey(),
        undefined,
        { expiresAt }
      );

      const result = client.verifyPresentation(vp, { now: Date.now() });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('EXPIRED');
    });
  });

  describe('Multi-Credential Bundling', () => {
    it('should support bundling multiple credentials (future enhancement)', async () => {
      // This test demonstrates the intended use case for credential bundling
      // Current implementation supports one credential per presentation
      // Future implementation will support multiple credentials

      const vp = await client.createPresentation(
        mockCredential,
        ['name', 'country'],
        holderKeypair.publicKey(),
        undefined,
        {
          w3cContext: ['https://www.w3.org/ns/credentials/v2'],
          w3cType: ['VerifiablePresentation', 'CredentialBundle']
        }
      );

      expect(vp.verifiableCredential).toHaveLength(1);
      expect(vp.type).toContain('CredentialBundle');
    });
  });

  describe('Claims Hash Computation', () => {
    it('should compute correct hash for disclosed claims', () => {
      const disclosedClaims = {
        name: 'Alice Smith',
        country: 'US'
      };

      const hash = client.computeDisclosedClaimsHash(disclosedClaims);
      expect(hash).toHaveLength(64); // SHA-256 hex string
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should produce same hash for same claims in different order', () => {
      const claims1 = { name: 'Alice', country: 'US' };
      const claims2 = { country: 'US', name: 'Alice' };

      const hash1 = client.computeDisclosedClaimsHash(claims1);
      const hash2 = client.computeDisclosedClaimsHash(claims2);

      expect(hash1).toBe(hash2);
    });
  });
});
