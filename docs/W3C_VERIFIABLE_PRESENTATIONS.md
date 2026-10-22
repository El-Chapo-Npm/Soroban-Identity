# W3C Verifiable Presentations Support

## Overview

Soroban Identity now supports the **W3C Verifiable Presentations (VP)** specification for bundling multiple credentials into a single, verifiable presentation. This feature enables:

- **Credential Bundling**: Group multiple verifiable credentials together
- **Selective Disclosure**: Choose which claims to reveal from each credential
- **Standard Compliance**: Full W3C VC Data Model 2.0 compatibility
- **Verifier Binding**: Optional binding to a specific verifier's DID
- **Custom Contexts**: Support for custom JSON-LD contexts

## W3C Verifiable Presentations Specification

The implementation follows the [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/) specification for presentations.

### Key Features

- **@context**: JSON-LD context URIs for semantic interoperability
- **type**: Type assertions identifying the presentation format
- **holder**: DID of the entity presenting the credentials
- **verifiableCredential**: Array of credentials being presented
- **proof**: Cryptographic proof binding the presentation to the holder
- **challenge**: Anti-replay nonce provided by the verifier
- **verifier**: Optional DID of the intended verifier

## Usage

### Creating a W3C Verifiable Presentation

#### TypeScript SDK

```typescript
import { PresentationClient, CredentialClient } from '@soroban-identity/sdk';

const presentationClient = new PresentationClient();
const credentialClient = new CredentialClient(config);

// Fetch credentials
const credential1 = await credentialClient.getCredential(issuer, credentialId1);
const credential2 = await credentialClient.getCredential(issuer, credentialId2);

// Create a presentation with selective disclosure
const vp = await presentationClient.createPresentation(
  credential1,
  ['name', 'country'], // Only disclose these fields
  holderAddress,
  proofInput,
  {
    challenge: 'nonce-from-verifier',
    expiresAt: Date.now() + 3600000, // 1 hour
    w3cContext: [
      'https://www.w3.org/ns/credentials/v2',
      'https://w3id.org/security/suites/ed25519-2020/v1'
    ],
    w3cType: ['VerifiablePresentation', 'CustomPresentation'],
    verifierDid: 'did:stellar:VERIFIER_ADDRESS'
  }
);

// Verify the presentation
const result = presentationClient.verifyPresentation(vp, {
  challenge: 'nonce-from-verifier',
  now: Date.now()
});

if (result.valid) {
  console.log('Presentation is valid');
} else {
  console.error('Presentation failed:', result.reason);
}
```

#### Smart Contract

```rust
use soroban_sdk::{Bytes, BytesN, Vec, Env, Address};

// Create a W3C VP bundle
let bundle_id = credential_manager.create_bundle(
    &env,
    owner.clone(),
    credential_ids.clone()
);

// Create presentation with W3C fields
let w3c_context = vec![
    &env,
    Bytes::from_str(&env, "https://www.w3.org/ns/credentials/v2")
];

let w3c_type = vec![
    &env,
    Bytes::from_str(&env, "VerifiablePresentation")
];

let verifier = Some(Bytes::from_str(&env, "did:stellar:VERIFIER_ADDRESS"));

let presentation_id = create_presentation(
    &env,
    holder.clone(),
    bundle_id,
    disclosed_ids,
    field_filters,
    challenge,
    domain,
    expires_at,
    proof_type,
    verification_method,
    signature,
    w3c_context,
    w3c_type,
    verifier
)?;

// Verify the presentation
let result = verify_presentation(
    &env,
    presentation_id,
    expected_challenge,
    expected_domain
)?;
```

## Configuration Limits

The following limits are enforced to ensure efficient on-chain storage:

| Parameter | Limit | Constant |
|-----------|-------|----------|
| W3C Context URIs | 10 | `MAX_W3C_CONTEXT_URIS` |
| W3C Context Length | 256 bytes | `MAX_W3C_CONTEXT_LEN` |
| W3C Type Assertions | 10 | `MAX_W3C_TYPES` |
| W3C Type Length | 128 bytes | `MAX_W3C_TYPE_LEN` |
| Verifier DID Length | 256 bytes | `MAX_VERIFIER_DID_LEN` |
| Challenge Length | 256 bytes | `MAX_CHALLENGE_LEN` |
| Domain Length | 256 bytes | `MAX_DOMAIN_LEN` |
| Presentation Size | 50 credentials | `MAX_PRESENTATION_SIZE` |

## Data Model

### VerifiablePresentation Structure

```rust
pub struct VerifiablePresentation {
    pub id: BytesN<32>,
    pub holder: Address,
    pub credential_ids: Vec<BytesN<32>>,
    pub field_filters: Vec<FieldFilter>,
    pub challenge: Bytes,
    pub domain: Bytes,
    pub created_at: u64,
    pub expires_at: u64,
    pub proof: PresentationProof,
    pub template_id: Option<BytesN<32>>,
    pub w3c_context: Vec<Bytes>,
    pub w3c_type: Vec<Bytes>,
    pub verifier: Option<Bytes>,
}
```

### TypeScript Interface

```typescript
interface VerifiablePresentation {
  '@context': string[];
  type: string[];
  id: string;
  holder?: string;
  verifiableCredential: VerifiableCredentialSubset[];
  proof?: PresentationProof;
  created: number;
  challenge?: string;
  expiresAt?: number;
  verifierDid?: string;
}
```

## Error Codes

New error codes added for W3C VP validation:

| Error | Code | Description |
|-------|------|-------------|
| `PresentationChallengeTooLong` | 74 | Challenge exceeds 256 bytes |
| `PresentationDomainTooLong` | 75 | Domain exceeds 256 bytes |
| `W3cContextRequired` | 76 | At least one context URI is required |
| `TooManyW3cContexts` | 77 | More than 10 context URIs provided |
| `InvalidW3cContext` | 78 | Context URI is empty or too long |
| `W3cTypeRequired` | 79 | At least one type assertion is required |
| `TooManyW3cTypes` | 80 | More than 10 type assertions provided |
| `InvalidW3cType` | 81 | Type assertion is empty or too long |
| `InvalidVerifierDid` | 82 | Verifier DID is empty or too long |
| `PresentationTooLarge` | 83 | More than 50 credentials in presentation |
| `InvalidTemplateName` | 84 | Template name is empty or too long |
| `PresentationChallengeMismatch` | 85 | Challenge doesn't match expected value |
| `PresentationDomainMismatch` | 86 | Domain doesn't match expected value |

## Use Cases

### 1. Multi-Credential Verification

Present multiple credentials to prove various aspects of identity:

```typescript
// Employment + Education + KYC verification
const employmentCred = await credClient.getCredential(issuer1, empId);
const educationCred = await credClient.getCredential(issuer2, eduId);
const kycCred = await credClient.getCredential(issuer3, kycId);

// Bundle them into one presentation
const vp = createCombinedPresentation([
  employmentCred,
  educationCred,
  kycCred
], holderAddress);
```

### 2. Verifier-Specific Presentations

Create a presentation bound to a specific verifier:

```typescript
const vp = await presentationClient.createPresentation(
  credential,
  ['name', 'dateOfBirth'],
  holderAddress,
  proofInput,
  {
    verifierDid: 'did:stellar:SPECIFIC_VERIFIER',
    challenge: verifierNonce
  }
);
```

### 3. Custom Context Presentations

Use custom JSON-LD contexts for domain-specific credentials:

```typescript
const vp = await presentationClient.createPresentation(
  credential,
  ['medicalLicense', 'specialty'],
  holderAddress,
  proofInput,
  {
    w3cContext: [
      'https://www.w3.org/ns/credentials/v2',
      'https://example.org/contexts/medical/v1'
    ],
    w3cType: ['VerifiablePresentation', 'MedicalPresentation']
  }
);
```

## Standards Compliance

This implementation complies with:

- **W3C Verifiable Credentials Data Model 2.0** - Core data model
- **W3C DID Core Specification** - Decentralized identifiers
- **JSON-LD 1.1** - Linked data contexts
- **Data Integrity Proofs** - Cryptographic proof format

## Migration Guide

### From Legacy Presentations

If you're using the previous presentation system:

```typescript
// Old way (still supported)
const oldVp = {
  credentials: [cred1, cred2],
  holder: address
};

// New W3C way (recommended)
const newVp = await presentationClient.createPresentation(
  credential,
  fields,
  holderAddress,
  proofInput,
  {
    w3cContext: ['https://www.w3.org/ns/credentials/v2'],
    w3cType: ['VerifiablePresentation']
  }
);
```

### Updating Verification Logic

```typescript
// Old way
if (presentation.valid) { /* ... */ }

// New W3C way
const result = presentationClient.verifyPresentation(vp, {
  challenge: expectedChallenge
});

if (result.valid) {
  // Presentation structure is valid
  // Now verify each credential on-chain
}
```

## Security Considerations

1. **Challenge Binding**: Always use a fresh, random challenge from the verifier
2. **Expiry Times**: Set appropriate expiry times for presentations
3. **Selective Disclosure**: Only disclose the minimum required claims
4. **Verifier Binding**: Use `verifierDid` for sensitive presentations
5. **Proof Verification**: Never skip proof verification in production

## Future Enhancements

- Zero-knowledge proof integration for advanced selective disclosure
- Credential schemas for typed presentations
- Presentation templates for reusable patterns
- Cross-chain presentation verification
- BBS+ signatures for unlinkable presentations

## References

- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C DID Core Specification](https://www.w3.org/TR/did-core/)
- [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/)
- [Data Integrity Proofs](https://www.w3.org/TR/vc-data-integrity/)

## Support

For questions or issues related to W3C Verifiable Presentations:

- GitHub Issues: [soroban-identity/issues](https://github.com/your-org/soroban-identity/issues)
- Documentation: [docs/W3C_VERIFIABLE_PRESENTATIONS.md](./W3C_VERIFIABLE_PRESENTATIONS.md)
- Discord: [Join our community](#)
