# UI Snapshot Tests

Jest snapshot tests (via `react-test-renderer`) guard against unintended UI changes.
Each major component is rendered in several wallet states: disconnected, connecting,
connected and error. Inline style keys are sorted by `styleSerializer.cjs` for stable output.

## Workflow

```bash
npm test              # run and compare against stored snapshots
npm run test:update   # regenerate snapshots after an intentional UI change
```

1. Make your UI change.
2. Run `npm test`; review any failing diff carefully.
3. If the change is intended, run `npm run test:update` and commit the updated
   `__snapshots__/*.snap` files together with the component change.
4. Reviewers should inspect `.snap` diffs in PRs just like source code.
