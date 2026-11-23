import { test } from "@playwright/test";
import { breakpoints, snapshot, themes } from "./helpers";

// Major UI states. Extend this list when new routes/states are added.
const routes = [
  { name: "home", path: "/" },
  { name: "identity", path: "/#/identity" },
  { name: "credentials", path: "/#/credentials" },
  { name: "reputation", path: "/#/reputation" },
  { name: "not-found", path: "/#/does-not-exist" },
];

for (const theme of themes) {
  test.describe(`theme: ${theme}`, () => {
    test.use({ colorScheme: theme });

    for (const route of routes) {
      for (const [bp, viewport] of Object.entries(breakpoints)) {
        test(`${route.name} @ ${bp}`, async ({ page }, testInfo) => {
          await page.setViewportSize(viewport);
          await page.goto(route.path);
          await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
          await snapshot(page, `${route.name}-${bp}-${theme}`, testInfo);
        });
      }
    }
  });
}
