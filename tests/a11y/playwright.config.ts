import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  reporter: [["list"], ["html", { outputFolder: "reports/html", open: "never" }]],
  use: { baseURL: process.env.A11Y_BASE_URL ?? "http://localhost:4173" },
  webServer: process.env.A11Y_BASE_URL
    ? undefined
    : {
        command: "npm --prefix ../../frontend run build && npm --prefix ../../frontend run preview -- --port 4173",
        url: "http://localhost:4173",
        timeout: 180_000,
        reuseExistingServer: true,
      },
});
