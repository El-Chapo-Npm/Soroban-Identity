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

// Returns config for the active network, resolved from VITE_NETWORK / VITE_*_RPC_URL
// / VITE_*_IDENTITY_REGISTRY_ID env vars defined in .env.example.
export function getAppConfig() {
  return {
    ...getNetworkConfig(),
    tourEnabled: TOUR_ENABLED,
    search: SEARCH_CONFIG,
    collaboration: COLLAB_CONFIG,
  };
}