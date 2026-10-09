import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "test/browser",
  testIgnore: [
    "auth.spec.ts",
    "milestone-two.spec.ts",
    "milestone-three.spec.ts",
    "milestone-five.spec.ts",
  ],
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"], ["junit", { outputFile: "proof-results/junit.xml" }]],
  use: {
    baseURL: "http://127.0.0.1:8794",
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
    command: "pnpm serve:test",
    url: "http://127.0.0.1:8794/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
