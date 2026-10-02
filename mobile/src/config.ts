import { TESTNET_CONFIG, type SorobanIdentityConfig } from '@soroban-identity/sdk';

export const WALLETCONNECT_PROJECT_ID = process.env.EXPO_PUBLIC_WC_PROJECT_ID ?? '';
export const STELLAR_CHAIN = 'stellar:testnet';

export const SDK_CONFIG: SorobanIdentityConfig = {
  ...TESTNET_CONFIG,
  identityRegistryId: process.env.EXPO_PUBLIC_IDENTITY_REGISTRY_ID ?? '',
  credentialManagerId: process.env.EXPO_PUBLIC_CREDENTIAL_MANAGER_ID ?? '',
  reputationId: process.env.EXPO_PUBLIC_REPUTATION_ID ?? '',
};
