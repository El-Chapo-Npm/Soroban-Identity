import { expect, test, type Page } from "@playwright/test";
import { stubSorobanRpc } from "./freighter";

// Issue #1080 journeys for the offline support added in #1079: the service
// worker keeps the app shell and API responses available without a network.
//
// Chromium only: Playwright's offline emulation does not reliably apply to
// service worker fetches in Firefox and WebKit.

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "offline emulation with service workers is Chromium-only in Playwright");
  await stubSorobanRpc(page);
});

/** Load the app and wait until the service worker controls the page. */
async function loadControlledPage(page: Page) {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  }
  // Load again through the worker so the hashed bundles land in its cache.
  await page.reload();
  await page.getByRole("button", { name: "Connect Freighter wallet" }).waitFor();
}

/** Fetch an API path from the page, as an HTML-accepting request the preview server answers. */
function apiProbe(page: Page, path: string) {
  return page.evaluate(async (url) => {
    const res = await fetch(url, { headers: { Accept: "text/html" } });
    return { status: res.status, cache: res.headers.get("x-sw-cache"), body: await res.text() };
  }, path);
}

test("the app loads from the service worker cache while offline", async ({ page, context }) => {
  await loadControlledPage(page);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole("button", { name: "Connect Freighter wallet" })).toBeVisible();
    await expect(page.getByText("You are offline. Some features may be limited.")).toBeVisible();

    // A route never visited still gets the cached shell.
    await page.goto("/some/deep/link");
    await expect(page.getByRole("button", { name: "Connect Freighter wallet" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test("API responses are served from the cache while offline and flagged as such", async ({ page, context }) => {
  await loadControlledPage(page);

  const online = await apiProbe(page, "/api/e2e-offline-probe");
  expect(online.status).toBe(200);
  expect(online.cache).toBeNull();

  await context.setOffline(true);
  try {
    // The copy is written in the background; poll until it is served.
    await expect
      .poll(async () => (await apiProbe(page, "/api/e2e-offline-probe")).cache)
      .toBe("offline");

    const missing = await apiProbe(page, "/api/e2e-never-fetched");
    expect(missing.status).toBe(503);
    expect(missing.cache).toBe("miss");
    expect(JSON.parse(missing.body).code).toBe("OFFLINE");
  } finally {
    await context.setOffline(false);
  }
});
