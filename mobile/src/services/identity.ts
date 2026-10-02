import { CredentialClient, IdentityClient } from '@soroban-identity/sdk';
import { SDK_CONFIG } from '../config';
import { cached } from './offline';

export const identity = new IdentityClient(SDK_CONFIG);
export const credentials = new CredentialClient(SDK_CONFIG);

export const loadDid = (address: string) => cached(`did:${address}`, () => identity.resolveDid(address));
export const loadCredentials = (address: string) =>
  cached(`creds:${address}`, () => credentials.getCredentialsBySubject(address, address));
