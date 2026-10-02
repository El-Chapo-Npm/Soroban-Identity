# Staging Environment

Isolated environment for validating changes before production.

| Item | Value |
|------|-------|
| Network | Stellar **testnet** (separate from production) |
| Domain | `https://staging.soroban-identity.app` |
| Trigger | Automatic on merge/push to `develop` (`.github/workflows/staging-deploy.yml`) |
| Config | `.env.staging.example` — mirrors production with test data |

## Provisioning
1. Create a dedicated testnet account: `stellar keys generate staging --network testnet --fund`.
2. Add GitHub secrets: `STAGING_STELLAR_SECRET_KEY`, `STAGING_WALLETCONNECT_PROJECT_ID`.
3. Create the GitHub environment `staging` (Settings → Environments) and restrict who can approve.
4. Point the `staging` subdomain DNS (CNAME) to the static host configured for the frontend.

## Manual deploy
```bash
cp infrastructure/staging/.env.staging.example infrastructure/staging/.env.staging
# fill in STELLAR_SECRET_KEY
./infrastructure/staging/deploy-staging.sh
```
Deployed contract IDs are written to `contracts.staging.json`. The script refuses any network other than testnet.

## Access
- Frontend: public at the staging domain; connect Freighter/WalletConnect set to **Testnet**.
- Deploy key: stored only in GitHub secrets; request access from a repo maintainer.
- Logs: GitHub Actions → *Staging Deploy* workflow runs (artifact `staging-deployment`).
