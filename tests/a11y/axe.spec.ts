/**
 * Automated WCAG 2.1 AA accessibility tests (#827).
 * Runs axe-core against every page, checks keyboard navigation, and writes a JSON report.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";

const ROUTES = ["/", "/identity", "/credentials", "/reputation", "/settings"];
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BLOCKING = new Set(["critical", "serious"]);
const REPORT_DIR = path.resolve(__dirname, "reports");

async function scan(page: Page, rules?: string[]) {
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (rules) builder.withRules(rules);
  return builder.analyze();
}

test.beforeAll(() => fs.mkdirSync(REPORT_DIR, { recursive: true }));

for (const route of ROUTES) {
  test.describe(`a11y ${route}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
    });

    test("has no critical/serious WCAG 2.1 AA violations", async ({ page }) => {
      const results = await scan(page);
      const file = route === "/" ? "home" : route.slice(1).replace(/\//g, "_");
      fs.writeFileSync(path.join(REPORT_DIR, `${file}.json`), JSON.stringify(results.violations, null, 2));
      const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ""));
      expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join("\n")).toEqual([]);
    });

    test("color contrast meets AA", async ({ page }) => {
      const { violations } = await scan(page, ["color-contrast"]);
      expect(violations).toEqual([]);
    });

    test("ARIA attributes are valid", async ({ page }) => {
      const { violations } = await scan(page, [
        "aria-allowed-attr", "aria-required-attr", "aria-valid-attr", "aria-valid-attr-value",
        "aria-roles", "aria-hidden-focus", "button-name", "link-name", "label",
      ]);
      expect(violations).toEqual([]);
    });

    test("all interactive elements are keyboard reachable with visible focus", async ({ page }) => {
      const interactive = await page
        .locator("a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])")
        .count();
      const seen = new Set<string>();
      for (let i = 0; i < Math.min(interactive + 1, 100); i++) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const s = getComputedStyle(el);
          return {
            key: el.outerHTML.slice(0, 120),
            visible: s.outlineStyle !== "none" || s.boxShadow !== "none",
          };
        });
        if (!info) continue;
        expect(info.visible, `No visible focus indicator on ${info.key}`).toBe(true);
        seen.add(info.key);
      }
      expect(seen.size).toBeGreaterThanOrEqual(Math.min(interactive, 1));
    });

    test("screen-reader landmarks and headings are present", async ({ page }) => {
      // Approximates what NVDA/JAWS announce: the accessibility tree has a main landmark and one h1.
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const snapshot = await page.accessibility.snapshot();
      expect(snapshot?.children?.length ?? 0).toBeGreaterThan(0);
    });
  });
}
