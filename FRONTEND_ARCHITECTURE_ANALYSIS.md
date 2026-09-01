# Frontend Architecture Overview: Soroban Identity

## Directory Structure

```
frontend/
├── src/
│   ├── components/           # React components
│   ├── context/              # Context API providers
│   ├── hooks/                # Custom React hooks
│   ├── locales/              # i18n translation files
│   ├── store/                # State management
│   ├── types/                # TypeScript type definitions
│   ├── utils/                # Utility functions
│   ├── App.tsx               # Main app component
│   ├── main.tsx              # Entry point
│   ├── index.css             # Global styles
│   ├── i18n.ts               # i18n configuration
│   ├── network.ts            # Network configuration
│   └── config.ts             # App configuration
├── public/                   # Static assets
├── vite.config.ts            # Vite build configuration
├── tsconfig.json             # TypeScript config
└── package.json              # Dependencies
```

---

## 1. COMPONENT STRUCTURE

### Key Components (`src/components/`)

#### **CredentialsPanel.tsx** (Primary Focus)
The most complex component with extensive credential management features:

**Existing Functionality:**
- ✅ **Filtering & Sorting**
  - Type filter: "All", "Kyc", "Reputation", "Achievement", "Custom"
  - Expiry filter: "All", "Active", "Expired"
  - Dynamic badge counts for each filter option
  - Status-based sorting (Active → Expired → Revoked)
  
- ✅ **Search & Query**
  - Search credentials by subject address (Stellar address validation)
  - Auto-refresh every 30 seconds for status changes
  - Pagination with configurable page size (10, 25, 50, 100)
  - URL state persistence (page and pageSize as query params)

- ✅ **Credential Display**
  - Expandable credential items with full details
  - Claims display as key-value pairs
  - Issuance and expiry timestamps with relative formatting
  - Status badges (Active/Expired/Revoked) with color coding
  - Share link generation (copy to clipboard with deep link)

- ✅ **Verification**
  - Verify individual credentials by ID
  - Auto-refresh verification status every 30 seconds
  - Deep link support for direct credential verification
  - Detailed verification states: valid, not_found, revoked, expired, invalid, unknown

- ✅ **Issuer Controls** (if user is registered issuer)
  - Issue new credentials
  - Subject address validation (Stellar format)
  - Dynamic claims input (add/remove pairs)
  - Expiry date validation
  - Form error handling and validation

- ❌ **No Credential Export** (Gap to implement)
  - No JSON export functionality
  - No bulk export options
  - No file download capabilities

- ❌ **No Drag-and-Drop Import** (Gap to implement)
  - No file upload interface
  - No drag-and-drop zone

- ❌ **No PWA Features** (Gap to implement)
  - No service worker
  - No offline support
  - No manifest.json

#### **IdentityPanel.tsx**
Manages DID (Decentralized Identity) operations:
- Display DID document and metadata
- Reputation scores and history visualization
- Metadata key-value management
- DID creation/update/deactivation
- **Has export**: `exportDidDocumentAsJsonLd()` used for DID export

#### **IdentityPanel.tsx**
- QR code generation for DID sharing
- Theme provider and wallet buttons

#### **Other Components**
- `WalletButton.tsx` - Wallet connection UI
- `ErrorBoundary.tsx` - Error handling wrapper
- `FormField.tsx` - Reusable form field component
- `SkeletonCard.tsx` - Loading state UI
- `Toast.tsx` - Toast notifications
- `LoadingFallback.tsx` - Lazy loading fallback
- `ReputationChart.tsx` - Chart visualization using Recharts
- `DidQrCode.tsx` - QR code component

---

## 2. STATE MANAGEMENT

### Store (`src/store/walletStore.ts`)
Simple pub-sub pattern for wallet state:
```typescript
- getAddress()           // Get current wallet address
- subscribe(fn)          // Subscribe to address changes
- connect()              // Connect to wallet
- disconnect()           // Disconnect wallet
```

**Persistence:**
- Uses `sessionStorage` with key `"soroban_identity_wallet"`
- Auto-rehydrates on page reload
- Tab-scoped (doesn't persist across tabs)

### Context API Providers (`src/context/`)

#### **WalletContext.tsx**
Composes all wallet-related state:
```typescript
interface WalletContextValue extends WalletState {
  publicKey: string | null
  connected: boolean
  networkPassphrase: string
  walletType: "freighter" | "walletconnect"
  connect(walletType?: string): void
  disconnect(): void
  signTransaction(xdr: string): Promise<string>
  retry(): Promise<void>
  isConnecting: boolean
  connectionError: WalletConnectionError | string | null
}
```

#### **ThemeContext.tsx**
Manages theme state (light/dark mode):
- Persisted in localStorage with key `'theme-preference'`
- Options: 'system', 'light', 'dark'
- CSS media query fallback for system preference

#### **ToastContext.tsx**
Toast notification system:
- `success(message)`, `error(message)`, `info(message)`
- Used throughout for feedback

---

## 3. HOOKS FOR DATA FETCHING & MANAGEMENT

### Custom Hooks (`src/hooks/`)

#### **useWallet.ts** (Composed)
Combines all wallet-related hooks:
```typescript
- useWalletState()         // Raw state atom
- useWalletConnection()    // Connect/disconnect/retry/reconnect
- useFreighterAccountSync()// Detect mid-session account switches
- useWalletSigning()       // XDR transaction signing
```

#### **useWalletConnection.ts**
Handles wallet connection lifecycle:
- Auto-reconnect on page reload
- Connection timeout (15 seconds)
- Retry logic with exponential backoff
- Freighter and WalletConnect support

#### **useWalletState.ts**
Raw wallet state management:
```typescript
interface WalletState {
  publicKey: string | null
  connected: boolean
  reconnecting: boolean
  networkPassphrase: string
  connecting: boolean
  txLoading: boolean
  walletType: WalletType | null
  error: string | null
  retryCount: number
}
```

#### **useContractEvents.ts**
Streams contract events from API:
```typescript
interface StreamedContractEvent {
  id: string
  type: string
  contractId: string
  topic: string[]
  value: unknown
  ledger: number
  txHash: string
  timestamp: string
}

useContractEvents(filter?: ContractEventFilter)
// Returns: { events, connected, error }
```
- Uses EventSource for SSE (Server-Sent Events)
- Max 200 events in memory
- Reconnects on disconnect

#### **useCredentialExpiryCheck.ts**
Monitors credential expiry status:
- Tracks which credentials are about to expire
- Can trigger alerts before expiration

#### **useFreighterAccountSync.ts**
Detects mid-session Freighter account switches

#### **useWalletSigning.ts**
Handles XDR transaction signing

#### **useTheme.ts**
Manages theme cycling and preferences

#### **useAddressHistory.ts**
Tracks address search history

---

## 4. TYPE DEFINITIONS

### From SDK (`sdk/src/types.ts`)

```typescript
// Credential Types
type CredentialType = "Kyc" | "Reputation" | "Achievement" | "Custom"

interface Credential {
  id: string                              // hex-encoded 32-byte hash
  subject: string                         // Recipient's Stellar address
  issuer: string                          // Issuer's Stellar address
  credentialType: CredentialType
  claims: Record<string, string>          // Key-value pairs
  claimsHash: string                      // SHA-256 hash (hex)
  signature: string                       // Issuer's signature (hex)
  issuedAt: number                        // Unix timestamp (seconds)
  expiresAt: number                       // Unix timestamp (0 = no expiry)
  revoked: boolean
}

interface RevokedCredential extends Credential {
  revokedAt: string                       // ISO-8601 timestamp
  status: 'revoked'
}

type VerifyFailReason = 
  | 'not_found' | 'revoked' | 'expired' 
  | 'unknown' | 'INVALID_SIGNATURE' 
  | 'UNKNOWN_ISSUER' | 'INACTIVE_SUBJECT'

interface VerifyResult {
  valid: boolean
  reason?: VerifyFailReason
}

// DID Document
interface DidDocument {
  id: string                              // Format: "did:stellar:<address>"
  controller: string                      // Stellar address with authority
  metadata: Record<string, string>        // Arbitrary key-value map
  createdAt: number                       // Unix timestamp
  updatedAt: number                       // Unix timestamp
  active: boolean                         // Deactivation flag
  services: ServiceEndpoint[]             // W3C DID Core endpoints
}

interface ServiceEndpoint {
  id: string                              // URI identifier
  type_: string                           // Service type
  service_endpoint: string                // Service URL/URI
}

// Reputation
interface ReputationRecord {
  subject: string
  score: number
  reporterCount: number
  updatedAt: number
}

interface ScoreHistoryEntry {
  reporter: string
  delta: number
  reason: string
  submittedAt: number
}
```

---

## 5. SERVICE WORKER & PWA SETUP

### Current Status: **NOT IMPLEMENTED**

**What Exists:**
- Vite manifest: `build.manifest: true` in `vite.config.ts`
- Asset compression scripts
- No service worker file
- No `manifest.json` for PWA
- No offline capabilities
- No cache strategies

**What's Missing:**
- Service worker registration
- Workbox or custom SW implementation
- PWA manifest file
- Cache strategies for:
  - API responses
  - Static assets
  - Credential data
- Offline-first functionality
- Install prompt handling
- Background sync (for offline changes)

---

## 6. UTILITIES & HELPERS

### Formatting Utilities (`src/utils/`)

```typescript
formatDate(value: string | number): string
// Formats date as "Month Day, Year" (e.g., "January 15, 2024")

formatTimestamp(unix: number): string
// Full timestamp with time and timezone
// Returns "No expiry" for 0

getExpiryStyle(unix: number): React.CSSProperties
// Returns CSS styles based on expiry:
// - var(--text-muted) for no expiry or far future
// - var(--warning) + bold for < 7 days
// - var(--text-muted) otherwise
```

### Error Handling (`src/utils/handleError.ts`)
```typescript
handleError(e: unknown): string          // Converts errors to user messages
isNetworkError(e: unknown): boolean      // Identifies network errors
```

### Address Formatting (`src/utils/formatAddress.ts`)
```typescript
formatAddress(address: string): string   // Formats Stellar addresses
```

### SDK Utilities
```typescript
exportDidDocumentAsJsonLd(did: DidDocument)
// Already used in IdentityPanel for DID export
validateStellarAddress(address: string): boolean
```

---

## 7. DEPENDENCIES & BUILD CONFIG

### Key Dependencies
```json
{
  "@soroban-identity/sdk": "^0.1.0",    // Contract client library
  "@stellar/stellar-sdk": "^12.0.0",    // Stellar blockchain SDK
  "@creit.tech/stellar-wallets-kit": "^0.9.2",  // Wallet integration
  "@walletconnect/sign-client": "^2.17.0",      // WalletConnect support
  "react": "^18.3.0",
  "react-dom": "^18.3.0",
  "react-i18next": "^17.0.4",            // Internationalization
  "recharts": "^3.8.1",                  // Charts library
  "qrcode.react": "^4.2.0"              // QR code generation
}
```

### Build Configuration
**Vite Config Features:**
- React plugin with Fast Refresh
- Bundle splitting: react, i18n, stellar, wallet, charts
- Manifest generation
- Asset compression
- Bundle budget checking
- CSP header injection
- Development/preview security headers

**Build Process:**
1. Convert images to WebP
2. TypeScript type checking
3. Vite build with code splitting
4. Asset compression
5. Bundle budget validation

---

## 8. INTERNATIONALIZATION (i18n)

**Setup:**
- Framework: i18next + react-i18next
- Languages: English (en), Spanish (es)
- Locales: `src/locales/{en,es}.json`
- Storage: localStorage key `'lang'`
- Fallback: English

**Usage:**
```typescript
const { t, i18n } = useTranslation()
setLocale('es')  // Change language
```

---

## 9. NETWORK CONFIGURATION

**File:** `src/network.ts`

Manages network switching (Testnet/Mainnet):
- RPC endpoints
- Network passphrases
- Contract IDs
- Chain parameters

**Currently used in:**
- Wallet connection
- Credential client initialization
- Identity client initialization

---

## 10. STYLING ARCHITECTURE

### CSS Custom Properties (Variables)
**Light Mode Defaults:**
- Colors: accent (#7c3aed), text (#0f172a), text-muted (#64748b)
- Backgrounds: bg (#f8fafc), card (#ffffff), card-accent (#ede9fe)
- Borders: card (#e2e8f0), input (#cbd5e1)
- Status colors: green, red, yellow, gray, purple badges
- Sybil scores: pass/fail styling

**Dark Mode:**
- Automatically applied via `@media (prefers-color-scheme: dark)`
- Override with `.light` or `.dark` classes on `<html>`
- Data attribute: `data-theme` on `<html>`

**Component-Level Styling:**
- Inline styles for layout and spacing
- CSS modules: `Toast.module.css`
- Global CSS: `index.css`
- No Tailwind or CSS-in-JS framework

---

## 11. FEATURE IMPLEMENTATION ROADMAP

### Feature 1: Credential Filtering & Sorting ✅
**Status:** Already implemented in CredentialsPanel
- Multi-filter UI with badge counts
- Sort by status
- URL state persistence
- No additional work needed

### Feature 2: Drag-and-Drop Credential Import ❌
**Status:** Not started
**Implementation Points:**
- New component: `CredentialImport.tsx` with drag-drop zone
- File validation (JSON format)
- Parse credentials from file
- Call SDK method to import/verify
- Error handling and feedback
- Context: Likely in a new "Import" tab or modal

**Expected File Structure:**
```typescript
interface ImportedCredential {
  raw: Credential
  validated: boolean
  errors?: string[]
  importedAt: number
}
```

### Feature 3: PWA Features (Offline Support) ❌
**Status:** Not started
**Implementation Points:**
1. Create service worker (`public/sw.js`)
2. Register in `main.tsx` or separate hook
3. Cache strategies:
   - Network-first for APIs
   - Cache-first for static assets
   - Stale-while-revalidate for credentials
4. Manifest file (`public/manifest.json`)
5. Offline UI indicators
6. Background sync for pending operations

**Files to Create:**
```
frontend/
├── public/
│   ├── manifest.json      # PWA manifest
│   ├── sw.js              # Service worker
│   └── icons/             # App icons (192x192, 512x512)
├── src/
│   └── hooks/
│       └── useServiceWorker.ts  # Registration & lifecycle
```

### Feature 4: Credential Export to JSON ❌
**Status:** Not started
**Implementation Points:**
- Add export button to credential items
- Export single credential as JSON
- Bulk export all visible credentials
- File naming: `credential-{id}-{date}.json` or similar
- CSV export option for spreadsheet analysis
- Function location: `src/utils/exportCredentials.ts`

**Example Export Format:**
```json
{
  "credentials": [
    {
      "id": "abc123...",
      "subject": "GXXX...",
      "issuer": "GYYY...",
      "credentialType": "Kyc",
      "claims": {...},
      "issuedAt": 1234567890,
      "expiresAt": 1234567890,
      "revoked": false,
      "exportedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "exportedAt": "2024-01-15T10:30:00Z",
  "count": 5
}
```

---

## 12. QUICK REFERENCE: KEY FILES FOR FEATURE WORK

| Feature | Primary Files |
|---------|---------------|
| Filtering/Sorting | `src/components/CredentialsPanel.tsx` (lines 100-200) |
| State Management | `src/store/walletStore.ts`, `src/context/WalletContext.tsx` |
| Data Fetching | `src/hooks/useWallet.ts`, `src/hooks/useContractEvents.ts` |
| Credential Display | `src/components/CredentialsPanel.tsx` (lines 700-900) |
| Type System | `sdk/src/types.ts` |
| Formatting | `src/utils/formatDate.ts`, `src/utils/formatAddress.ts` |
| Error Handling | `src/utils/handleError.ts` |
| Styling | `src/index.css` (CSS variables) |
| i18n | `src/i18n.ts`, `src/locales/` |

---

## 13. TESTING PATTERNS

**Test Files Found:**
- `src/components/*.test.tsx` - Component tests (React Testing Library)
- `src/hooks/*.test.ts` - Hook tests
- `src/utils/*.test.ts` - Utility tests
- `a11y.test.tsx`, `App.a11y.test.tsx` - Accessibility tests using axe-core

**Test Framework:**
- Vitest for unit tests
- React Testing Library for component tests
- vitest-axe for accessibility testing
- jsdom for DOM environment

---

## 14. ACCESSIBILITY & BEST PRACTICES

**Current Implementation:**
- Semantic HTML (aria-labels, aria-live, roles)
- Color contrast via CSS variables
- Keyboard navigation support
- Form validation with error messages
- Status badges with aria-pressed
- Accessibility testing in CI

**Examples in Code:**
- `aria-live="polite"` for dynamic updates
- `aria-label` on buttons and inputs
- `role="status"` for status messages
- Proper form field associations

---

## Summary

The frontend is a **React 18 + TypeScript SPA** with:
- ✅ Advanced credential filtering & sorting (complete)
- ✅ Pagination with URL state persistence (complete)
- ✅ Wallet integration (Freighter + WalletConnect)
- ✅ Context-based state management
- ✅ i18n support (EN, ES)
- ✅ Dark/light theme switching
- ✅ Accessibility features
- ❌ PWA/Service Worker (needs implementation)
- ❌ Credential export (needs implementation)
- ❌ Drag-and-drop import (needs implementation)

**Ready for:** Feature implementation on import/export and PWA functionality with clear integration points established.
