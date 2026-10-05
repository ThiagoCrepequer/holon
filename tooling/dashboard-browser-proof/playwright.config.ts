import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./test",
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"], ["junit", { outputFile: "proof-results/junit.xml" }]],
  use: {
    baseURL: "http://127.0.0.1:8793",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "proof-results/browser",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "pnpm serve:proof",
    url: "http://127.0.0.1:8793/proof/a",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
