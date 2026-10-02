# Deployment cost optimization

This repository uses Soroban deployments, not EVM deployments. Soroban does not
have Ethereum `CREATE2`; the equivalent reproducibility primitive is a stable
salt supplied to the deployer. `scripts/deploy.sh` derives one salt per contract
from `SOROBAN_DEPLOY_SALT_PREFIX`, so retries resolve to the same deployment
identity instead of creating duplicate instances.

## Cost controls

- Release builds use `opt-level = "z"`, LTO, one codegen unit, symbol stripping,
  and `panic = "abort"`.
- Contract initialization is kept as a separate, explicit transaction because
  the canonical admin initialization pattern emits an observable init event and
  prevents re-initialization. Removing it would break the contract lifecycle.
- Deployment checks `.env.deployed` first and skips already reachable contracts.
- Stable salts make failed/retried deployment workflows idempotent.
- The deployment script never logs the secret key and retains the mainnet delay
  and secret-manager gate.

## Audit and benchmark

Run the non-submitting benchmark:

```bash
scripts/benchmark-deployment.sh deployment-costs.csv
cat deployment-costs.csv
```

The CSV records each WASM byte size, SHA-256 artifact hash, release build time,
and the deterministic salt input. Compare the CSV before and after a contract
change; smaller WASM generally lowers deployment resource consumption, while the
hash proves that the measured artifact is the one being deployed.

To deploy with a different deterministic namespace:

```bash
SOROBAN_DEPLOY_SALT_PREFIX=staging-2026 scripts/deploy.sh --network testnet
```

The script requires the installed Stellar CLI's `contract deploy --salt` option.
Check the CLI version before production deployment and use the network's normal
simulation/fee inspection tools to record the actual transaction resource fee.
Never treat a local byte-size comparison as a substitute for a network fee
simulation.
