# Accessibility tests (WCAG 2.1 AA)

```bash
cd tests/a11y
npm install && npx playwright install --with-deps chromium
npm test                                   # builds and serves the frontend
A11Y_BASE_URL=http://localhost:5173 npm test   # test against a server that is already running
```

For every route, the suite checks:
- **axe-core** with the WCAG 2.1 A/AA tags. A `critical` or `serious` violation fails the build.
- **Color contrast** (`color-contrast` rule).
- **ARIA validity** (roles, required/allowed attributes, accessible names, labels).
- **Keyboard navigation:** you can Tab through every interactive element and each one shows a visible focus indicator.
- **Screen-reader structure:** there is a `main` landmark and exactly one `h1`, and the accessibility tree is not empty. These are the checks NVDA and JAWS depend on. Axe cannot replace manual NVDA/JAWS passes, so run those before a release.

Reports go to `reports/*.json` (one per route) and `reports/html/`. CI uploads them as artifacts.

Requirements and the PR checklist are in [docs/accessibility.md](../../docs/accessibility.md).
