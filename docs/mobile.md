# React Native mobile app

> **Issue:** [MOBILE-01 #940](https://github.com/El-Chapo-Npm/Soroban-Identity/issues/940)  
> **Scope:** `mobile/`  
> **Assignees:** jattauti, timothy-droid  
> **Labels:** Stellar Wave, feature, mobile

Native iOS and Android app for Soroban Identity. The app lets users manage their DIDs, hold and present verifiable credentials, and connect via their Stellar wallet — all from a mobile device with biometric authentication and offline support.

---

## Project structure

```
mobile/
├── android/                  # Android-specific native code and Gradle config
├── ios/                      # iOS-specific native code and Xcode project
├── src/
│   ├── components/           # Shared UI components
│   ├── navigation/           # React Navigation stack and tab definitions
│   ├── screens/
│   │   ├── wallet/           # Wallet connection and account screens
│   │   ├── did/              # DID management screens
│   │   └── credentials/      # Credential viewer and QR scanner screens
│   ├── services/
│   │   ├── wallet.ts         # WalletConnect integration
│   │   ├── did.ts            # DID operations via the SDK
│   │   ├── credentials.ts    # Credential storage and presentation
│   │   └── biometrics.ts     # Biometric auth helpers
│   ├── store/                # State management (Redux Toolkit or Zustand)
│   ├── offline/              # Offline queue and sync logic
│   └── types/                # Shared TypeScript types
├── __tests__/                # Jest + React Native Testing Library tests
├── app.json
├── babel.config.js
├── tsconfig.json
└── package.json
```

---

## Tech stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Framework | React Native with TypeScript | Strict mode enabled |
| Wallet connection | WalletConnect v2 | `@walletconnect/sign-client` |
| Navigation | React Navigation v6 | Native stack + bottom tabs |
| Biometrics | `react-native-biometrics` | Face ID, Touch ID, Android fingerprint |
| Credential storage | Keychain / Keystore | Encrypted at rest via `react-native-keychain` |
| QR scanning | `react-native-vision-camera` | Credential presentation scanning |
| Offline sync | Custom queue in AsyncStorage | Syncs to server when connectivity is restored |
| State | Redux Toolkit | Persisted slices for wallet and credentials |
| Testing | Jest + RNTL | Unit and component tests |

---

## Setup

### Prerequisites

- Node.js 20+
- Ruby 3.2+ (for iOS CocoaPods)
- Xcode 15+ with iOS 16 simulator (macOS only for iOS builds)
- Android Studio with SDK 34 and an emulator or physical device
- [WalletConnect project ID](https://cloud.walletconnect.com/) — create a free project and copy the ID

### Install dependencies

```bash
cd mobile
npm install
```

For iOS:

```bash
cd ios && bundle exec pod install && cd ..
```

### Environment

Copy the example env file and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `WALLETCONNECT_PROJECT_ID` | WalletConnect Cloud project ID |
| `SOROBAN_IDENTITY_API_URL` | Base URL of the Soroban Identity server |
| `SOROBAN_IDENTITY_NETWORK` | `testnet` or `mainnet` |
| `IDENTITY_REGISTRY_CONTRACT` | On-chain identity registry contract address |
| `CREDENTIAL_MANAGER_CONTRACT` | On-chain credential manager contract address |

### Run on a simulator or device

```bash
# iOS
npm run ios

# Android
npm run android
```

---

## Features

### Wallet connection via WalletConnect

Users connect their Stellar wallet (Freighter, Lobstr, or any WalletConnect-compatible wallet) from the wallet screen. The app requests the `stellar_signTransaction` and `stellar_signMessage` capabilities. Session state is persisted across app restarts.

Connection flow:

1. User taps **Connect wallet** on the wallet screen.
2. App generates a WalletConnect URI and displays it as a QR code or deep link.
3. User approves the session in their wallet app.
4. App stores the session and derives the Stellar account address.
5. Wallet screen shows account address, XLM balance, and linked DIDs.

### DID management screens

| Screen | Description |
|--------|-------------|
| DID list | Shows all DIDs owned by the connected wallet address |
| DID detail | Full DID document, verification methods, and service endpoints |
| Create DID | Form to register a new `did:stellar:` DID on-chain |
| Edit DID | Update verification methods or service endpoints |
| Deactivate DID | Confirmation flow to deactivate a DID |

DID operations call the `@soroban-identity/sdk` through a native module bridge or directly via the REST API depending on network availability.

### Credential viewer and scanner

**Viewer:**  
Credentials are listed by type and issuer. Tapping a credential shows the full claim set, issuance date, expiry, and revocation status (fetched from the revocation registry on open). Expired or revoked credentials are badged accordingly.

**Scanner:**  
A full-screen camera view uses `react-native-vision-camera` to scan a verifier's QR code containing a presentation request. The app parses the request, finds matching credentials in the local store, and prompts the user to approve the presentation. The signed presentation is returned to the verifier via deep link or WalletConnect message.

### Biometric authentication

All sensitive operations (opening the credential store, signing a transaction, approving a presentation) require biometric verification. The app uses `react-native-biometrics` to invoke Face ID, Touch ID, or Android Biometric Prompt.

Fallback: if biometrics are unavailable or disabled, the app prompts for a 6-digit PIN. The PIN is stored in the system keychain, not in AsyncStorage.

Biometric auth gates:

- App foreground after background/lock
- Viewing full credential claims
- Approving a credential presentation
- Signing a DID transaction

### Offline mode

The app is fully usable without an internet connection for credential viewing and presentation. Writes (DID registration, credential issuance) are queued and synced automatically when connectivity is restored.

Offline behaviour:

| Action | Offline behaviour |
|--------|------------------|
| View credentials | Served from encrypted local store |
| Verify a credential | Uses cached revocation status (up to 24 h old) |
| Present a credential | Signed locally; presentation log synced when online |
| Register a DID | Queued; user is notified of pending status |
| Issue a credential | Queued; user is notified of pending status |

The sync queue is stored in AsyncStorage under a namespace prefix and processed in order on reconnect. Failed queue items are retried with exponential back-off (max 5 attempts) before surfacing an error to the user.

---

## WalletConnect integration details

The app uses WalletConnect Sign Client v2. Session management:

```ts
import { SignClient } from '@walletconnect/sign-client'

const client = await SignClient.init({
  projectId: process.env.WALLETCONNECT_PROJECT_ID,
  metadata: {
    name: 'Soroban Identity',
    description: 'Decentralised identity on Stellar',
    url: 'https://soroban-identity.dev',
    icons: ['https://soroban-identity.dev/icon.png'],
  },
})
```

Requested namespaces follow the Stellar CAIP-2 chain format (`stellar:testnet` / `stellar:mainnet`). The app requests the minimum required methods and does not request event subscriptions it does not handle.

---

## Beta testing

Beta builds are distributed via:

- **iOS:** TestFlight — invite testers through App Store Connect
- **Android:** Google Play Internal Testing track or direct APK via Firebase App Distribution

Before a beta release:

- [ ] All `DoD` items in [issue #940](https://github.com/El-Chapo-Npm/Soroban-Identity/issues/940) are checked off
- [ ] No open `blocker` or `critical` issues against `mobile/`
- [ ] Smoke-tested on a physical iPhone (latest iOS) and a physical Android device (Android 13+)
- [ ] Biometric auth tested on both platforms
- [ ] Offline mode tested by disabling Wi-Fi and mobile data
- [ ] WalletConnect session tested with Freighter and at least one additional wallet
- [ ] Accessibility audit passed (VoiceOver on iOS, TalkBack on Android)
- [ ] Privacy manifest updated (iOS 17+ requirement)

---

## Accessibility

The app targets WCAG 2.1 AA. Key requirements:

- All interactive elements have accessible labels (`accessibilityLabel` / `accessibilityHint`)
- QR scanner provides an accessible alternative (paste credential JSON)
- Biometric prompt has a keyboard-accessible fallback
- Minimum tap target size: 44×44 pt
- Dynamic Type supported — layouts must not clip at larger text sizes
- Full VoiceOver and TalkBack navigation tested before each release

---

## Related

- [Getting started](./getting-started.md)
- [Tutorial 2 — DID management](./tutorials/02-did-management.md)
- [Tutorial 3 — Credential lifecycle](./tutorials/03-credential-lifecycle.md)
- [OAuth2](./oauth2.md)
- [API server](./api-server.md)
- [Accessibility](./accessibility.md)
