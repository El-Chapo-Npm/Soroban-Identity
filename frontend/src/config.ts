import { getNetworkConfig } from './network';

const REQUIRED_VARS: Record<string, string | undefined> = {
  VITE_SERVER_URL: import.meta.env.VITE_SERVER_URL,
  VITE_NETWORK_PASSPHRASE: import.meta.env.VITE_NETWORK_PASSPHRASE,
  VITE_CONTRACT_ID: import.meta.env.VITE_CONTRACT_ID,
};

const missing = Object.entries(REQUIRED_VARS)
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missing.join(', ')}. ` +
      'Check frontend/.env.example for the full list of required variables.'
  );
}

// Feature flag for the guided onboarding tour. Enabled by default unless
// explicitly disabled via VITE_TOUR_ENABLED ("false"/"0"/"off").
export const TOUR_ENABLED: boolean = (() => {
  const raw = import.meta.env.VITE_TOUR_ENABLED;
  if (raw === undefined || raw === '') return true;
  return !['false', '0', 'off', 'no'].includes(String(raw).toLowerCase());
})();

export type SearchProvider = 'local' | 'algolia' | 'elasticsearch';

// Search configuration. Defaults to local search when no provider is set.
// Algolia requires VITE_ALGOLIA_APP_ID and VITE_ALGOLIA_SEARCH_KEY.
// Elasticsearch requires VITE_ELASTICSEARCH_URL.
export interface SearchConfig {
  provider: SearchProvider;
  algolia: {
    appId: string | undefined;
    searchKey: string | undefined;
  };
  elasticsearch: {
    url: string | undefined;
  };
}

function resolveSearchProvider(): SearchProvider {
  const raw = import.meta.env.VITE_SEARCH_PROVIDER;
  if (raw === undefined || raw === '') return 'local';
  const normalized = String(raw).toLowerCase();
  if (normalized === 'algolia' || normalized === 'elasticsearch') {
    return normalized;
  }
  return 'local';
}

export const SEARCH_CONFIG: SearchConfig = {
  provider: resolveSearchProvider(),
  algolia: {
    appId: import.meta.env.VITE_ALGOLIA_APP_ID || undefined,
    searchKey: import.meta.env.VITE_ALGOLIA_SEARCH_KEY || undefined,
  },
  elasticsearch: {
    url: import.meta.env.VITE_ELASTICSEARCH_URL || undefined,
  },
};

// Collaboration configuration. Collaboration is disabled when no WebSocket
// URL is provided via VITE_COLLAB_WS_URL.
export interface CollaborationConfig {
  enabled: boolean;
  wsUrl: string | undefined;
}

export const COLLAB_CONFIG: CollaborationConfig = (() => {
  const wsUrl = import.meta.env.VITE_COLLAB_WS_URL || undefined;
  return {
    enabled: Boolean(wsUrl),
    wsUrl,
  };
})();

// Credential privacy configuration. Visibility controls who can see a
// credential; attribute policies control which attributes are disclosed.
export type CredentialVisibility = 'public' | 'private' | 'custom';

export type AttributeDisclosure = 'visible' | 'hidden' | 'redacted';

export interface AttributePolicy {
  attribute: string;
  disclosure: AttributeDisclosure;
}

export interface PrivacyPolicyTemplate {
  id: string;
  name: string;
  description: string;
  visibility: CredentialVisibility;
  // Attribute names that are disclosed under this template. Any attribute on
  // the credential not listed here is hidden.
  disclosedAttributes: string[];
  // Optional default lifetime (in hours) for sharing links created from this
  // template. Undefined means no expiry by default.
  defaultShareExpiryHours?: number;
}

export const PRIVACY_POLICY_TEMPLATES: PrivacyPolicyTemplate[] = [
  {
    id: 'minimal-disclosure',
    name: 'Minimal disclosure',
    description:
      'Reveal only the credential holder name. All other attributes stay hidden.',
    visibility: 'private',
    disclosedAttributes: ['name'],
  },
  {
    id: 'kyc-verifier',
    name: 'KYC verifier',
    description:
      'Share identity and verification attributes with a trusted KYC verifier.',
    visibility: 'custom',
    disclosedAttributes: ['name', 'dateOfBirth', 'nationality', 'verificationLevel'],
    defaultShareExpiryHours: 24,
  },
  {
    id: 'public-profile',
    name: 'Public profile',
    description: 'Make the credential publicly visible with all attributes shown.',
    visibility: 'public',
    disclosedAttributes: ['*'],
  },
];

export interface AppliedPrivacyPolicy {
  visibility: CredentialVisibility;
  attributePolicies: AttributePolicy[];
}

// Resolves a template against a credential's attribute names, producing the
// visibility and per-attribute disclosure policies consumed by the UI.
export function applyTemplate(
  template: PrivacyPolicyTemplate,
  credential: { attributes: Record<string, unknown> | string[] }
): AppliedPrivacyPolicy {
  const attributeNames = Array.isArray(credential.attributes)
    ? credential.attributes
    : Object.keys(credential.attributes);

  const discloseAll = template.disclosedAttributes.includes('*');
  const disclosed = new Set(template.disclosedAttributes);

  const attributePolicies: AttributePolicy[] = attributeNames.map((attribute) => ({
    attribute,
    disclosure: discloseAll || disclosed.has(attribute) ? 'visible' : 'hidden',
  }));

  return {
    visibility: template.visibility,
    attributePolicies,
  };
}

// Returns config for the active network, resolved from VITE_NETWORK / VITE_*_RPC_URL
// / VITE_*_IDENTITY_REGISTRY_ID env vars defined in .env.example.
export function getAppConfig() {
  return {
    ...getNetworkConfig(),
    tourEnabled: TOUR_ENABLED,
    search: SEARCH_CONFIG,
    collaboration: COLLAB_CONFIG,
    privacyPolicyTemplates: PRIVACY_POLICY_TEMPLATES,
  };
}