import { reviewJobSchema } from "@holon/contracts";
import type { ReviewRun, RunId } from "@holon/domain";
import { introspectWorkflowInstance, reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { WorkflowStep } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

import {
  executeReviewJob,
  executeReviewWorkflow,
  markReviewTerminal,
  parseAppId,
} from "../src/review-workflow.js";

afterEach(() => reset());

const job = reviewJobSchema.parse({
  envelope: {
    action: "opened",
    deliveryId: "github:delivery-123",
    event: "pull_request",
    installationId: 99,
    pullRequest: {
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
      number: 7,
    },
    receivedAt: "2026-08-29T12:00:00.000Z",
    repository: { fullName: "acme/api", id: 42, name: "api", owner: "acme" },
    schemaVersion: 1,
  },
  runId: `github:42:pr:7:head:${"a".repeat(40)}`,
  schemaVersion: 1,
});

function immediateWorkflowStep(
  stepNames: string[],
  failingSteps: ReadonlySet<string> = new Set(),
  replaySteps: ReadonlySet<string> = new Set(),
): WorkflowStep {
  return {
    do: async <T>(
      name: string,
      configOrCallback: unknown,
      maybeCallback?: unknown,
    ): Promise<T> => {
      stepNames.push(name);
      if (failingSteps.has(name)) throw new Error(`${name} failed`);
      const callback =
        typeof configOrCallback === "function"
          ? configOrCallback
          : maybeCallback;
      if (typeof callback !== "function") throw new TypeError("callback");
      const result = await (callback as () => Promise<T>)();
      if (replaySteps.has(name)) await (callback as () => Promise<T>)();
      return result;
    },
  } as unknown as WorkflowStep;
}

describe("ReviewWorkflow", () => {
  it("runs the durable step and exits without credentials or executor calls for a duplicate run", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await ledger.claimRun(
      {
        attempt: 0,
        createdAt: job.envelope.receivedAt,
        id: job.runId as RunId,
        prKey: "github:42:pr:7",
        state: "queued",
      } satisfies ReviewRun,
      "existing-workflow",
    );
    const instance = await introspectWorkflowInstance(
      env.REVIEW_WORKFLOW,
      "duplicate-run",
    );
    try {
      await env.REVIEW_WORKFLOW.create({ id: "duplicate-run", params: job });
      await instance.waitForStatus("complete");
      await expect(instance.getOutput()).resolves.toEqual({
        findingsPublished: 0,
        outcome: "duplicate",
      });
    } finally {
      await instance.dispose();
    }
  });

  it("composes executor, model, Durable Object ledger and GitHub publication", async () => {
    const calls: string[] = [];
    let githubId = 100;
    const result = await executeReviewJob(env, job, {
      createModel: (toolRunner) => ({
        review: async () => {
          await toolRunner.run({
            arguments: { maxResults: 1, query: "result" },
            name: "search_text",
          });
          return {
            findings: [
              {
                confidence: 0.95,
                diagnostic:
                  "The changed return value breaks the unchanged caller contract at runtime.",
                evidence: [
                  {
                    excerpt: "result.id",
                    path: "src/caller.ts",
                    reason: "No null guard",
                    startLine: 20,
                  },
                ],
                location: { line: 10, path: "src/index.ts", side: "RIGHT" },
                severity: "high",
                suggestion: "Preserve the non-null contract.",
              },
            ],
            summary: "One contract regression found.",
          };
        },
      }),
      createSession: () =>
        Promise.resolve({
          api: {
            paginate: () => Promise.resolve([]),
            request: (route) => {
              calls.push(route);
              return Promise.resolve({ data: { id: ++githubId } });
            },
          },
          currentHeadSha: () => Promise.resolve("a".repeat(40)),
          expiresAt: "2026-08-29T13:00:00.000Z",
          token: "installation-token",
        }),
      executor: {
        cleanup: () => {
          calls.push("cleanup");
          return Promise.resolve();
        },
        hasContext: () => Promise.resolve(true),
        loadContext: () =>
          Promise.resolve({
            changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
            diff: "@@ -9,0 +10,1 @@\n+return null;",
          }),
        prepare: () =>
          Promise.resolve({
            changedLineCount: 1,
            contextBytes: 100,
            fileCount: 1,
            runId: job.runId,
            schemaVersion: 1 as const,
            truncated: false,
          }),
        runTool: () => {
          calls.push("tool");
          return Promise.resolve({
            content: "src/caller.ts:20:result.id",
            truncated: false,
          });
        },
      },
      now: () => "2026-08-29T12:00:01.000Z",
    });

    expect(result).toEqual({ findingsPublished: 1, outcome: "completed" });
    expect(calls).toEqual([
      "tool",
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments",
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      "cleanup",
    ]);
  });

  it("checkpoints the production review as granular, bounded durable steps", async () => {
    const stepNames: string[] = [];
    const fakeStep = immediateWorkflowStep(
      stepNames,
      new Set(),
      new Set(["start-run", "begin-publication", "complete-run"]),
    );
    let githubId = 200;
    const result = await executeReviewWorkflow(
      env,
      {
        instanceId: "granular-workflow",
        payload: job,
        timestamp: new Date("2026-08-29T12:00:00.000Z"),
        workflowName: "holon-review-workflow",
      },
      fakeStep,
      {
        createModel: () => ({
          review: () =>
            Promise.resolve({
              findings: [
                {
                  confidence: 0.95,
                  diagnostic:
                    "The changed return value breaks the unchanged caller contract at runtime.",
                  evidence: [
                    {
                      excerpt: "result.id",
                      path: "src/caller.ts",
                      reason: "No null guard",
                      startLine: 20,
                    },
                  ],
                  location: {
                    line: 10,
                    path: "src/index.ts",
                    side: "RIGHT" as const,
                  },
                  severity: "high" as const,
                },
              ],
              summary: "One contract regression found.",
            }),
        }),
        createSession: () =>
          Promise.resolve({
            api: {
              paginate: () => Promise.resolve([]),
              request: () => Promise.resolve({ data: { id: ++githubId } }),
            },
            currentHeadSha: () => Promise.resolve("a".repeat(40)),
            expiresAt: "2026-08-29T13:00:00.000Z",
            token: "installation-token",
          }),
        executor: {
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          loadContext: () =>
            Promise.resolve({
              changedLines: [
                { line: 10, path: "src/index.ts", side: "RIGHT" as const },
              ],
              diff: "@@ -9,0 +10,1 @@\n+return null;",
            }),
          prepare: () =>
            Promise.resolve({
              changedLineCount: 1,
              contextBytes: 100,
              fileCount: 1,
              runId: job.runId,
              schemaVersion: 1 as const,
              truncated: false,
            }),
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
        now: () => "2026-08-29T12:00:01.000Z",
      },
    );

    expect(result).toEqual({ findingsPublished: 1, outcome: "completed" });
    expect(stepNames).toEqual([
      "claim-run",
      "start-run",
      "prepare-repository",
      "analyze-review",
      "begin-publication",
      "revalidate-current-head",
      "publish-inline-1",
      "publish-summary",
      "complete-run",
      "cleanup-completed-repository",
    ]);
    expect(stepNames).not.toContain("execute-review");
  });

  it("reconstructs an ephemeral context lost between durable checkpoints", async () => {
    const stepNames: string[] = [];
    let prepareCalls = 0;
    let contextExists = false;

    const result = await executeReviewWorkflow(
      env,
      {
        instanceId: "recovered-sandbox-workflow",
        payload: job,
        timestamp: new Date("2026-08-29T12:00:00.000Z"),
        workflowName: "holon-review-workflow",
      },
      immediateWorkflowStep(stepNames),
      {
        createModel: () => ({
          review: () =>
            Promise.resolve({ findings: [], summary: "No findings." }),
        }),
        createSession: () =>
          Promise.resolve({
            api: {
              paginate: () => Promise.resolve([]),
              request: () => Promise.resolve({ data: { id: 1 } }),
            },
            currentHeadSha: () => Promise.resolve("a".repeat(40)),
            expiresAt: "later",
            token: "token",
          }),
        executor: {
          cleanup: () => Promise.resolve(),
          hasContext: () => {
            if (prepareCalls === 1) contextExists = false;
            return Promise.resolve(contextExists);
          },
          loadContext: () => Promise.resolve({ changedLines: [], diff: "" }),
          prepare: () => {
            prepareCalls += 1;
            contextExists = true;
            return Promise.resolve({
              changedLineCount: 0,
              contextBytes: 10,
              fileCount: 0,
              runId: job.runId,
              schemaVersion: 1 as const,
              truncated: false,
            });
          },
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
        now: () => "2026-08-29T12:00:01.000Z",
      },
    );

    expect(result).toEqual({ findingsPublished: 0, outcome: "completed" });
    expect(prepareCalls).toBe(2);
  });

  it("terminalizes and cleans a prepared review after durable retries are exhausted", async () => {
    const stepNames: string[] = [];
    let cleaned = false;
    await expect(
      executeReviewWorkflow(
        env,
        {
          instanceId: "failing-workflow",
          payload: job,
          timestamp: new Date("2026-08-29T12:00:00.000Z"),
          workflowName: "holon-review-workflow",
        },
        immediateWorkflowStep(stepNames),
        {
          createModel: () => ({
            review: () => Promise.reject(new Error("model unavailable")),
          }),
          createSession: () =>
            Promise.resolve({
              api: {
                paginate: () => Promise.resolve([]),
                request: () => Promise.resolve({ data: { id: 1 } }),
              },
              currentHeadSha: () => Promise.resolve("a".repeat(40)),
              expiresAt: "2026-08-29T13:00:00.000Z",
              token: "installation-token",
            }),
          executor: {
            cleanup: () => {
              cleaned = true;
              return Promise.resolve();
            },
            hasContext: () => Promise.resolve(true),
            loadContext: () =>
              Promise.resolve({
                changedLines: [
                  { line: 10, path: "src/index.ts", side: "RIGHT" as const },
                ],
                diff: "@@ -9,0 +10,1 @@\n+return null;",
              }),
            prepare: () =>
              Promise.resolve({
                changedLineCount: 1,
                contextBytes: 100,
                fileCount: 1,
                runId: job.runId,
                schemaVersion: 1 as const,
                truncated: false,
              }),
            runTool: () => Promise.resolve({ content: "", truncated: false }),
          },
          now: () => "2026-08-29T12:00:01.000Z",
        },
      ),
    ).rejects.toThrow("model unavailable");

    expect(cleaned).toBe(true);
    expect(stepNames).toContain("mark-review-terminal");
    expect(stepNames).toContain("cleanup-failed-repository");
    await expect(
      env.REVIEW_LEDGERS.getByName("github:42:pr:7").runState(
        job.runId as RunId,
      ),
    ).resolves.toBe("failed_terminal");
  });

  it("records terminalization and cleanup failures without hiding the causal error", async () => {
    const stepNames: string[] = [];
    const events: string[] = [];
    await expect(
      executeReviewWorkflow(
        env,
        {
          instanceId: "double-failure-workflow",
          payload: job,
          timestamp: new Date("2026-08-29T12:00:00.000Z"),
          workflowName: "holon-review-workflow",
        },
        immediateWorkflowStep(
          stepNames,
          new Set(["mark-review-terminal", "cleanup-failed-repository"]),
        ),
        {
          createModel: () => ({
            review: () => Promise.reject(new TypeError("causal model error")),
          }),
          createSession: () =>
            Promise.resolve({
              api: {
                paginate: () => Promise.resolve([]),
                request: () => Promise.resolve({ data: { id: 1 } }),
              },
              currentHeadSha: () => Promise.resolve("a".repeat(40)),
              expiresAt: "later",
              token: "token",
            }),
          executor: {
            cleanup: () => Promise.resolve(),
            hasContext: () => Promise.resolve(true),
            loadContext: () => Promise.resolve({ changedLines: [], diff: "" }),
            prepare: () =>
              Promise.resolve({
                changedLineCount: 0,
                contextBytes: 10,
                fileCount: 0,
                runId: job.runId,
                schemaVersion: 1 as const,
                truncated: false,
              }),
            runTool: () => Promise.resolve({ content: "", truncated: false }),
          },
          logger: { emit: (event) => events.push(event) },
          now: () => "2026-08-29T12:00:01.000Z",
        },
      ),
    ).rejects.toThrow("causal model error");

    expect(events).toContain("review.terminalization_failed");
    expect(events).toContain("review.cleanup_failed");
  });

  it("fails closed when a claimed run is missing from the ledger", async () => {
    let cleaned = false;
    const baseStep = immediateWorkflowStep([]) as unknown as {
      do<T>(
        name: string,
        config: unknown,
        callback: () => Promise<T>,
      ): Promise<T>;
    };
    const inconsistentStep = {
      do: <T>(name: string, config: unknown, callback: () => Promise<T>) =>
        name === "claim-run"
          ? Promise.resolve("claimed" as T)
          : baseStep.do(name, config, callback),
    } as unknown as WorkflowStep;

    await expect(
      executeReviewWorkflow(
        env,
        {
          instanceId: "missing-ledger-run",
          payload: job,
          timestamp: new Date("2026-08-29T12:00:00.000Z"),
          workflowName: "holon-review-workflow",
        },
        inconsistentStep,
        {
          createModel: () => ({
            review: () =>
              Promise.resolve({ findings: [], summary: "No findings." }),
          }),
          executor: {
            cleanup: () => {
              cleaned = true;
              return Promise.resolve();
            },
            hasContext: () => Promise.resolve(true),
            loadContext: () => Promise.resolve({ changedLines: [], diff: "" }),
            prepare: () => Promise.reject(new Error("must not prepare")),
            runTool: () => Promise.resolve({ content: "", truncated: false }),
          },
          logger: { emit: () => undefined },
          now: () => "2026-08-29T12:00:01.000Z",
        },
      ),
    ).rejects.toThrow("cannot start from missing");
    expect(cleaned).toBe(false);
  });

  it("marks a review obsolete and cleans up when the live head changed", async () => {
    const stepNames: string[] = [];
    let cleaned = false;
    const result = await executeReviewWorkflow(
      env,
      {
        instanceId: "obsolete-workflow",
        payload: job,
        timestamp: new Date("2026-08-29T12:00:00.000Z"),
        workflowName: "holon-review-workflow",
      },
      immediateWorkflowStep(stepNames),
      {
        createModel: () => ({
          review: () =>
            Promise.resolve({ findings: [], summary: "No findings." }),
        }),
        createSession: () =>
          Promise.resolve({
            api: {
              paginate: () => Promise.resolve([]),
              request: () => Promise.resolve({ data: { id: 1 } }),
            },
            currentHeadSha: () => Promise.resolve("c".repeat(40)),
            expiresAt: "later",
            token: "token",
          }),
        executor: {
          cleanup: () => {
            cleaned = true;
            return Promise.resolve();
          },
          hasContext: () => Promise.resolve(true),
          loadContext: () => Promise.resolve({ changedLines: [], diff: "" }),
          prepare: () =>
            Promise.resolve({
              changedLineCount: 0,
              contextBytes: 10,
              fileCount: 0,
              runId: job.runId,
              schemaVersion: 1 as const,
              truncated: false,
            }),
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
        now: () => "2026-08-29T12:00:01.000Z",
      },
    );

    expect(result).toEqual({ findingsPublished: 0, outcome: "obsolete" });
    expect(cleaned).toBe(true);
    expect(stepNames).toContain("mark-obsolete");
    expect(stepNames).toContain("cleanup-obsolete-repository");
  });

  it("cleans up a prepared repository when its returned contract is invalid", async () => {
    let cleaned = false;
    await expect(
      executeReviewJob(env, job, {
        createSession: () =>
          Promise.resolve({
            api: {
              paginate: () => Promise.resolve([]),
              request: () => Promise.resolve({ data: { id: 1 } }),
            },
            currentHeadSha: () => Promise.resolve("a".repeat(40)),
            expiresAt: "later",
            token: "token",
          }),
        executor: {
          cleanup: () => {
            cleaned = true;
            return Promise.resolve();
          },
          hasContext: () => Promise.resolve(true),
          loadContext: () =>
            Promise.resolve({
              changedLines: [],
              diff: "",
              surface: [
                {
                  change: "added",
                  excerpt: "unsafe",
                  kind: "security",
                  line: 1,
                  path: "../escape",
                },
              ],
            } as never),
          prepare: () =>
            Promise.resolve({
              changedLineCount: 0,
              contextBytes: 10,
              fileCount: 1,
              runId: job.runId,
              schemaVersion: 1 as const,
              truncated: false,
            }),
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
      }),
    ).rejects.toThrow();
    expect(cleaned).toBe(true);
  });

  it("terminalizes an exhausted retryable run and safely ignores an absent run", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    const retryableRun = {
      attempt: 1,
      createdAt: job.envelope.receivedAt,
      id: job.runId as RunId,
      prKey: "github:42:pr:7",
      state: "failed_retryable",
    } satisfies ReviewRun;
    await ledger.claimRun(retryableRun, "terminal-test");
    await markReviewTerminal(env, job, () => "2026-08-29T12:05:00.000Z");
    await expect(ledger.claimRun(retryableRun, "terminal-test")).resolves.toBe(
      "duplicate",
    );

    const absent = reviewJobSchema.parse({
      ...job,
      envelope: {
        ...job.envelope,
        pullRequest: { ...job.envelope.pullRequest, number: 8 },
      },
      runId: `github:42:pr:8:head:${"a".repeat(40)}`,
    });
    await expect(markReviewTerminal(env, absent)).resolves.toBeUndefined();
  });

  it("validates the GitHub App identifier", () => {
    expect(parseAppId("123")).toBe(123);
    expect(() => parseAppId("0")).toThrow("positive integer");
  });
});
