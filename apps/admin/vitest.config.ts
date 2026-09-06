import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    reactRouter(),
    cloudflareTest({
      miniflare: {
        bindings: {
          ACCESS_AUD: "test-audience",
          ACCESS_TEAM_NAME: "test-team",
          ADMIN_CURSOR_HMAC_KEYS:
            '{"primary":{"kid":"test-key","secretHex":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}}',
          AUTHORIZED_EMAIL_DOMAIN: "example.com",
        },
        d1Databases: ["DB"],
        serviceBindings: {
          ADMIN_READ_API: "control-plane-admin-read-mock",
        },
        workers: [
          {
            compatibilityDate: "2026-08-29",
            modules: true,
            name: "control-plane-admin-read-mock",
            script: `
              import { WorkerEntrypoint } from "cloudflare:workers";
              export default class AdminReadMock extends WorkerEntrypoint {
                async pingV1() {
                  return { schemaVersion: 1 };
                }
                async getRunDetailV2() {
                  return null;
                }
                async getRunDetailV3(args) {
                  if (!args?.runId || args.runId.includes("999999") || args.runId.includes("missing")) {
                    return null;
                  }
                  const runId = args.runId;
                  return {
                    cleanupTask: null,
                    currentFindings: [],
                    findingsPerspective: "both",
                    graphSchemaVersion: 1,
                    historicalRunFindings: [],
                    projectIdentification: null,
                    run: {
                      cost: null,
                      createdAt: "2026-09-04T11:00:00.000Z",
                      headSha: "a".repeat(40),
                      isDegraded: false,
                      prKey: "github:42:pr:7",
                      runId,
                      runState: "completed",
                      scopeStatus: "complete",
                      shardsCount: 1,
                      stepTimings: [],
                      terminalState: "completed",
                      tokens: null,
                      toolCallsCount: 0,
                      updatedAt: "2026-09-04T11:00:05.000Z",
                      verdict: "APPROVE",
                    },
                    schemaVersion: 3,
                    stepExecutions: [
                      {
                        attempts: [
                          {
                            attempt: 1,
                            durationMs: 25,
                            endedAt: "2026-09-04T11:00:01.025Z",
                            errorCode: null,
                            startedAt: "2026-09-04T11:00:01.000Z",
                            status: "completed",
                            waitBeforeRetryMs: null,
                          },
                        ],
                        attemptsCount: 1,
                        errorCode: null,
                        firstStartedAt: "2026-09-04T11:00:01.000Z",
                        lastEndedAt: "2026-09-04T11:00:01.025Z",
                        phase: "admission",
                        sanitizedInput: { runId: "github:42:pr:7:head:" + "a".repeat(40) },
                        sanitizedOutput: { outcome: "claimed" },
                        status: "completed",
                        stepName: "claim-run",
                        totalDurationMs: 25,
                      },
                    ],
                    structuredCi: null,
                  };
                }
              }
            `,
          },
        ],
      },
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    clearMocks: true,
    exclude: ["test/**/*.client.test.tsx"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    coverage: {
      include: ["app/**/*.{ts,tsx}", "workers/**/*.ts"],
      exclude: ["app/**/*.client.tsx", "app/entry.client.tsx"],
      provider: "istanbul",
      reporter: ["text", "json-summary", "html", "lcov"],
      thresholds: { branches: 85, functions: 90, lines: 90, statements: 90 },
    },
    mockReset: true,
    outputFile: {
      junit: "junit.xml",
    },
    reporters: ["default", "junit"],
    restoreMocks: true,
  },
});
