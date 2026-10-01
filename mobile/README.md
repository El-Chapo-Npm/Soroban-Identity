# Soroban Identity mobile

React Native (Expo, TypeScript) app for iOS and Android.

## Features
- **Wallet connection** via WalletConnect v2 (`stellar:testnet`, `stellar_signXDR`)
- **DID management** — resolve and view the connected account's DID
- **Credentials** — list credentials and scan `sorobanid://verify?id=…&caller=…` QR codes to verify
- **Biometric lock** — Face ID / Touch ID / fingerprint (passcode fallback) on launch
- **Offline mode** — network-first reads cached in AsyncStorage, shown with an offline banner

## Setup
```bash
cd mobile && npm install
cp .env.example .env   # fill in IDs
npm start
```

## Beta release
Uses EAS (`eas.json`):
```bash
npm run build:ios && npm run submit:ios          # TestFlight
npm run build:android && npm run submit:android  # Play Store beta track
```
Set `ascAppId` and provide `play-service-account.json` (not committed) before submitting.
