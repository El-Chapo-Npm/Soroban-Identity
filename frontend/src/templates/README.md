# Credential Template Schema Documentation

This document describes the schema structure for Verifiable Credential templates used in Soroban Identity.

## Template Object Structure

Each template defines a pre-configured schema for issuing verifiable credentials with standard claim keys and validation constraints.

```typescript
export interface CredentialTemplate {
  /** Unique template identifier (e.g., 'template_kyc') */
  id: string;

  /** Display title for the template */
  name: string;

  /** Detailed summary of what the credential proves */
  description: string;

  /** Target Soroban CredentialType: 'Kyc' | 'Reputation' | 'Achievement' | 'Custom' */
  credentialType: CredentialType;

  /** Emoji or icon representing the template */
  icon: string;

  /** Optional flag indicating user-created custom template */
  isCustom?: boolean;

  /** Field specifications for UI input rendering */
  fields: TemplateFieldSchema[];

  /** Standard JSON Schema definition */
  schema: {
    $schema: string;
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      format?: string;
      pattern?: string;
    }>;
    required: string[];
  };
}
```

## Built-in Templates

1. **KYC Identity Verification (`template_kyc`)**
   - Type: `Kyc`
   - Fields: `fullName`, `documentType`, `documentNumber`, `nationality`, `verificationLevel`, `verifiedAt`
   - Required: `fullName`, `documentType`, `documentNumber`, `nationality`

2. **Educational Diploma (`template_diploma`)**
   - Type: `Achievement`
   - Fields: `institutionName`, `degree`, `graduationYear`, `gpaOrGrade`, `major`
   - Required: `institutionName`, `degree`, `graduationYear`, `major`

3. **Proof of Residence (`template_residence`)**
   - Type: `Custom`
   - Fields: `residentName`, `streetAddress`, `city`, `stateOrProvince`, `postalCode`, `country`, `utilityProvider`
   - Required: `residentName`, `streetAddress`, `city`, `postalCode`, `country`

4. **Employment Verification (`template_employment`)**
   - Type: `Custom`
   - Fields: `employeeName`, `employerName`, `jobTitle`, `startDate`, `employmentStatus`, `department`
   - Required: `employeeName`, `employerName`, `jobTitle`, `startDate`

5. **Age Verification (`template_age`)**
   - Type: `Kyc`
   - Fields: `holderName`, `minimumAge`, `isOverThreshold`, `verificationAuthority`
   - Required: `holderName`, `minimumAge`, `isOverThreshold`

## Custom Template Import/Export

Custom templates can be exported as a JSON array and shared across issuers. Custom templates are persisted in the browser's `localStorage` under `soroban_custom_credential_templates`.
