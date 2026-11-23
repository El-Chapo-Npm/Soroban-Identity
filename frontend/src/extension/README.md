# Soroban Identity Browser Extension

A Manifest V3 browser extension for Google Chrome, Mozilla Firefox, Microsoft Edge, and Brave that provides one-click credential verification, form auto-fill, and badge notifications for expiring credentials across any website.

## Features

- **One-Click Context Menu Verification**: Right-click any selected text on the web (e.g. a credential ID, DID, or hash) and choose "Verify Selected Credential ID". An overlay banner pops up displaying verification status directly on the page.
- **Form Auto-Fill**: Automatically detects credential, DID, and Stellar address fields on any web page. Easily auto-fills attested claims with one click.
- **Expiring Credential Badges**: Background service worker monitors credential expiration dates and displays a dynamic badge indicator on the extension icon when credentials are set to expire within 30 days.
- **Local Storage & Web App Sync**: Seamlessly syncs credentials from the Soroban Identity web application to extension local storage via a secure `postMessage` bridge.
- **Fast Popup Dashboard**: View all stored credentials, filter by keyword, verify on demand, and copy IDs.

## Architecture

- `manifest.json`: Manifest V3 configuration with granular permissions (`storage`, `contextMenus`, `activeTab`, `alarms`).
- `background.ts`: Service worker managing context menus, alarms, badge state, and message dispatch.
- `contentScript.ts`: Injected script managing DOM auto-fill, in-page verification toasts, and web application bridge.
- `popup.html` / `popup.ts`: Interactive popup interface for browsing and verifying credentials.
- `extensionBridge.ts`: TypeScript bridge module for web applications to detect extension presence and synchronize credentials.

## Installation (Developer Mode)

### Chrome / Brave / Edge
1. Navigate to `chrome://extensions/` (or `edge://extensions/`).
2. Enable **Developer mode** toggle in the upper right.
3. Click **Load unpacked**.
4. Select the `frontend/src/extension` directory.

### Firefox
1. Navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `frontend/src/extension/manifest.json`.

## Publishing to Browser Extension Stores

### Chrome Web Store
1. Create a zip file containing `manifest.json`, compiled scripts, and popup HTML:
   ```bash
   cd frontend/src/extension
   zip -r ../../../soroban-identity-extension.zip *
   ```
2. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
3. Upload the `.zip` archive.
4. Fill out the store listing details (Descriptions, Screenshots, Privacy Policy).
5. Submit for review.

### Firefox Add-ons (AMO)
1. Go to the [Mozilla Add-ons Developer Hub](https://addons.mozilla.org/developers/).
2. Submit your extension package for automated validation and signing.
3. Publish as self-hosted or listed on AMO.
