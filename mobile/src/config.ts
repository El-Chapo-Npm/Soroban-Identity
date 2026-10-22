import { TESTNET_CONFIG, type SorobanIdentityConfig } from '@soroban-identity/sdk';

export const WALLETCONNECT_PROJECT_ID = process.env.EXPO_PUBLIC_WC_PROJECT_ID ?? '';
export const STELLAR_CHAIN = 'stellar:testnet';

export const SDK_CONFIG: SorobanIdentityConfig = {
  ...TESTNET_CONFIG,
  identityRegistryId: process.env.EXPO_PUBLIC_IDENTITY_REGISTRY_ID ?? '',
  credentialManagerId: process.env.EXPO_PUBLIC_CREDENTIAL_MANAGER_ID ?? '',
  reputationId: process.env.EXPO_PUBLIC_REPUTATION_ID ?? '',
};

// ---------------------------------------------------------------------------
// App identity / store identifiers
// ---------------------------------------------------------------------------

export const APP_SCHEME = process.env.EXPO_PUBLIC_APP_SCHEME ?? 'sorobanid';

export const APP_BUNDLE_ID =
  process.env.EXPO_PUBLIC_IOS_BUNDLE_ID ?? 'com.sorobanidentity.wallet';

export const APP_PACKAGE_NAME =
  process.env.EXPO_PUBLIC_ANDROID_PACKAGE ?? 'com.sorobanidentity.wallet';

// Universal links (iOS associated domains) and Android App Links hosts.
export const UNIVERSAL_LINK_HOSTS: string[] = (
  process.env.EXPO_PUBLIC_UNIVERSAL_LINK_HOSTS ?? 'app.soroban-identity.dev'
)
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

export const ASSOCIATED_DOMAINS: string[] = UNIVERSAL_LINK_HOSTS.map(
  (host) => `applinks:${host}`,
);

// ---------------------------------------------------------------------------
// Deep linking configuration (React Navigation)
// ---------------------------------------------------------------------------

export const DEEP_LINK_PREFIXES: string[] = [
  `${APP_SCHEME}://`,
  ...UNIVERSAL_LINK_HOSTS.map((host) => `https://${host}`),
];

export const linking = {
  prefixes: DEEP_LINK_PREFIXES,
  config: {
    screens: {
      Home: {
        path: '',
        screens: {
          Dashboard: 'dashboard',
          Wallet: 'wallet',
          Credentials: 'credentials',
          Reputation: 'reputation',
        },
      },
      Scan: 'scan',
      CredentialDetail: 'credential/:credentialId',
      Verify: 'verify/:requestId?',
      WalletConnect: 'wc',
      Settings: {
        path: 'settings',
        screens: {
          Profile: 'profile',
          Security: 'security',
          Notifications: 'notifications',
        },
      },
      Auth: {
        path: 'auth',
        screens: {
          Login: 'login',
          Biometric: 'biometric',
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Push notifications configuration
// ---------------------------------------------------------------------------

export const PUSH_SERVER_URL =
  process.env.EXPO_PUBLIC_PUSH_SERVER_URL ?? 'https://push.soroban-identity.dev';

export const EAS_PROJECT_ID = process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '';

export const NOTIFICATION_CHANNELS = {
  DEFAULT: 'default',
  CREDENTIALS: 'credentials',
  TRANSACTIONS: 'transactions',
  SECURITY: 'security',
} as const;

export type NotificationChannelId =
  (typeof NOTIFICATION_CHANNELS)[keyof typeof NOTIFICATION_CHANNELS];

export interface NotificationChannelConfig {
  id: NotificationChannelId;
  name: string;
  description: string;
  importance: 'min' | 'low' | 'default' | 'high' | 'max';
  sound?: string;
  vibrationPattern?: number[];
  lightColor?: string;
  badge?: boolean;
}

export const NOTIFICATION_CHANNEL_CONFIGS: NotificationChannelConfig[] = [
  {
    id: NOTIFICATION_CHANNELS.DEFAULT,
    name: 'General',
    description: 'General notifications',
    importance: 'default',
    sound: 'default',
    badge: true,
  },
  {
    id: NOTIFICATION_CHANNELS.CREDENTIALS,
    name: 'Credentials',
    description: 'Credential issuance and verification updates',
    importance: 'high',
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#4F46E5',
    badge: true,
  },
  {
    id: NOTIFICATION_CHANNELS.TRANSACTIONS,
    name: 'Transactions',
    description: 'Wallet transaction and payment updates',
    importance: 'high',
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#10B981',
    badge: true,
  },
  {
    id: NOTIFICATION_CHANNELS.SECURITY,
    name: 'Security',
    description: 'Security alerts and authentication events',
    importance: 'max',
    sound: 'default',
    vibrationPattern: [0, 500, 250, 500],
    lightColor: '#EF4444',
    badge: true,
  },
];

export const notificationConfig = {
  pushServerUrl: PUSH_SERVER_URL,
  easProjectId: EAS_PROJECT_ID,
  channels: NOTIFICATION_CHANNEL_CONFIGS,
  defaultChannelId: NOTIFICATION_CHANNELS.DEFAULT,
  // Deep link route used when a notification is tapped without an explicit URL.
  defaultDeepLink: `${APP_SCHEME}://dashboard`,
} as const;