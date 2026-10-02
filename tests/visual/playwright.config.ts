import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.VISUAL_BASE_URL ?? "http://localhost:4173";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { outputFolder: "report", open: "never" }], ["list"]],
  expect: {
    // Local fallback threshold when Percy is not configured
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" },
  },
  use: { baseURL, colorScheme: "light" },
  // Browser-specific rendering differences
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: process.env.VISUAL_BASE_URL
    ? undefined
    : {
        command: "npm --prefix ../../frontend run preview -- --port 4173",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
