# End-to-end tests

Issue #820. Playwright drives the Vite app with a mocked Freighter wallet and a stubbed Soroban RPC. The suite does not submit transactions to testnet.

## What is covered

- Wallet connect through the Freighter picker
- Missing extension and wrong-network errors
- Create DID failure when the RPC stub refuses `getAccount` (no fake success)
- Credentials tab: issue, verify, and revoke sections are present
- Verify of an unknown id fails closed (red or pending badge, never a silent success)
- Serious and critical axe violations on the home screen
- A full-page screenshot of the connected shell (`wallet-connected.png`), compared locally. CI attaches the same screenshot and records video instead of pixel-matching across operating systems.

## Browsers

`playwright.config.ts` runs Chromium, Firefox, and WebKit. CI installs all three and records a video for every test (`video: "on"`, artifacts under `tests/e2e/test-results/`).

## Run

Build the frontend once, then run the suite:

```bash
cd frontend
npm install
npx vite build
cd ../tests/e2e
npm install
npx playwright install chromium firefox webkit
npm test
```

`E2E_BASE_URL` skips the preview server when you already have one. Screenshot updates:

```bash
npm run test:update
```

## Limits

- Issuance and revocation are not completed on a chain. The RPC stub returns a JSON-RPC error for ledger reads, so those forms stop at the error state. A passing run does not mean a contract call succeeded.
- The screenshot baseline in git was captured on macOS Chromium. Other browsers and CI hosts are not pixel-compared. Firefox and WebKit still run the same flows and upload video.
- Critical-path coverage is the wallet and credential shell, not every issuer-dashboard chart. The 80% figure in the issue is not a line-coverage number this suite measures.
