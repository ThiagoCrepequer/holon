import { reviewJobV2Schema, type ReviewContextV2 } from "@holon/contracts";
import type { RunId } from "@holon/domain";
import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { WorkflowStep } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeReviewWorkflow,
  parseAppId,
  type ReviewRuntime,
} from "../src/review-workflow.js";

afterEach(() => reset());

const job = reviewJobV2Schema.parse({
  envelope: {
    action: "opened",
    deliveryId: "github:delivery-123",
    event: "pull_request",
    installationId: 99,
    pullRequest: {
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
      number: 7,
      updatedAt: "2026-08-29T12:00:00.000Z",
    },
    receivedAt: "2026-08-29T12:00:01.000Z",
    repository: {
      fullName: "acme/api",
      id: 42,
      name: "api",
      owner: "acme",
    },
    schemaVersion: 2,
  },
  runId: `github:42:pr:7:head:${"a".repeat(40)}`,
  schemaVersion: 2,
});

const canonicalPatch = [
  "diff --git a/src/index.ts b/src/index.ts",
  "--- a/src/index.ts",
  "+++ b/src/index.ts",
  "@@ -9,0 +10,1 @@",
  "+return null;",
].join("\n");

const context: ReviewContextV2 = {
  changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
  files: [{ mode: "structural", patch: canonicalPatch, path: "src/index.ts" }],
  schemaVersion: 2,
  truncated: false,
};

const finding = {
  confidence: 0.95,
  diagnostic:
    "The changed return value breaks the caller's non-null runtime contract.",
  evidence: [
    {
      excerpt: "return null;",
      path: "src/index.ts",
      reason: "The new return is null",
      startLine: 10,
    },
  ],
  location: { line: 10, path: "src/index.ts", side: "RIGHT" as const },
  severity: "high" as const,
};

function immediateStep(stepNames: string[]): WorkflowStep {
  return {
    do: async <T>(
      name: string,
      configOrCallback: unknown,
      maybeCallback?: unknown,
    ): Promise<T> => {
      stepNames.push(name);
      const callback =
        typeof configOrCallback === "function"
          ? configOrCallback
          : maybeCallback;
      if (typeof callback !== "function") throw new TypeError("callback");
      return await (callback as () => Promise<T>)();
    },
  } as unknown as WorkflowStep;
}

function session(
  posts: Array<{ readonly route: string; readonly body: unknown }>,
  readHead: () => string = () => "a".repeat(40),
) {
  return {
    api: {
      async *iterate() {
        yield [];
      },
      request: (route: string, parameters: Record<string, unknown>) => {
        posts.push({ body: parameters.body, route });
        return Promise.resolve({ data: { id: posts.length } });
      },
    },
    currentHeadSha: () => Promise.resolve(readHead()),
    expectedAuthorLogin: "holon-reviewer[bot]",
    expiresAt: "2026-08-29T13:00:00.000Z",
    pullRequestDiff: () => Promise.resolve(canonicalPatch),
    token: "installation-token-long-enough",
  };
}

function runtime(
  options: {
    readonly containerId?: string | null;
    readonly context?: ReviewContextV2;
    readonly head?: () => string;
    readonly model?: ReviewRuntime["createModel"];
    readonly posts?: Array<{ readonly route: string; readonly body: unknown }>;
  } = {},
) {
  const posts = options.posts ?? [];
  const cleanup = vi.fn(() => Promise.resolve());
  const resolvedContainerId = options.containerId ?? "f".repeat(64);
  const resolveContainerId = vi.fn(() => Promise.resolve(resolvedContainerId));
  const prepareRepositoryV2 = vi.fn(() =>
    Promise.resolve({
      changedLineCount: (options.context ?? context).changedLines.length,
      contextBytes: 100,
      fileCount: (options.context ?? context).files.length,
      runId: job.runId,
      schemaVersion: 2 as const,
      truncated: false,
    }),
  );
  const value: ReviewRuntime = {
    createModel:
      options.model ??
      (() => ({
        review: () =>
          Promise.resolve({
            output: { findings: [finding], summary: "One regression found." },
            promptTruncated: false,
          }),
      })),
    createSession: () => Promise.resolve(session(posts, options.head)),
    executor: {
      cleanup,
      hasContext: () => Promise.resolve(true),
      loadContextV2: () => Promise.resolve(options.context ?? context),
      prepareRepositoryV2,
      ...(options.containerId === null ? {} : { resolveContainerId }),
      runTool: () => Promise.resolve({ content: "", truncated: false }),
    },
    logger: { emit: () => undefined },
    now: () => "2026-08-29T12:00:05.000Z",
    wait: () => Promise.resolve(),
  };
  return { cleanup, posts, prepareRepositoryV2, resolveContainerId, value };
}

function event(instanceId: string) {
  return {
    instanceId,
    payload: job,
    timestamp: new Date("2026-08-29T12:00:00.000Z"),
    workflowName: "holon-review-workflow",
  };
}

describe("ReviewWorkflow", () => {
  it("registers the real Durable Object ID resolved by the executor", async () => {
    const setup = runtime();

    await expect(
      executeReviewWorkflow(
        env,
        event("platform-container-identity"),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toEqual({ findingsPublished: 1, outcome: "completed" });

    expect(setup.resolveContainerId).toHaveBeenCalledWith(job.runId);
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await runInDurableObject(ledger, (_object, state) => {
      expect(
        state.storage.sql
          .exec<{ container_id: string }>(
            "SELECT container_id FROM credential_scopes WHERE run_id = ?",
            job.runId,
          )
          .one().container_id,
      ).toBe("f".repeat(64));
    });
  });

  it("keeps the N-1 logical-name fallback limited to a missing RPC method", async () => {
    const setup = runtime({ containerId: null });

    await expect(
      executeReviewWorkflow(
        env,
        event("legacy-container-identity"),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toEqual({ findingsPublished: 1, outcome: "completed" });

    expect(setup.resolveContainerId).not.toHaveBeenCalled();
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await runInDurableObject(ledger, (_object, state) => {
      expect(
        state.storage.sql
          .exec<{ container_id: string }>(
            "SELECT container_id FROM credential_scopes WHERE run_id = ?",
            job.runId,
          )
          .one().container_id,
      ).toBe(`r-16-7-${"a".repeat(40)}`);
    });
  });

  it("fails closed when the executor returns a malformed platform ID", async () => {
    const setup = runtime({ containerId: "not-a-durable-object-id" });

    await expect(
      executeReviewWorkflow(
        env,
        event("malformed-container-identity"),
        immediateStep([]),
        setup.value,
      ),
    ).rejects.toThrow("Executor returned an invalid container ID");
    expect(setup.prepareRepositoryV2).not.toHaveBeenCalled();
  });

  it("publishes with fresh ledger and head authorization before each mutation", async () => {
    const stepNames: string[] = [];
    let headReads = 0;
    const setup = runtime({
      head: () => {
        headReads += 1;
        return "a".repeat(40);
      },
    });

    await expect(
      executeReviewWorkflow(
        env,
        event("complete-workflow"),
        immediateStep(stepNames),
        setup.value,
      ),
    ).resolves.toEqual({ findingsPublished: 1, outcome: "completed" });

    expect(headReads).toBe(4);
    expect(setup.posts.map((post) => post.route)).toEqual([
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments",
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
    ]);
    expect(setup.cleanup).not.toHaveBeenCalled();
    expect(stepNames).toContain("complete-run-and-schedule-cleanup");
    expect(stepNames.some((name) => name.startsWith("cleanup-"))).toBe(false);
    await expect(
      env.REVIEW_LEDGERS.getByName("github:42:pr:7").cleanupState(
        job.runId as RunId,
      ),
    ).resolves.toMatchObject({ state: "pending" });
  });

  it("stops between GitHub mutations when the head becomes stale", async () => {
    let headReads = 0;
    const setup = runtime({
      head: () => {
        headReads += 1;
        return headReads < 4 ? "a".repeat(40) : "c".repeat(40);
      },
    });

    await expect(
      executeReviewWorkflow(
        env,
        event("stale-during-publication"),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toEqual({ findingsPublished: 0, outcome: "obsolete" });
    expect(setup.posts).toHaveLength(1);
    expect(setup.posts[0]?.route).toContain("/comments");
    expect(
      setup.posts.some((post) =>
        String(post.body).includes("could not complete"),
      ),
    ).toBe(false);
  });

  it("does not persist a credential scope when the initial head is stale", async () => {
    const setup = runtime({ head: () => "c".repeat(40) });

    await expect(
      executeReviewWorkflow(
        env,
        event("stale-before-preparation"),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toEqual({ findingsPublished: 0, outcome: "obsolete" });
    expect(setup.prepareRepositoryV2).not.toHaveBeenCalled();
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await runInDurableObject(ledger, (_object, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM credential_scopes WHERE run_id = ?",
            job.runId,
          )
          .one().count,
      ).toBe(0);
    });
  });

  it("becomes obsolete when the head changes before the first publication", async () => {
    let headReads = 0;
    const setup = runtime({
      head: () => {
        headReads += 1;
        return headReads === 1 ? "a".repeat(40) : "c".repeat(40);
      },
    });

    await expect(
      executeReviewWorkflow(
        env,
        event("stale-before-publication"),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toEqual({ findingsPublished: 0, outcome: "obsolete" });
    expect(setup.posts).toHaveLength(0);
  });

  it("skips the model for a context with no eligible files", async () => {
    const review = vi.fn();
    const setup = runtime({
      context: {
        changedLines: [],
        files: [],
        schemaVersion: 2,
        truncated: false,
      },
      model: () => ({ review }),
    });

    await expect(
      executeReviewWorkflow(
        env,
        event("no-eligible-files"),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toMatchObject({ outcome: "completed" });
    expect(review).not.toHaveBeenCalled();
    expect(setup.posts[0]?.body).toContain("No eligible changes were found");
  });

  it("returns duplicate without rerunning a completed head", async () => {
    const first = runtime();
    await executeReviewWorkflow(
      env,
      event("first-completed-instance"),
      immediateStep([]),
      first.value,
    );
    const duplicate = runtime();

    await expect(
      executeReviewWorkflow(
        env,
        event("redelivered-instance"),
        immediateStep([]),
        duplicate.value,
      ),
    ).resolves.toEqual({ findingsPublished: 0, outcome: "duplicate" });
    expect(duplicate.prepareRepositoryV2).not.toHaveBeenCalled();
  });

  it("reprepares lost model context with fresh sessions and a bounded retry", async () => {
    const posts: Array<{ readonly route: string; readonly body: unknown }> = [];
    let contextExists = true;
    let sessions = 0;
    let preparations = 0;
    const waits: number[] = [];
    const setup = runtime({
      model: (toolRunner) => ({
        review: async () => {
          contextExists = false;
          await toolRunner.run({
            arguments: { maxResults: 1, query: "return" },
            name: "search_text",
          });
          return {
            output: { findings: [], summary: "No finding." },
            promptTruncated: false,
          };
        },
      }),
      posts,
    });
    setup.value = {
      ...setup.value,
      createSession: () => {
        sessions += 1;
        return Promise.resolve(session(posts));
      },
      executor: {
        ...setup.value.executor!,
        hasContext: () => Promise.resolve(contextExists),
        prepareRepositoryV2: () => {
          preparations += 1;
          if (preparations === 2) {
            const error = new Error(
              "HOLON_REPOSITORY_TRANSIENT:fetch:timed-out",
            );
            error.name = "RepositoryTransientError";
            return Promise.reject(error);
          }
          contextExists = true;
          return Promise.resolve({
            changedLineCount: 1,
            contextBytes: 100,
            fileCount: 1,
            runId: job.runId,
            schemaVersion: 2 as const,
            truncated: false,
          });
        },
      },
      wait: (delay) => {
        waits.push(delay);
        return Promise.resolve();
      },
    };

    await expect(
      executeReviewWorkflow(
        env,
        event("reprepare-context"),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toMatchObject({ outcome: "completed" });
    expect(preparations).toBe(3);
    expect(sessions).toBeGreaterThanOrEqual(6);
    expect(waits).toEqual([1_000]);
  });

  it("renders summary-only findings deterministically instead of dropping them", async () => {
    const posts: Array<{ readonly route: string; readonly body: unknown }> = [];
    const setup = runtime({
      model: () => ({
        review: () =>
          Promise.resolve({
            output: {
              findings: [{ ...finding, severity: "low" as const }],
              summary: "Review complete.",
            },
            promptTruncated: false,
          }),
      }),
      posts,
    });

    await executeReviewWorkflow(
      env,
      event("low-summary"),
      immediateStep([]),
      setup.value,
    );
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toContain("Low-severity observations:");
    expect(posts[0]?.body).toContain(finding.diagnostic);
  });

  it("does not publish a failure notice when the failed run is no longer fresh", async () => {
    let headReads = 0;
    const setup = runtime({
      head: () => {
        headReads += 1;
        return headReads === 1 ? "a".repeat(40) : "d".repeat(40);
      },
      model: () => ({
        review: () => Promise.reject(new Error("model unavailable")),
      }),
    });

    await expect(
      executeReviewWorkflow(
        env,
        event("failed-stale"),
        immediateStep([]),
        setup.value,
      ),
    ).rejects.toThrow("model unavailable");
    expect(setup.posts).toHaveLength(0);
    await expect(
      env.REVIEW_LEDGERS.getByName("github:42:pr:7").runState(
        job.runId as RunId,
      ),
    ).resolves.toBe("failed_terminal");
  });

  it("emits deterministic event ids and transition-based durations", async () => {
    const events: Array<{
      readonly event: string;
      readonly fields: Readonly<Record<string, unknown>>;
    }> = [];
    const setup = runtime();
    setup.value = {
      ...setup.value,
      logger: {
        emit: (name, fields) => events.push({ event: name, fields }),
      },
    };
    await executeReviewWorkflow(
      env,
      event("observable-workflow"),
      immediateStep([]),
      setup.value,
    );

    const completed = events.find(
      (entry) => entry.event === "review.completed",
    );
    expect(completed?.fields).toMatchObject({
      durationMs: 5_000,
      eventId: "observable-workflow:review.completed",
    });
    expect(
      events.every((entry) => typeof entry.fields.eventId === "string"),
    ).toBe(true);
  });

  it("validates the GitHub App identifier", () => {
    expect(parseAppId("123")).toBe(123);
    expect(() => parseAppId("0")).toThrow("positive integer");
    expect(() => parseAppId("not-a-number")).toThrow("positive integer");
  });
});
