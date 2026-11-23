# Visual Regression Testing

Automated screenshot comparison with [Percy](https://percy.io) driven by Playwright.
When `PERCY_TOKEN` is not set the suite falls back to Playwright's built-in
`toHaveScreenshot` diffing, so it can run locally without an account.

## Coverage
- **UI states:** routes listed in `specs/pages.spec.ts` (home, identity, credentials, reputation, 404).
- **Breakpoints:** mobile 375px, tablet 768px, desktop 1280px.
- **Themes:** light and dark (`prefers-color-scheme` + `data-theme`).
- **Browsers:** Chromium, Firefox, WebKit.

## Thresholds
- Percy: `diff.sensitivity` in `.percy.yml`.
- Playwright fallback: `maxDiffPixelRatio: 0.01` in `playwright.config.ts`.
- Mark volatile elements with `data-visual-ignore` to exclude them from diffs.

## Running locally
```bash
npm --prefix frontend run build
cd tests/visual && npm install && npm run install:browsers
npm test                          # Playwright diffing
npx playwright test --update-snapshots   # accept new baselines
PERCY_TOKEN=... npm run test:percy       # Percy
```
The HTML diff report is written to `tests/visual/report/`.

## PR review workflow
1. `.github/workflows/visual-regression.yml` runs on every PR touching `frontend/`.
2. Percy posts a status check on the PR linking to the build.
3. A reviewer opens the Percy build, inspects each highlighted diff and clicks
   **Approve** (intended change) or **Request changes** (regression).
4. The check must be green before merge. Approved snapshots become the new baseline on `main`.

## Reviewer guide (team training)
- Look at the diff overlay first, then side-by-side, for each browser/width.
- Font anti-aliasing noise across browsers is expected; layout shifts, clipped
  text, colour/contrast changes and missing elements are not.
- If a diff is caused by dynamic data, add `data-visual-ignore` instead of approving repeatedly.
