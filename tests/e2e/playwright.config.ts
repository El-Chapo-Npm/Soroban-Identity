import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 4174);

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "reports/html", open: "never" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`,
    video: "on",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm --prefix ../../frontend run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
        url: `http://127.0.0.1:${port}`,
        timeout: 180_000,
        reuseExistingServer: !process.env.CI,
      },
});
