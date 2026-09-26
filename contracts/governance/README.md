# Governance contract

The governance module provides a lightweight voting flow for approving upgrades and parameter changes through a token-weighted or multi-sig style process.

## Workflow

1. Initialize the governance contract with the administrative controller.
2. Register voter weights or delegate voting power to a representative.
3. Create a proposal for an upgrade, admin change, or parameter adjustment.
4. Allow the voting window to close.
5. Validate quorum and threshold requirements.
6. Enforce a timelock after approval before execution.
7. Execute governance actions through the proposal execution function.

## Defaults

- quorum: 30%
- approval threshold: 60%
- timelock: 48 hours
- emergency quorum: 60%
- emergency threshold: 75%

## Emergency path

Emergency actions carry a stricter threshold and quorum, which is suitable for high-risk contract upgrades or incident response.
