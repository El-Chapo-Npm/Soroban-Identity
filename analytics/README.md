# Soroban Identity Analytics

An indexer and live dashboard for network statistics. It follows the `identity-registry` and `credential-manager` contracts through Soroban RPC and reports:

- **DIDs created over time**: daily and cumulative, plus active vs deactivated
- **Credential issuance rates**: per day (issued vs revoked) and per hour over the last 48 h
- **Top issuers**: ranked by credentials issued, with revocations, unique subjects and last activity
- **Credential types**: issuance per type (KYC, Reputation, Achievement, Custom)
- **Verification frequency**: per day, split by how each verification was observed (see below)
- **Geographic distribution**: DIDs per country, for DIDs that declare one
- **Real-time updates**: the dashboard is pushed a fresh summary over Server-Sent Events as soon as new ledger events are indexed
- **Report export**: every view as CSV or JSON, plus the raw event log

## Running

Requires Node.js 20.6+.

```bash
cd analytics
cp .env.example .env        # set IDENTITY_REGISTRY_ID and CREDENTIAL_MANAGER_ID
npm install
npm run dev                 # or: npm run build && npm start
```

Open http://localhost:8790.

Indexed state is saved to `DATA_FILE` (default `./data/analytics.json`), so a restart resumes from the last cursor. On first start the indexer backfills `LOOKBACK_LEDGERS` ledgers (about a day by default), or from `START_LEDGER` if set. It cannot go further back than the RPC's retention window; if the service is down longer than that, it resumes at the oldest ledger the RPC still has.

## Where the numbers come from

| Metric | Source (see [docs/contract-events.md](../docs/contract-events.md)) |
|---|---|
| DIDs created / updated | `IDENTITY.created`, `IDENTITY.updated` |
| Active vs deactivated DIDs | `IDENTITY.deact` and `IDENTITY.reactivated`, replayed in ledger order |
| Credentials issued, by type | `CRED.issued`: `(version, id, subject, issuer, type, expires_at)` |
| Credentials revoked, per issuer | `CRED.revoked`: `(version, id, issuer, revoked_at[, reason])` |
| Active issuers | `ISSUER.added` / `ISSUER.removed`, replayed in order |
| Verifications (on-chain) | Successful transactions that invoke `verify_credential` or `verify_credentials_batch` (one count per credential checked), found via `getTransactions` |
| Verifications (reported) | `POST /api/verifications` from apps |
| Country | Optional `country` key (ISO 3166-1 alpha-2) in a DID's metadata, read with `resolve_did` |

All events carry `EVENT_VERSION` as their first payload field; the indexer strips it and reads the fields after it.

Two limits of on-chain data shape these metrics:

**Most verifications never reach the ledger.** `verify_credential` is a read-only call that apps usually *simulate*, and simulations leave no trace. The indexer counts the verifications that do land in a transaction; for the rest, apps can report them:

```bash
curl -X POST http://localhost:8790/api/verifications \
  -H "Authorization: Bearer $REPORT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"credentialId":"<64 hex chars>","valid":false,"reason":"expired"}'
```

`reason` should be one of the SDK's `VerifyFailReason` values. Reporting is disabled while `REPORT_TOKEN` is empty. The two sources are stacked separately on the chart so they are never confused.

**The chain has no location data.** The geographic view only counts DIDs whose owners chose to put `country` in their metadata (e.g. `identity.createDid(keypair, { country: "NG" })`). It shows how many DIDs declare a country and how many don't, and never guesses from IP addresses or other signals.

The direct `remove_issuer` admin call publishes no event (only removals executed through a multisig proposal emit `ISSUER.removed`), so **Active issuers** can over-count after a direct removal.

`TRACK_VERIFICATION_TXS=true` scans every transaction on the network. That is cheap on testnet; on mainnet, consider a dedicated RPC or turn it off.

## API

| Endpoint | Description |
|---|---|
| `GET /api/summary` | All metrics as JSON |
| `GET /api/stream` | SSE stream; sends an `event: summary` frame on connect and on every change |
| `GET /api/export?report=<name>&format=csv\|json` | Download a report. `name`: `summary`, `dids`, `issuance`, `types`, `issuers`, `verifications`, `geography`, `events` |
| `POST /api/verifications` | Report an off-chain verification (bearer token) |
| `GET /healthz` | Liveness plus the latest indexed ledger |

## Layout

```
analytics/
├── src/
│   ├── config.ts     env configuration
│   ├── store.ts      event log + JSON persistence, emits `change`
│   ├── indexer.ts    RPC polling: contract events, verify txs, DID countries
│   ├── metrics.ts    aggregates the log into the dashboard summary
│   ├── reports.ts    CSV / JSON report builders
│   └── server.ts     HTTP API, SSE, static dashboard
└── public/           dashboard (plain HTML/CSS/JS, inline SVG charts)
```
