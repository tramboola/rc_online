import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  ...(process.env.PW_EXTERNAL_SERVER
    ? {}
    : {
      webServer: {
        command: "node ../../apps/web/.next/standalone/apps/web/server.js",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
    }),
  use: {
    baseURL: process.env.WEB_ORIGIN ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1672, height: 941 } },
    },
    {
      name: "driving-wide",
      use: { ...devices["Desktop Chrome"], viewport: { width: 2730, height: 1536 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
