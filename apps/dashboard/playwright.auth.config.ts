import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/browser",
  testMatch: ["auth.spec.ts", "milestone-two.spec.ts"],
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [
    ["list"],
    ["junit", { outputFile: "proof-results/auth-junit.xml" }],
  ],
  use: {
    baseURL: "https://127.0.0.1:8795",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "proof-results/auth-browser",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "node test/support/native-browser-server.mjs",
    url: "https://127.0.0.1:8795/api/health",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
