# Feature Flags

The server includes a lightweight, self-contained feature flag system for
gradual rollout and A/B testing of new features (issue #723). It requires no
external service: flags are persisted as JSON with atomically written files and
cached in memory for fast evaluation.

## Storage layout

```
<dataDir>/feature-flags/flags.json   # current flag definitions
<dataDir>/feature-flags/audit.jsonl  # append-only change log
```

Both files live under the server's configured `DATA_DIR` (default `./data`).

## Flag lifecycle

1. **Created** — an admin creates a flag with `createFlag`. New flags are
   created **disabled** and never start affecting traffic until enabled.
2. **Targeted** — `targetingRules` are added for gradual rollout or per-user
   targeting. Rules are evaluated in order; the first match wins.
3. **Evaluated** — `evaluate(key, context)` checks the global enable switch,
   then runs the targeting rules, and returns the winning variant.
4. **Enabled** — an enabled boolean flag with no matching rule is effectively
   on for everyone; an enabled variant flag falls back to `defaultValue`.
5. **Archived** — `archiveFlag` retires a flag. Archived flags always evaluate
   to `defaultValue` and the audit trail is preserved for post-mortems.

## Targeting rules

Supported operators:

| Operator      | Value        | Matches when                                    |
|---------------|--------------|-------------------------------------------------|
| `eq`          | any          | `context[attribute] === value`                  |
| `neq`         | any          | `context[attribute] !== value`                  |
| `in`          | `[]`         | `context[attribute]` is in the array            |
| `not_in`      | `[]`         | `context[attribute]` is not in the array        |
| `percentage`  | 0–100        | deterministic hash of attribute+context < value |

`percentage` is stable for a given context, enabling consistent A/B buckets
across requests without a random source.

## Evaluation caching

Flags are cached in memory and only re-read from disk on writes, so hot-path
evaluation never touches the filesystem.

## Change logging

Every create/update/archive is appended to `audit.jsonl` with an actor and a
timestamp, giving a full audit trail of who toggled what and when.

## Example: rolling out a new credential type

```js
import { createFlag, evaluate, updateFlag } from './feature-flags.js';

await createFlag(dataDir, {
  key: 'new_credential_types',
  type: 'variant',
  defaultValue: 'disabled',
});

// Gradual rollout to 10% of users
await updateFlag(dataDir, 'new_credential_types', {
  enabled: true,
  targetingRules: [
    { attribute: 'userId', operator: 'percentage', value: 10, variant: 'enabled' },
  ],
});

// Per-request evaluation
const { variant } = evaluate('new_credential_types', { userId, tier });
```
