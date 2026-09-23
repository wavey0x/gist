import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4310", trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/gallery-touch.spec.ts",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile-webkit",
      testIgnore: "**/gallery-touch.spec.ts",
      use: { ...devices["iPhone 13"] }
    },
    {
      name: "mobile-chromium",
      testMatch: "**/gallery-touch.spec.ts",
      use: { ...devices["Pixel 7"], reducedMotion: "reduce" }
    }
  ],
  webServer: [
    {
      command: "node tests/gallery-fixture-server.mjs",
      url: "http://127.0.0.1:4311/health",
      reuseExistingServer: !process.env.CI
    },
    {
      command:
        "npm run build && npm run start -- --hostname 127.0.0.1 --port 4310",
      url: "http://127.0.0.1:4310",
      env: { GIST_API_BASE_URL: "http://127.0.0.1:4311" },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ]
});
