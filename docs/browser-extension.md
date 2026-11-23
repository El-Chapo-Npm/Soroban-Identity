# Browser Extension

The QuorumProof browser extension lets users verify credentials on any website without leaving the page. It provides one-click verification from the context menu, stores credentials locally, syncs with the web app via the API, shows badge notifications for expiring credentials, and supports auto-fill for credential forms.

> **Status:** Low priority / in progress. This document describes the intended architecture and build process.

## Architecture

The extension is built with [WebExtensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions) APIs so a single codebase targets both Chrome (Manifest V3) and Firefox (Manifest V2/V3).

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                               │
│                                                              │
│  ┌────────────┐   messages   ┌──────────────────────────┐   │
│  │ Content    │◄────────────►│  Background Service      │   │
│  │ Script     │              │  Worker                  │   │
│  │            │              │                          │   │
│  │ • form     │              │ • context menu           │   │
│  │   detection│              │ • badge notifications    │   │
│  │ • auto-fill│              │ • API sync               │   │
│  └────────────┘              │ • credential store       │   │
│                              └───────────┬──────────────┘   │
│                                          │                  │
│                              ┌───────────▼──────────────┐   │
│                              │  Popup / Options UI      │   │
│                              │  (React)                 │   │
│                              └───────────┬──────────────┘   │
└──────────────────────────────────────────┼──────────────────┘
                                           │ HTTPS
                              ┌────────────▼──────────────┐
                              │  QuorumProof Web App /    │
                              │  Verification API         │
                              └───────────────────────────┘
```

### Components

| Component | Responsibility |
|-----------|----------------|
| **Content script** | Detects credential forms, performs auto-fill, injects verification results into the page. |
| **Background service worker** | Owns the context menu, badge state, credential store, and all API calls. |
| **Popup UI** | Quick actions: verify current page, view stored credentials, trigger sync. |
| **Options UI** | Configure API endpoint, sign in, manage auto-fill rules. |
| **Storage layer** | `browser.storage.local` for credentials; `browser.storage.sync` for preferences. |

### Credential storage

Credentials are stored **locally** in the extension using `browser.storage.local`. Sensitive fields are encrypted at rest with a key derived from the user's session token (WebCrypto `AES-GCM`). Nothing is written to remote storage unless the user explicitly enables sync.

```js
// storage/credentials.js
const KEY = 'qp.credentials';

export async function saveCredential(credential) {
  const { [KEY]: existing = [] } = await browser.storage.local.get(KEY);
  const next = existing.filter((c) => c.id !== credential.id).concat(credential);
  await browser.storage.local.set({ [KEY]: next });
}

export async function listCredentials() {
  const { [KEY]: credentials = [] } = await browser.storage.local.get(KEY);
  return credentials;
}
```

## API sync flow

The extension talks to the same verification endpoints used by the web app. See the server API reference for the full contract.

1. **Authenticate** — the user signs in from the Options UI. The extension receives a session token and stores it in `browser.storage.local`.
2. **Pull** — on startup and every 15 minutes, the background worker calls the credential list endpoint and merges results into local storage.
3. **Verify** — one-click verification from the context menu calls the verification endpoint with the selected credential.
4. **Push** — credentials created in the extension are POSTed to the API when sync is enabled.

```
Options UI ──sign in──► POST /api/auth/login ──► session token
Background ──pull────► GET  /api/credentials
Background ──verify──► POST /api/credentials/verify
Background ──push────► POST /api/credentials
```

### Expiry badges

After each sync the background worker computes the time until each credential expires. Credentials expiring within 30 days set the toolbar badge to a warning count; expired credentials set an error badge.

```js
// background/badge.js
const WARN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export async function updateBadge(credentials) {
  const now = Date.now();
  const expiring = credentials.filter((c) => {
    const ttl = new Date(c.expiresAt).getTime() - now;
    return ttl <= WARN_WINDOW_MS;
  });

  if (expiring.length === 0) {
    await browser.action.setBadgeText({ text: '' });
    return;
  }

  const expired = expiring.filter((c) => new Date(c.expiresAt).getTime() <= now);
  await browser.action.setBadgeText({ text: String(expiring.length) });
  await browser.action.setBadgeBackgroundColor({
    color: expired.length ? '#d93025' : '#f9ab00',
  });
}
```

## Build instructions

### Prerequisites

- Node.js 18+
- npm 9+

### Install and build

```bash
cd extension
npm install

# Development build with watch mode
npm run dev

# Production builds
npm run build:chrome
npm run build:firefox
```

Build output is written to `extension/dist/chrome` and `extension/dist/firefox`.

### Chrome

1. Run `npm run build:chrome`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select `extension/dist/chrome`.

### Firefox

1. Run `npm run build:firefox`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and select `extension/dist/firefox/manifest.json`.

For a persistent install, package the build with `web-ext build` and load the resulting `.zip` via `about:addons`.

### Manifest differences

| Concern | Chrome | Firefox |
|---------|--------|---------|
| Manifest version | V3 | V2 (V3 supported from Firefox 109) |
| Background | `service_worker` | `scripts` / `background.scripts` |
| Action API | `chrome.action` | `browser.action` (polyfilled) |
| Context menu | `chrome.contextMenus` | `browser.menus` |

A small compatibility shim (`src/platform.js`) normalizes `chrome.*` and `browser.*` so feature code is shared.

## Store submission checklist

### Chrome Web Store

- [ ] Bump `version` in `manifest.json` and `package.json`.
- [ ] Run `npm run build:chrome` and zip `dist/chrome`.
- [ ] Prepare store listing: name, summary, detailed description, category.
- [ ] Upload at least one 1280×800 screenshot and a 128×128 icon.
- [ ] Provide a privacy policy URL (required — the extension handles credentials).
- [ ] Justify each permission in the **Permission justification** field.
- [ ] Complete the data-use disclosure form.
- [ ] Submit for review.

### Firefox Add-ons (AMO)

- [ ] Bump `version` in `manifest.json` and `package.json`.
- [ ] Run `npm run build:firefox`.
- [ ] Validate with `web-ext lint`.
- [ ] Package with `web-ext build`.
- [ ] Upload the `.zip` to [addons.mozilla.org](https://addons.mozilla.org/developers/).
- [ ] Provide source code if the build is minified (AMO source requirement).
- [ ] Fill in listing metadata, screenshots, and privacy policy.
- [ ] Submit for review.

### Shared

- [ ] Verify the extension against the production API endpoint.
- [ ] Confirm no credentials are transmitted without explicit user consent.
- [ ] Update `CHANGELOG.md`.
- [ ] Tag the release in git.

## Related documentation

- [Server API reference](./api.md) — verification and credential endpoints used by the extension.
- [Architecture overview](./architecture.md) — how the extension fits into the wider system.
- [Security model](./security.md) — credential handling and encryption details.