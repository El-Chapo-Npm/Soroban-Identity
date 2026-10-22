/**
 * Browser Extension Types (#1037)
 * Defines data structures for extension messaging, local credential storage,
 * autofill mapping, and web app synchronization.
 */

export interface ExtensionCredential {
  id: string;
  issuer: string;
  subject: string;
  credentialType: string;
  issuedAt: number;
  expiresAt: number;
  claims: Record<string, string>;
  status: 'valid' | 'revoked' | 'expired';
  verified?: boolean;
  verifiedAt?: number;
}

export type ExtensionMessageType =
  | 'PING'
  | 'PONG'
  | 'SYNC_CREDENTIALS'
  | 'GET_CREDENTIALS'
  | 'GET_EXPIRING_CREDENTIALS'
  | 'VERIFY_CREDENTIAL'
  | 'AUTOFILL_FORM'
  | 'SHOW_VERIFICATION_RESULT';

export interface ExtensionMessage<T = unknown> {
  type: ExtensionMessageType;
  payload?: T;
  source?: 'soroban-identity-page' | 'soroban-identity-extension';
}

export interface SyncCredentialsPayload {
  credentials: ExtensionCredential[];
  appOrigin: string;
  syncedAt: number;
}

export interface AutofillFieldMapping {
  credentialId?: string;
  holderDid?: string;
  issuerDid?: string;
  verificationLevel?: string;
  claims?: Record<string, string>;
}

export interface VerificationResultPayload {
  credentialId: string;
  isValid: boolean;
  issuer?: string;
  subject?: string;
  error?: string;
  checkedAt: number;
}
