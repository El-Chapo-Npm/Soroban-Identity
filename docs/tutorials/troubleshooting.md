# Tutorial Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Account not found` when sending a transaction | Account not funded | Fund it with Friendbot: `https://friendbot.stellar.org?addr=<G...>` |
| `validateConfig` throws about a contract ID | Missing env var | Set `IDENTITY_REGISTRY_ID`, `CREDENTIAL_MANAGER_ID`, `REPUTATION_ID` |
| `InvalidClaimsHashFormat` | Hash is not 64 hex characters | Use a SHA-256 hex digest of the claims |
| `UnknownCredentialTypeError` | Unsupported type string | Use `Kyc`, `Reputation`, `Achievement` or `Custom` |
| Authorization error on `updateDid` or `revokeCredential` | Signed with the wrong keypair | Sign with the DID controller or the credential issuer |
| Issuing a credential fails with an issuer error | Issuer is not registered | Ask the contract admin to register the issuer address |
| `RateLimitError` | Too many RPC calls | Back off and retry, or pass several URLs in `rpcUrl` |
| Transaction times out | Congested network or short timeout | Raise `txTimeout` in config or `timeoutSeconds` per call |
| Network mismatch errors | Wrong passphrase | Use `Networks.TESTNET` with the testnet RPC |

Still stuck? Open a [tutorial feedback issue](https://github.com/El-Chapo-Npm/Soroban-Identity/issues/new?labels=documentation,tutorial-feedback).
