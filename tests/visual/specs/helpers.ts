import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import percySnapshot from "@percy/playwright";

export const breakpoints = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
} as const;

export const themes = ["light", "dark"] as const;

/** Captures a snapshot via Percy when PERCY_TOKEN is set, otherwise via Playwright's built-in diffing. */
export async function snapshot(page: Page, name: string, testInfo: TestInfo) {
  await page.waitForLoadState("networkidle");
  if (process.env.PERCY_TOKEN) {
    // Percy renders its own widths from .percy.yml; only snapshot once per browser/theme.
    await percySnapshot(page, `${name} [${testInfo.project.name}]`);
  } else {
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  }
}
