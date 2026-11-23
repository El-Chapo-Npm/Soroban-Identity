# Connected Accounts

Connected accounts belong to a Stellar wallet address, which is the primary account identifier for this application. The server does not accept a client-selected account ID for link, list, or unlink operations. A browser first signs a short-lived Stellar `ManageData` challenge with the connected wallet; the server verifies the XDR signature and issues a 15-minute bearer session. The challenge transaction is **never submitted to the Stellar network** and creates no on-chain data.

## Deployment configuration

Set `ACCOUNT_LINKS_SESSION_SECRET` to a high-entropy secret of at least 32 bytes. It is used to sign wallet challenges and browser sessions; changing it invalidates outstanding challenges and sessions. Do not reuse the server JWT or API-key secret. Set `ACCOUNT_LINKS_STORE_PATH` to a private, persistent file path. The account-link store contains wallet addresses, GitHub profile IDs/usernames, and verified email addresses; it is written with mode `0600` and its parent directory is created with mode `0700`.

The current file-backed store and its one-time-token consumption are designed for the repository's single-process deployment model. Do not enable account linking across multiple server instances with independent local disks; use a shared transaction-capable storage implementation before scaling this feature horizontally.

### GitHub

Create a GitHub OAuth app and configure all three variables together:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_REDIRECT_URI`, set to the exact public callback, for example `https://api.example.com/account-links/github/callback`

The server requests only the `read:user` scope, exchanges the code server-side, fetches the authenticated GitHub profile, then discards the access token. OAuth state is random, expires after 10 minutes, is stored only as a hash, and is consumed once. GitHub account IDs are unique across linked wallets.

### Verified email

Configure the existing provider-agnostic email transport with `EMAIL_API_URL` and `EMAIL_FROM` (and `EMAIL_API_KEY` if required by the relay), then set `ACCOUNT_LINKS_APP_URL` to the public frontend URL, for example `https://identity.example.com/`. The email request uses the existing transport's JSON shape: `from`, `to`, `subject`, `text`, and `html`.

The confirmation token is random, stored only as a SHA-256 hash, expires after 30 minutes, and can be used once. The raw token is placed in the URL fragment (`#account_link_token=...`), so browsers and HTTP access logs do not send it in the request URL. The frontend displays an explicit confirmation action rather than consuming it automatically, which avoids link-preview scanners claiming the email. An email address may be linked to only one wallet.

The server rejects non-HTTPS public URLs; HTTP is allowed only for localhost development. Configure CORS to allow the frontend origin. The Stellar network passphrase used by the server (`SOROBAN_NETWORK_PASSPHRASE`, or the default for `STELLAR_NETWORK`) must match the wallet network selected in the browser.

## HTTP API

All account-link responses use `Cache-Control: no-store`. The routes remain subject to the server's global IP rate limit. `Authorization: Bearer <session-token>` is required for the authenticated routes.

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /account-links/challenge?address=<G...>` | Public, rate-limited | Issue a signed Stellar wallet challenge; the address is bound into the signed challenge. |
| `POST /account-links/session` | Public, one-use challenge | Verify `{ "challengeId": "...", "signedXdr": "..." }` and issue a short-lived wallet session. |
| `GET /account-links` | Session | Return the caller's linked GitHub/email records and provider availability. |
| `POST /account-links/github/start` | Session | Create a one-use OAuth state and return GitHub's authorization URL. |
| `GET /account-links/github/callback` | OAuth callback | Verify and consume state, exchange the code, and link the GitHub profile. |
| `POST /account-links/email` | Session | Request verification for `{ "email": "..." }`; the response does not reveal whether an address belongs to another wallet. |
| `POST /account-links/email/confirm` | Public, one-use token | Verify `{ "token": "..." }` from the user-confirmed email link. |
| `DELETE /account-links/github` | Session | Remove the GitHub association. |
| `DELETE /account-links/email` | Session | Remove the verified-email association. |

Unlinking removes only the selected provider association. The Stellar wallet remains the primary account credential.
