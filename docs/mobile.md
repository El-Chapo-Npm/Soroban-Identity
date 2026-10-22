# React Native mobile app

> **Issue:** [MOBILE-01 #940](https://github.com/El-Chapo-Npm/Soroban-Identity/issues/940)  
> **Scope:** `mobile/`  
> **Assignees:** jattauti, timothy-droid  
> **Labels:** Stellar Wave, feature, mobile

Native iOS and Android app for Soroban Identity. The app lets users manage their DIDs, hold and present verifiable credentials, and connect via their Stellar wallet — all from a mobile device with biometric authentication, push notifications, deep linking, and offline-first support.

---

## Project structure

```
mobile/
├── android/                  # Android-specific native code and Gradle config
├── ios/                      # iOS-specific native code and Xcode project
├── src/
│   ├── components/           # Shared, mobile-optimised UI components
│   ├── navigation/           # React Navigation stack, tab, and linking config
│   │   ├── RootNavigator.tsx # Native stack root
│   │   ├── TabNavigator.tsx  # Bottom tabs (Wallet, DIDs, Credentials, Settings)
│   │   └── linking.ts        # Deep link configuration (universal/app links)
│   ├── screens/
│   │   ├── wallet/           # Wallet connection and account screens
│   │   ├── did/              # DID management screens
│   │   ├── credentials/      # Credential viewer and QR scanner screens
│   │   └── settings/         # Security, devices, and notification settings
│   ├── services/
│   │   ├── wallet.ts         # WalletConnect integration
│   │   ├── did.ts            # DID operations via the SDK
│   │   ├── credentials.ts    # Credential storage and presentation
│   │   ├── biometrics.ts     # Biometric auth helpers
│   │   ├── keychain.ts       # react-native-keychain secure storage wrapper
│   │   ├── notifications.ts  # Push notification registration and handlers
│   │   └── deepLinks.ts      # Deep link parsing and routing helpers
│   ├── store/                # Redux Toolkit store
│   │   ├── index.ts          # configureStore + persistence
│   │   ├── slices/           # wallet, dids, credentials, settings, sync
│   │   └── middleware/       # Offline queue and notification middleware
│   ├── offline/              # Offline queue, sync engine, and connectivity watcher
│   └── types/                # Shared TypeScript types
├── __tests__/                # Jest + React Native Testing Library tests
├── e2e/                      # Detox end-to-end tests
├── fastlane/                 # App Store / Play Store deployment lanes
├── app.json
├── babel.config.js
├── metro.config.js
├── tsconfig.json
└── package.json
```

---

## Tech stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Framework | React Native 0.73+ with TypeScript | Strict mode enabled; New Architecture ready |
| Wallet connection | WalletConnect v2 | `@walletconnect/sign-client` |
| Navigation | React Navigation v6 | Native stack + bottom tabs + deep linking |
| Biometrics | `react-native-biometrics` | Face ID, Touch ID, Android Biometric Prompt |
| Credential storage | Keychain / Keystore | Encrypted at rest via `react-native-keychain` |
| QR scanning | `react-native-vision-camera` | Credential presentation scanning |
| Push notifications | `@notifee/react-native` + FCM/APNs | `@react-native-firebase/messaging` for delivery |
| Offline sync | Redux middleware + AsyncStorage queue | Syncs to server when connectivity is restored |
| State | Redux Toolkit | Persisted slices for wallet, credentials, and settings |
| Deep linking | React Navigation `linking` config | Universal links (iOS) and App Links (Android) |
| Testing | Jest + RNTL, Detox | Unit, component, and E2E tests |
| Deployment | Fastlane + GitHub Actions | TestFlight, Play Internal Testing, and production tracks |

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
cd ios && bundle install && bundle exec pod install && cd ..
```

### iOS build

```bash
# Debug build on a simulator
npm run ios

# Release build for a device (requires signing credentials)
npm run ios -- --mode Release
```

Open `ios/SorobanIdentity.xcworkspace` in Xcode to configure signing teams and provisioning profiles. The `NSFaceIDUsageDescription` key must be present in `Info.plist` for Face ID.

### Android build

```bash
# Debug build on an emulator or device
npm run android

# Release build (signed)
cd android && ./gradlew assembleRelease
```

Release signing is configured via `android/gradle.properties` and a keystore referenced from `android/app/build.gradle`. Keystore files and passwords are never committed; CI injects them from repository secrets.

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

### CI workflows

The `mobile/` app is built and tested by GitHub Actions workflows in `.github/workflows/`:

| Workflow | Trigger | Steps |
|----------|---------|-------|
| `mobile-ci.yml` | Pull requests touching `mobile/` | Lint, TypeScript check, Jest unit tests, Detox E2E on Android emulator |
| `mobile-ios.yml` | Push to `main`, tags | `pod install`, build, TestFlight upload via Fastlane |
| `mobile-android.yml` | Push to `main`, tags | Gradle build, Play Internal Testing upload via Fastlane |

Required repository secrets: `WALLETCONNECT_PROJECT_ID`, `SOROBAN_IDENTITY_API_URL`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `APP_STORE_CONNECT_API_KEY`, and `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.

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

The mobile app is a native client for the same WebAuthn-based biometric authentication implemented in the frontend. See [Frontend WebAuthn implementation](./webauthn.md) for the browser-side registration and assertion flows, the credential data model, and the relying-party configuration. The mobile app registers and asserts against the same relying party ID and backend endpoints, so a credential enrolled on the web can be managed from the device management screen and vice versa.

#### Platform authenticators

| Platform | Authenticator | Notes |
|----------|---------------|-------|
| iOS | Face ID / Touch ID | Exposed through `ASAuthorizationPlatformPublicKeyCredentialProvider`; requires `NSFaceIDUsageDescription` in `Info.plist` |
| Android | Biometric Prompt | Backed by `androidx.biometric`; supports fingerprint, face, and iris where the OEM provides them |
| Windows / macOS | Windows Hello / Touch ID | Supported by the desktop build of the frontend; see [Frontend WebAuthn implementation](./webauthn.md) |

Platform authenticators are preferred over roaming (security key) authenticators. The app requests `authenticatorAttachment: 'platform'` during registration and checks `isPlatformAuthenticatorAvailable()` before offering biometric enrolment.

#### Registration flow

1. User enables biometrics from **Settings → Security → Biometric authentication**.
2. App calls the backend registration options endpoint to obtain a `PublicKeyCredentialCreationOptions` challenge.
3. `react-native-biometrics` invokes the platform authenticator (Face ID, Touch ID, or Biometric Prompt).
4. The generated credential is sent to the backend verification endpoint and stored server-side.
5. The credential ID and metadata are cached locally for the device management screen.

#### Assertion flow

1. A gated action (app foreground, viewing claims, approving a presentation, signing a DID transaction) triggers an assertion.
2. App requests a fresh challenge from the backend.
3. The platform authenticator signs the challenge.
4. The backend verifies the signature and the app proceeds with the action.

#### Fallback to password / PIN

If biometrics are unavailable, not enrolled, or fail repeatedly, the app falls back to a 6-digit PIN. The PIN is stored in the system keychain, not in AsyncStorage. Users can also fall back to password authentication against the Soroban Identity API when the PIN is unavailable (for example, after a device restore). The fallback path is always offered — biometrics are never the sole authentication factor.

#### Secure credential storage

| Platform | Store | Notes |
|----------|-------|-------|
| iOS | Keychain | `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`; biometric-gated entries use `SecAccessControl` with `.biometryCurrentSet` |
| Android | Keystore | Keys generated with `setUserAuthenticationRequired(true)`; credential blobs encrypted with an AES key held in the Keystore |

Credential IDs and public key material are stored in the Keychain/Keystore; private keys never leave the platform authenticator. The device management screen lists enrolled credentials and allows the user to revoke any of them.

#### Device management UI

The **Settings → Security → Devices** screen lists every enrolled credential with its platform, enrolment date, and last-used timestamp. Users can rename a device, revoke a credential (which deletes it server-side and clears the local cache), or enrol an additional authenticator.

#### Cross-platform testing

Biometric flows must be smoke-tested on each target platform before a release:

- **iOS:** Face ID on a device with a TrueDepth camera, Touch ID on a device with a Home button; test both enrolment and assertion, plus the PIN fallback.
- **Android:** Biometric Prompt on a device with fingerprint and, where available, face unlock; test API 28+ (BiometricPrompt) and the legacy fingerprint path.
- **Windows / macOS:** Windows Hello and Touch ID via the desktop frontend build; verify the same credential works across the web and mobile clients.
- **Fallback:** Disable biometrics in OS settings and confirm the PIN/password fallback is offered.

Biometric auth gates:

- App foreground after background/lock
- Viewing full credential claims
- Approving a credential presentation
- Signing a DID transaction

### Push notifications

Push notifications are delivered through APNs on iOS and FCM on Android, using `@react-native-firebase/messaging` with `@notifee/react-native` for local display and channel management.

Notification types:

| Type | Trigger | Deep link target |
|------|---------|------------------|
| Credential issued | New credential available for the wallet | `sorobanid://credentials/:id` |
| Credential expiring | 7 days before expiry | `sorobanid://credentials/:id` |
| Presentation request | Verifier requests a presentation | `sorobanid://present/:requestId` |
| DID transaction confirmed | Queued DID write synced | `sorobanid://did/:did` |
| Sync failure | Offline queue item exhausted retries | `sorobanid://settings/sync` |

Users can opt out per category from **Settings → Notifications**. Notification permission is requested contextually (after the first credential is added) rather than on first launch. Tapping a notification routes through the deep link handler.

### Deep linking

The app registers the custom scheme `sorobanid://` plus universal links (iOS) and App Links (Android) for `https://soroban-identity.dev/app/*`.

Supported routes:

| Route | Purpose |
|-------|---------|
| `sorobanid://wallet/connect?uri=...` | Complete a WalletConnect pairing |
| `sorobanid://credentials/:id` | Open a specific credential |
| `sorobanid://present/:requestId` | Handle a verifier presentation request |
| `sorobanid://did/:did` | Open a DID detail screen |
| `sorobanid://settings/sync` | Open the offline sync status screen |

Deep links are configured in `src/navigation/linking.ts` and validated before routing; unknown or malformed links fall back to the home screen. Universal link association files (`apple-app-site-association` and `assetlinks.json`) are served from the docs site.

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

The offline-first architecture is implemented as Redux middleware in `src/store/middleware/offlineQueue.ts`: actions marked as network-bound are intercepted, persisted to the queue, and optimistically applied to the store. A connectivity watcher (`@react-native-community/netinfo`) drains the queue on reconnect, and the UI reflects pending state via the `sync` slice.

---

## App store deployment

Deployment is automated with Fastlane lanes in `mobile/fastlane/`:

| Lane | Platform | Destination |
|------|----------|-------------|
| `beta` | iOS | TestFlight |
| `release` | iOS | App Store |
| `internal` | Android | Play Internal Testing |
| `beta` | Android | Play Closed Testing |
| `release` | Android | Play Production (staged rollout) |

```bash
# iOS beta upload
cd mobile && bundle exec fastlane ios beta

# Android internal testing upload
cd mobile && bundle exec fastlane android internal
```

Version numbers are derived from `package.json` and bumped by the release workflow. Production releases use a staged rollout (10% → 50% → 100%) with crash-rate monitoring between stages.

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
- [ ] Push notifications tested on both platforms (foreground and background)
- [ ] Deep links tested via `sorobanid://` scheme and universal/App Links
- [ ] CI workflows green and store builds uploaded successfully

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
- [Frontend WebAuthn implementation](./webauthn.md)
