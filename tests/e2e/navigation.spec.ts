import { expect, test } from "@playwright/test";
import { connectFreighter, installFreighter, stubSorobanRpc } from "./freighter";

// Issue #1080: navigation, settings, and session journeys around the
// credential flows covered in credential-lifecycle.spec.ts.

test.beforeEach(async ({ page }) => {
  await stubSorobanRpc(page);
});

test("section tabs follow the WAI-ARIA keyboard pattern", async ({ page }) => {
  await page.goto("/");
  const identity = page.locator("#tab-identity");
  const credentials = page.locator("#tab-credentials");
  const stats = page.locator("#tab-networkStatistics");

  await expect(identity).toHaveAttribute("aria-selected", "true");
  await identity.focus();

  await page.keyboard.press("ArrowRight");
  await expect(credentials).toBeFocused();
  await expect(credentials).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#panel-credentials")).toBeVisible();
  await expect(page.locator("#panel-identity")).toBeHidden();

  await page.keyboard.press("End");
  await expect(stats).toBeFocused();
  await expect(stats).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Home");
  await expect(identity).toHaveAttribute("aria-selected", "true");

  // Left from the first tab wraps to the last.
  await page.keyboard.press("ArrowLeft");
  await expect(stats).toHaveAttribute("aria-selected", "true");

  // Only the selected tab is in the tab order.
  await expect(identity).toHaveAttribute("tabindex", "-1");
  await expect(stats).toHaveAttribute("tabindex", "0");
});

test("switching to mainnet shows the real-funds warning and switching back clears it", async ({ page }) => {
  await page.goto("/");
  const network = page.locator("#network-select");
  const warning = page.getByRole("alert", { name: "Mainnet warning" });

  await expect(warning).toHaveCount(0);
  await network.selectOption({ label: "Mainnet" });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("real");

  await network.selectOption({ label: "Testnet" });
  await expect(warning).toHaveCount(0);
});

test("language choice applies immediately and survives a reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#tab-credentials")).toHaveText("Credentials");

  await page.getByRole("combobox", { name: "Switch language" }).selectOption("fr");
  await expect(page.locator("#tab-credentials")).toHaveText("Justificatifs");

  await page.reload();
  await expect(page.locator("#tab-credentials")).toHaveText("Justificatifs");

  await page.getByRole("combobox", { name: "Changer de langue" }).selectOption("en");
  await expect(page.locator("#tab-credentials")).toHaveText("Credentials");
});

test("theme choice cycles and survives a reload", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /^Switch theme\./ });

  await expect(toggle).toHaveAttribute("aria-label", "Switch theme. Current: System");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-label", "Switch theme. Current: Light");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-label", "Switch theme. Current: Dark");

  await page.reload();
  await expect(toggle).toHaveAttribute("aria-label", "Switch theme. Current: Dark");
});

test("disconnecting the wallet returns to the connect state", async ({ page }) => {
  await installFreighter(page);
  await page.goto("/");
  await connectFreighter(page);

  await page.getByRole("button", { name: /Wallet account GA7Q/ }).click();
  await page.getByRole("menuitem", { name: /Disconnect wallet GA7Q/ }).click();

  await expect(page.getByRole("button", { name: "Connect Freighter wallet" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Wallet account GA7Q/ })).toHaveCount(0);
});

test("credentials tab stays usable after switching sections with a connected wallet", async ({ page }) => {
  await installFreighter(page);
  await page.goto("/");
  await connectFreighter(page);

  await page.locator("#tab-credentials").click();
  await expect(page.getByRole("heading", { name: "Verify Credential" })).toBeVisible();
  await page.locator("#tab-identity").click();
  await expect(page.getByRole("heading", { name: "Create DID" })).toBeVisible();
  await page.locator("#tab-credentials").click();
  await expect(page.getByRole("heading", { name: "Verify Credential" })).toBeVisible();
  await expect(page.getByText("via Freighter")).toBeVisible();
});
