# Tutorial 4: Reputation System

**Level:** Advanced · **Time:** 30 min · **Last checked against:** SDK 0.1.0
**Prerequisite:** [Tutorial 3](./03-credential-lifecycle.md)

## Read a reputation score

```ts
import { ReputationClient } from "@soroban-identity/sdk";

const reputation = new ReputationClient(config);
const record = await reputation.getReputation(callerAddress, subjectAddress);
console.log(record);
```

## Score history

```ts
const history = await reputation.getScoreHistory(callerAddress, subjectAddress);
```

## Sybil checks

Gate an action on a minimum reputation:

```ts
const ok = await reputation.passesSybilCheckDefault(callerAddress, subjectAddress);
if (!ok) throw new Error("Account does not meet the reputation threshold");
```

## Listening for score changes

Use `SorobanEventListener` to react to reputation events instead of polling. See [Contract events](../contract-events.md).

## Exercises

1. Build a function that allows an action only when the subject holds a valid `Kyc` credential and passes the Sybil check.
2. Plot `getScoreHistory` output over time.

API reference: `ReputationClient` in the [TypeDoc docs](../index.md).
