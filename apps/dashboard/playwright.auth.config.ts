import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/browser",
  testMatch: [
    "auth.spec.ts",
    "milestone-two.spec.ts",
    "milestone-three.spec.ts",
    "milestone-five.spec.ts",
    "milestone-six.spec.ts",
    "milestone-seven.spec.ts",
    "native-zoom.spec.ts",
    "performance-lab.spec.ts",
  ],
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
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "native-zoom.spec.ts",
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testIgnore: "native-zoom.spec.ts",
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testIgnore: "native-zoom.spec.ts",
    },
    {
      name: "chromium-native-zoom",
      testMatch: "native-zoom.spec.ts",
      // Native zoom uses a real window, without device emulation defaults.
      use: { browserName: "chromium", viewport: null },
    },
  ],
  webServer: {
    command: "node test/support/native-browser-server.mjs",
    url: "https://127.0.0.1:8795/api/health",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
