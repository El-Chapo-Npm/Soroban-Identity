# SDK Tutorials

Step-by-step tutorials for `@soroban-identity/sdk`, ordered from beginner to advanced. Each tutorial has a live, forkable sandbox and a video walkthrough.

| # | Tutorial | Level | Live sandbox | Video |
|---|----------|-------|--------------|-------|
| 1 | [Getting Started](./01-getting-started.md) | Beginner | [CodeSandbox](https://codesandbox.io/p/github/El-Chapo-Npm/Soroban-Identity/main?file=docs/tutorials/templates/starter/index.ts) | [Watch](../videos/README.md#tutorial-walkthroughs) |
| 2 | [DID Management](./02-did-management.md) | Beginner | Same starter, `did.ts` | [Watch](../videos/README.md#tutorial-walkthroughs) |
| 3 | [Credential Lifecycle](./03-credential-lifecycle.md) | Intermediate | Same starter, `credentials.ts` | [Watch](../videos/README.md#tutorial-walkthroughs) |
| 4 | [Reputation System](./04-reputation-system.md) | Advanced | Same starter, `reputation.ts` | [Watch](../videos/README.md#tutorial-walkthroughs) |

- **Starter template:** [`templates/starter`](./templates/starter). Download it with `npx degit El-Chapo-Npm/Soroban-Identity/docs/tutorials/templates/starter my-app`.
- **Troubleshooting:** [troubleshooting.md](./troubleshooting.md)
- **API reference:** [TypeDoc API docs](../index.md), [Getting started](../getting-started.md), [Architecture](../architecture.md)

## Embedding live code

Every tutorial embeds the starter template through CodeSandbox. You can also open it on Replit:

```html
<iframe
  src="https://codesandbox.io/p/github/El-Chapo-Npm/Soroban-Identity/main?file=docs/tutorials/templates/starter/index.ts&embed=1"
  style="width:100%;height:500px;border:0;border-radius:4px;overflow:hidden;"
  title="soroban-identity-starter"
  sandbox="allow-scripts allow-same-origin"
></iframe>
```

Replit: <https://replit.com/github/El-Chapo-Npm/Soroban-Identity> (set the run command to `cd docs/tutorials/templates/starter && npm install && npm start`).

## Feedback

At the end of each tutorial, tell us whether it helped by opening a
[tutorial feedback issue](https://github.com/El-Chapo-Npm/Soroban-Identity/issues/new?labels=documentation,tutorial-feedback&title=Tutorial+feedback%3A+).
Include the tutorial name, what worked, and where you got stuck.

## Keeping tutorials current

- Each tutorial states the SDK version it was last checked against.
- When a PR changes a public SDK method used here, update the matching tutorial in the same PR. The PR template's docs checkbox covers this.
- Maintainers re-run every tutorial against testnet each quarter and when a minor or major SDK version ships.
