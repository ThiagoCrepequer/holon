import { createReviewRun } from "@holon/application";
import {
  reviewJobV2Schema,
  type ReviewContextV2,
  type ReviewJob,
} from "@holon/contracts";
import type { RunId } from "@holon/domain";
import { identifySnapshot } from "@holon/project-identification";
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

function immediateStep(
  stepNames: string[],
  afterStep?: (name: string) => Promise<void>,
  stepErrors?: Record<string, Error>,
): WorkflowStep {
  return {
    sleep: async (name: string) => {
      stepNames.push(name);
      await afterStep?.(name);
    },
    do: async <T>(
      name: string,
      configOrCallback: unknown,
      maybeCallback?: unknown,
    ): Promise<T> => {
      stepNames.push(name);
      if (stepErrors?.[name]) throw stepErrors[name];
      const callback =
        typeof configOrCallback === "function"
          ? configOrCallback
          : maybeCallback;
      if (typeof callback !== "function") throw new TypeError("callback");
      const result = await (callback as () => Promise<T>)();
      await afterStep?.(name);
      return result;
    },
  } as unknown as WorkflowStep;
}

function session(
  posts: Array<{
    readonly body: unknown;
    readonly event?: unknown;
    readonly route: string;
  }>,
  readHead: () => string = () => "a".repeat(40),
) {
  return {
    api: {
      async *iterate() {
        yield [];
      },
      request: (route: string, parameters: Record<string, unknown>) => {
        posts.push({ body: parameters.body, event: parameters.event, route });
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
    readonly logger?: ReviewRuntime["logger"];
    readonly model?: ReviewRuntime["createModel"];
    readonly now?: ReviewRuntime["now"];
    readonly posts?: Array<{
      readonly body: unknown;
      readonly event?: unknown;
      readonly route: string;
    }>;
    readonly workflow?: ReviewRuntime["workflow"];
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
    logger: options.logger ?? { emit: () => undefined },
    now: options.now ?? (() => "2026-08-29T12:00:05.000Z"),
    wait: () => Promise.resolve(),
    ...(options.workflow === undefined ? {} : { workflow: options.workflow }),
  };
  return { cleanup, posts, prepareRepositoryV2, resolveContainerId, value };
}

function event(instanceId: string, customJob: ReviewJob = job) {
  return {
    instanceId,
    payload: customJob,
    timestamp: new Date("2026-08-29T12:00:00.000Z"),
    workflowName: "holon-review-workflow",
  };
}

describe("ReviewWorkflow", () => {
  it("registers the real Durable Object ID resolved by the executor", async () => {
    const setup = runtime();
    let registeredContainerId: string | undefined;

    await expect(
      executeReviewWorkflow(
        env,
        event("platform-container-identity"),
        immediateStep([], async (name) => {
          if (name !== "prepare-repository") return;
          const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
          await runInDurableObject(ledger, (_object, state) => {
            registeredContainerId = state.storage.sql
              .exec<{ container_id: string }>(
                "SELECT container_id FROM credential_scopes WHERE run_id = ?",
                job.runId,
              )
              .one().container_id;
          });
        }),
        setup.value,
      ),
    ).resolves.toEqual({ findingsPublished: 1, outcome: "completed" });

    expect(setup.resolveContainerId).toHaveBeenCalledWith(job.runId);
    expect(registeredContainerId).toBe("f".repeat(64));
  });

  it("keeps the N-1 logical-name fallback limited to a missing RPC method", async () => {
    const setup = runtime({ containerId: null });
    let registeredContainerId: string | undefined;

    await expect(
      executeReviewWorkflow(
        env,
        event("legacy-container-identity"),
        immediateStep([], async (name) => {
          if (name !== "prepare-repository") return;
          const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
          await runInDurableObject(ledger, (_object, state) => {
            registeredContainerId = state.storage.sql
              .exec<{ container_id: string }>(
                "SELECT container_id FROM credential_scopes WHERE run_id = ?",
                job.runId,
              )
              .one().container_id;
          });
        }),
        setup.value,
      ),
    ).resolves.toEqual({ findingsPublished: 1, outcome: "completed" });

    expect(setup.resolveContainerId).not.toHaveBeenCalled();
    expect(registeredContainerId).toBe(`r-16-7-${"a".repeat(40)}`);
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

    expect(headReads).toBe(5);
    expect(setup.posts.map((post) => post.route)).toEqual([
      "POST /repos/{owner}/{repo}/check-runs",
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments",
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
    ]);
    expect(setup.cleanup).not.toHaveBeenCalled();
    expect(stepNames).toContain("complete-run-and-schedule-cleanup");
    expect(stepNames.some((name) => name.startsWith("cleanup-"))).toBe(false);
    await expect(
      env.REVIEW_LEDGERS.getByName("github:42:pr:7").cleanupState(
        job.runId as RunId,
      ),
    ).resolves.toMatchObject({
      state: expect.stringMatching(/^(pending|completed)$/),
    });
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
    expect(setup.posts.map((post) => post.route)).toEqual([
      "POST /repos/{owner}/{repo}/check-runs",
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments",
      "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
    ]);
    expect(
      setup.posts.some((post) =>
        String(post.body).includes("could not complete"),
      ),
    ).toBe(false);
  });

  it("cancels instead of publishing a terminal result when refs change immediately before the Check Run update", async () => {
    let headReads = 0;
    const currentHead = () => {
      headReads += 1;
      return headReads < 5 ? "a".repeat(40) : "c".repeat(40);
    };
    const setup = runtime({ head: currentHead });
    const checkRunConclusions: unknown[] = [];
    setup.value = {
      ...setup.value,
      createSession: () => {
        const installation = session(setup.posts, currentHead);
        const request = installation.api.request;
        return Promise.resolve({
          ...installation,
          api: {
            ...installation.api,
            request: (route: string, parameters: Record<string, unknown>) => {
              if (route.startsWith("PATCH") && route.includes("check-runs")) {
                checkRunConclusions.push(parameters.conclusion);
              }
              return request(route, parameters);
            },
          },
        });
      },
    };

    await expect(
      executeReviewWorkflow(
        env,
        event("stale-before-terminal-check-run"),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toEqual({ findingsPublished: 0, outcome: "obsolete" });
    expect(checkRunConclusions).toEqual(["cancelled"]);
  });

  it("creates and fails a Check Run for an invalid repository policy without persisting raw YAML errors", async () => {
    const setup = runtime();
    const checkRunConclusions: unknown[] = [];
    setup.value = {
      ...setup.value,
      createSession: () => {
        const installation = session(setup.posts);
        const request = installation.api.request;
        return Promise.resolve({
          ...installation,
          api: {
            ...installation.api,
            request: (route: string, parameters: Record<string, unknown>) => {
              if (route.startsWith("PATCH") && route.includes("check-runs")) {
                checkRunConclusions.push(parameters.conclusion);
              }
              return request(route, parameters);
            },
          },
          readRepositoryPolicyFile: async (
            _owner: string,
            _repo: string,
            _baseSha: string,
            path: string,
          ) =>
            path === ".github/holon.yml"
              ? {
                  content: "version: [secret-invalid-value",
                  rawBytes: new TextEncoder().encode(
                    "version: [secret-invalid-value",
                  ),
                }
              : undefined,
        });
      },
    };

    await expect(
      executeReviewWorkflow(
        env,
        event("invalid-policy-check-run"),
        immediateStep([]),
        setup.value,
      ),
    ).rejects.toMatchObject({ name: "NonRetryableError" });

    expect(setup.posts[0]?.route).toBe("POST /repos/{owner}/{repo}/check-runs");
    expect(checkRunConclusions).toEqual(["failure"]);
    expect(JSON.stringify(setup.posts)).not.toContain("secret-invalid-value");
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

  it("actively terminates a superseded workflow only after durable causal handoff", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    const oldRun = createReviewRun(job);
    await ledger.claimRun(oldRun, "superseded-workflow");
    await ledger.transition(
      oldRun.id,
      "queued",
      "running",
      "2026-08-29T12:00:02.000Z",
      "superseded-workflow:start",
    );
    await ledger.registerCredentialScope({
      containerId: "f".repeat(64),
      installationId: 99,
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      runId: oldRun.id,
    });

    const newerJob = reviewJobV2Schema.parse({
      ...job,
      envelope: {
        ...job.envelope,
        action: "synchronize",
        deliveryId: "github:delivery-newer",
        pullRequest: {
          ...job.envelope.pullRequest,
          headSha: "b".repeat(40),
          updatedAt: "2026-08-29T12:01:00.000Z",
        },
        receivedAt: "2026-08-29T12:01:01.000Z",
      },
      runId: `github:42:pr:7:head:${"b".repeat(40)}`,
    });
    const terminate = vi.fn(() => Promise.resolve());
    const get = vi.fn(() =>
      Promise.resolve({
        status: () => Promise.resolve({ status: "running" as const }),
        terminate,
      }),
    );
    const setup = runtime({
      head: () => "c".repeat(40),
      workflow: { get },
    });

    await expect(
      executeReviewWorkflow(
        env,
        event("current-workflow", newerJob),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toEqual({ findingsPublished: 0, outcome: "obsolete" });

    expect(get).toHaveBeenCalledWith("superseded-workflow");
    expect(terminate).toHaveBeenCalledOnce();
    await expect(ledger.runState(oldRun.id)).resolves.toBe("obsolete");
    await expect(ledger.cleanupState(oldRun.id)).resolves.toBeDefined();
    await runInDurableObject(ledger, (_object, state) => {
      expect(
        state.storage.sql
          .exec<{ state: string }>(
            "SELECT state FROM workflow_supersessions WHERE superseded_run_id = ?",
            oldRun.id,
          )
          .one().state,
      ).toBe("completed");
    });
  });

  it("continues the latest review when active termination is temporarily unavailable", async () => {
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    const oldRun = createReviewRun(job);
    await ledger.claimRun(oldRun, "deferred-workflow");
    await ledger.transition(
      oldRun.id,
      "queued",
      "running",
      "2026-08-29T12:00:02.000Z",
      "deferred-workflow:start",
    );
    await ledger.registerCredentialScope({
      containerId: "f".repeat(64),
      installationId: 99,
      repositoryId: 42,
      repositoryName: "api",
      repositoryOwner: "acme",
      runId: oldRun.id,
    });

    const newerJob = reviewJobV2Schema.parse({
      ...job,
      envelope: {
        ...job.envelope,
        action: "synchronize",
        deliveryId: "github:delivery-deferred",
        pullRequest: {
          ...job.envelope.pullRequest,
          headSha: "b".repeat(40),
          updatedAt: "2026-08-29T12:01:00.000Z",
        },
        receivedAt: "2026-08-29T12:01:01.000Z",
      },
      runId: `github:42:pr:7:head:${"b".repeat(40)}`,
    });
    const status = vi.fn(() => Promise.resolve({ status: "running" as const }));
    const setup = runtime({
      head: () => "c".repeat(40),
      workflow: {
        get: () =>
          Promise.resolve({
            status,
            terminate: () => Promise.reject(new Error("temporarily down")),
          }),
      },
    });

    await expect(
      executeReviewWorkflow(
        env,
        event("current-deferred-workflow", newerJob),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toEqual({ findingsPublished: 0, outcome: "obsolete" });

    expect(status).toHaveBeenCalledTimes(2);
    await expect(ledger.runState(oldRun.id)).resolves.toBe("obsolete");
    await runInDurableObject(ledger, (_object, state) => {
      expect(
        state.storage.sql
          .exec<{ state: string }>(
            "SELECT state FROM workflow_supersessions WHERE superseded_run_id = ?",
            oldRun.id,
          )
          .one().state,
      ).toBe("pending");
    });
  });

  it("registers a rollback that closes a superseded Check Run", async () => {
    const setup = runtime();
    const checkRunPatches: Record<string, unknown>[] = [];
    setup.value = {
      ...setup.value,
      createSession: () => {
        const base = session([]);
        const request = base.api.request;
        return Promise.resolve({
          ...base,
          api: {
            ...base.api,
            request: (route: string, parameters: Record<string, unknown>) => {
              if (route.startsWith("PATCH") && route.includes("check-runs")) {
                checkRunPatches.push(parameters);
              }
              return request(route, parameters);
            },
          },
        });
      },
    };
    let rollback:
      | ((input: {
          readonly error: Error;
          readonly output: number | undefined;
        }) => Promise<void>)
      | undefined;
    const step = {
      do: async <T>(
        name: string,
        configOrCallback: unknown,
        maybeCallback?: unknown,
        rollbackOptions?: unknown,
      ): Promise<T> => {
        const callback =
          typeof configOrCallback === "function"
            ? configOrCallback
            : maybeCallback;
        if (typeof callback !== "function") throw new TypeError("callback");
        const output = await (callback as () => Promise<T>)();
        if (name === "start-check-run") {
          rollback = (
            rollbackOptions as {
              rollback: typeof rollback;
            }
          ).rollback;
        }
        return output;
      },
    } as unknown as WorkflowStep;

    await executeReviewWorkflow(
      env,
      event("rollback-registration"),
      step,
      setup.value,
    );
    expect(rollback).toBeTypeOf("function");

    // When the run is not obsolete, rollback should NOT overwrite the check run
    const patchCountBefore = checkRunPatches.length;
    await rollback?.({
      error: new Error("unrelated-error"),
      output: 1,
    });
    expect(checkRunPatches.length).toBe(patchCountBefore);

    // When the run state is obsolete, rollback should update the check run to cancelled
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await runInDurableObject(ledger, (_object, state) => {
      state.storage.sql.exec(
        "UPDATE runs SET state = 'obsolete' WHERE id = ?",
        job.runId,
      );
    });

    await rollback?.({
      error: new Error("superseded"),
      output: 1,
    });

    expect(checkRunPatches.at(-1)).toMatchObject({
      conclusion: "cancelled",
      status: "completed",
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
    expect(setup.posts.map((post) => post.route)).toEqual([
      "POST /repos/{owner}/{repo}/check-runs",
      "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
    ]);
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
    const summaryPost = setup.posts.find((p) =>
      p.route.includes("/pulls/{pull_number}/reviews"),
    );
    expect(summaryPost?.body).toContain("No eligible changes were found");
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
    const summaryPost = posts.find((p) =>
      p.route.includes("/pulls/{pull_number}/reviews"),
    );
    expect(summaryPost?.body).toContain("Low-severity observations:");
    expect(summaryPost?.body).toContain(finding.diagnostic);
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
    expect(
      setup.posts.some((post) => post.route.includes("/pulls/{pull_number}")),
    ).toBe(false);
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

  it("manages Check Run lifecycle with in_progress and completion status", async () => {
    const checkRunRequests: Array<{
      readonly route: string;
      readonly parameters: Record<string, unknown>;
    }> = [];
    const setup = runtime();
    setup.value = {
      ...setup.value,
      createSession: () => {
        const s = session([]);
        return Promise.resolve({
          ...s,
          api: {
            ...s.api,
            request: (route: string, parameters: Record<string, unknown>) => {
              if (route.includes("check-runs")) {
                checkRunRequests.push({ parameters, route });
              }
              return Promise.resolve({ data: { id: 789 } });
            },
          },
        });
      },
    };

    await expect(
      executeReviewWorkflow(
        env,
        event("check-run-lifecycle-run"),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toMatchObject({ outcome: "completed" });

    expect(checkRunRequests).toHaveLength(2);
    expect(checkRunRequests[0]).toMatchObject({
      parameters: {
        external_id:
          "github:42:pr:7:head:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        head_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        name: "Holon Review",
        output: {
          summary:
            "Holon is reviewing pull request changes for functional regressions, contract breaks, and security flaws.",
          title: "Holon Review in progress",
        },
        owner: "acme",
        repo: "api",
        request: { retries: 0 },
        started_at: expect.any(String),
        status: "in_progress",
      },
      route: "POST /repos/{owner}/{repo}/check-runs",
    });

    expect(checkRunRequests[1]?.route).toBe(
      "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
    );
    expect(checkRunRequests[1]?.parameters).toMatchObject({
      check_run_id: 789,
      conclusion: "failure",
      status: "completed",
    });

    await expect(
      env.REVIEW_LEDGERS.getByName("github:42:pr:7").checkRunId(
        job.runId as RunId,
      ),
    ).resolves.toBe(789);
  });

  it("handles existing check runs found via findCheckRunByExternalId or ledger cache", async () => {
    const setup = runtime();
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    const cachedRunId = `github:42:pr:7:head:${"b".repeat(40)}` as RunId;
    const jobWithCachedRun: ReviewJob = {
      ...job,
      envelope: {
        ...job.envelope,
        pullRequest: {
          ...job.envelope.pullRequest,
          headSha: "b".repeat(40),
        },
      },
      runId: cachedRunId,
    };
    const testRun = createReviewRun(jobWithCachedRun);
    await ledger.claimRun(
      testRun,
      "workflow-cached",
      "2026-08-29T12:00:00.000Z",
    );
    await ledger.recordCheckRunId(cachedRunId, 555);

    const checkRunRequests: string[] = [];
    setup.value = {
      ...setup.value,
      createSession: () => {
        const s = session([]);
        return Promise.resolve({
          ...s,
          api: {
            ...s.api,
            request: (route: string) => {
              checkRunRequests.push(route);
              return Promise.resolve({ data: { id: 1 } });
            },
          },
          currentHeadSha: () => Promise.resolve("b".repeat(40)),
        });
      },
    };

    await expect(
      executeReviewWorkflow(
        env,
        event("workflow-cached", jobWithCachedRun),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toMatchObject({ outcome: "completed" });

    // start-check-run re-used cached 555 and did not call POST /check-runs
    expect(
      checkRunRequests.filter(
        (r) => r.startsWith("POST") && r.includes("check-runs"),
      ),
    ).toHaveLength(0);
    // complete-check-run called PATCH /check-runs/{check_run_id}
    expect(
      checkRunRequests.filter(
        (r) => r.startsWith("PATCH") && r.includes("check-runs"),
      ),
    ).toHaveLength(1);
  });

  it("finds existing check runs on GitHub when ledger does not have checkRunId", async () => {
    const checkRunPatches: Array<{
      readonly route: string;
      readonly parameters: Record<string, unknown>;
    }> = [];
    const setup = runtime();
    setup.value = {
      ...setup.value,
      createSession: () => {
        const s = session([]);
        return Promise.resolve({
          ...s,
          api: {
            ...s.api,
            listCheckRuns: () =>
              Promise.resolve([
                {
                  externalId: job.runId,
                  id: 888,
                  name: "Holon Review",
                  status: "in_progress",
                },
              ]),
            request: (route: string, parameters: Record<string, unknown>) => {
              if (route.startsWith("PATCH") && route.includes("check-runs")) {
                checkRunPatches.push({ parameters, route });
              }
              return Promise.resolve({ data: { id: 1 } });
            },
          },
        });
      },
    };

    await expect(
      executeReviewWorkflow(
        env,
        event("found-check-run-on-github"),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toMatchObject({ outcome: "completed" });

    expect(checkRunPatches).toHaveLength(1);
    expect(checkRunPatches[0]?.parameters).toMatchObject({
      check_run_id: 888,
      status: "completed",
    });
  });

  it("completes check run with success conclusion for clean review without findings", async () => {
    const checkRunPatches: Array<{
      readonly parameters: Record<string, unknown>;
    }> = [];
    const setup = runtime({
      model: () => ({
        review: () =>
          Promise.resolve({
            output: {
              findings: [],
              summary: "No functional regressions or security flaws found.",
            },
            promptTruncated: false,
          }),
      }),
    });
    setup.value = {
      ...setup.value,
      createSession: () => {
        const s = session([]);
        return Promise.resolve({
          ...s,
          api: {
            ...s.api,
            request: (route: string, parameters: Record<string, unknown>) => {
              if (route.startsWith("PATCH") && route.includes("check-runs")) {
                checkRunPatches.push({ parameters });
              }
              return Promise.resolve({ data: { id: 1 } });
            },
          },
        });
      },
    };

    await expect(
      executeReviewWorkflow(
        env,
        event("clean-review-run"),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toMatchObject({ outcome: "completed" });

    expect(checkRunPatches).toHaveLength(1);
    expect(checkRunPatches[0]?.parameters).toMatchObject({
      conclusion: "success",
      status: "completed",
    });
  });

  it("handles check run start and update failures gracefully without failing review", async () => {
    const events: Array<{ readonly event: string }> = [];
    const setup = runtime();
    setup.value = {
      ...setup.value,
      createSession: () => {
        const s = session([]);
        return Promise.resolve({
          ...s,
          api: {
            ...s.api,
            request: (route: string) => {
              if (route.includes("check-runs")) {
                return Promise.reject(
                  new Error("check run API network failure"),
                );
              }
              return Promise.resolve({ data: { id: 123 } });
            },
          },
        });
      },
      logger: {
        emit: (name) => events.push({ event: name }),
      },
    };

    await expect(
      executeReviewWorkflow(
        env,
        event("check-run-error-handling-run"),
        immediateStep([]),
        setup.value,
      ),
    ).resolves.toMatchObject({ outcome: "completed" });

    expect(events.some((e) => e.event === "check_run.start_failed")).toBe(true);
  });

  it("orchestrates multi-shard review with partial shard failure", async () => {
    // 22 files will produce 2 shards with maxShardFiles = 20
    const files = Array.from({ length: 22 }, (_, index) => ({
      mode: "structural" as const,
      patch: `diff --git a/src/file${index}.ts b/src/file${index}.ts\n--- a/src/file${index}.ts\n+++ b/src/file${index}.ts\n@@ -10,1 +10,1 @@\n-old\n+const x${index} = fn();\n`,
      path: `src/file${index}.ts`,
    }));

    const changedLines = files.map((file) => ({
      line: 10,
      path: file.path,
      side: "RIGHT" as const,
    }));

    let modelCalls = 0;
    const setup = runtime({
      context: {
        changedLines,
        files,
        schemaVersion: 2,
        truncated: false,
      },
      model: () => ({
        review: () => {
          modelCalls += 1;
          if (modelCalls === 2) {
            return Promise.reject(new Error("Shard 2 transient error"));
          }
          return Promise.resolve({
            output: {
              findings: [],
              summary: "Shard review succeeded.",
            },
            promptTruncated: false,
          });
        },
      }),
    });

    const result = await executeReviewWorkflow(
      env,
      event("multi-shard-partial-failure-run"),
      immediateStep([]),
      setup.value,
    );

    expect(result.outcome).toBe("completed");
    expect(modelCalls).toBe(2);
  });

  it("isolates non-retryable model failure in individual shard and completes review partially", async () => {
    const files = Array.from({ length: 22 }, (_, index) => ({
      mode: "structural" as const,
      patch: `diff --git a/src/file${index}.ts b/src/file${index}.ts\n--- a/src/file${index}.ts\n+++ b/src/file${index}.ts\n@@ -10,1 +10,1 @@\n-old\n+const x${index} = fn();\n`,
      path: `src/file${index}.ts`,
    }));

    const changedLines = files.map((file) => ({
      line: 10,
      path: file.path,
      side: "RIGHT" as const,
    }));

    let modelCalls = 0;
    const objectInvalidError = new Error("No object generated");
    objectInvalidError.name = "AI_NoObjectGeneratedError";

    const setup = runtime({
      context: {
        changedLines,
        files,
        schemaVersion: 2,
        truncated: false,
      },
      model: () => ({
        review: () => {
          modelCalls += 1;
          if (modelCalls === 1) {
            return Promise.reject(objectInvalidError);
          }
          return Promise.resolve({
            output: {
              findings: [],
              summary: "Shard 2 review succeeded.",
            },
            promptTruncated: false,
          });
        },
      }),
    });

    const result = await executeReviewWorkflow(
      env,
      event("multi-shard-object-invalid-isolated-run"),
      immediateStep([]),
      setup.value,
    );

    expect(result.outcome).toBe("completed");
    expect(modelCalls).toBe(2);
    const summaryPost = setup.posts.find((p) =>
      p.route.includes("/pulls/{pull_number}/reviews"),
    );
    expect(summaryPost?.body).toContain("Shard 2 review succeeded.");
    expect(summaryPost?.body).toContain(
      "Partial review: some changes could not be analyzed due to an execution failure.",
    );
  });

  it("handles unsupported plans with 0 eligible files in review-workflow", async () => {
    const setup = runtime({
      context: {
        changedLines: [],
        files: [],
        schemaVersion: 2,
        truncated: false,
      },
    });

    const result = await executeReviewWorkflow(
      env,
      event("unsupported-plan-run"),
      immediateStep([]),
      setup.value,
    );

    expect(result.outcome).toBe("completed");
  });

  it("publishes summary review with REQUEST_CHANGES event when blocking defect exists", async () => {
    const setup = runtime(); // default runtime has high severity finding

    const result = await executeReviewWorkflow(
      env,
      event("verdict-request-changes-run"),
      immediateStep([]),
      setup.value,
    );

    expect(result.outcome).toBe("completed");
    const summaryPost = setup.posts.find((p) =>
      p.route.includes("/pulls/{pull_number}/reviews"),
    );
    expect(summaryPost).toBeDefined();
    expect(summaryPost?.event).toBe("REQUEST_CHANGES");
  });

  it("publishes summary review with APPROVE event when review is clean", async () => {
    const setup = runtime({
      model: () => ({
        review: () =>
          Promise.resolve({
            output: { findings: [], summary: "All files look great!" },
            promptTruncated: false,
          }),
      }),
    });

    const result = await executeReviewWorkflow(
      env,
      event("verdict-approve-run"),
      immediateStep([]),
      setup.value,
    );

    expect(result.outcome).toBe("completed");
    const summaryPost = setup.posts.find((p) =>
      p.route.includes("/pulls/{pull_number}/reviews"),
    );
    expect(summaryPost).toBeDefined();
    expect(summaryPost?.event).toBe("APPROVE");
  });

  it("reconciles findings across commits: suppresses persistent comment and notifies resolution when fixed", async () => {
    const posts: Array<{
      readonly body: unknown;
      readonly event?: unknown;
      readonly route: string;
    }> = [];

    const sha1 = "1".repeat(40);
    const sha2 = "2".repeat(40);
    const sha3 = "3".repeat(40);

    let currentFindings: (typeof finding)[] = [finding];
    let currentHead = sha1;

    const createJobForSha = (sha: string): ReviewJob =>
      reviewJobV2Schema.parse({
        ...job,
        envelope: {
          ...job.envelope,
          pullRequest: {
            ...job.envelope.pullRequest,
            headSha: sha,
          },
        },
        runId: `github:42:pr:7:head:${sha}`,
      });

    const setup = runtime({
      head: () => currentHead,
      model: () => ({
        review: () =>
          Promise.resolve({
            output: {
              findings: currentFindings,
              summary: "Model review completed.",
            },
            promptTruncated: false,
          }),
      }),
      posts,
    });

    // 1. Commit 1 introduces the finding
    const result1 = await executeReviewWorkflow(
      env,
      event("lifecycle-run-1", createJobForSha(sha1)),
      immediateStep([]),
      setup.value,
    );
    expect(result1.outcome).toBe("completed");
    expect(result1.findingsPublished).toBe(1);

    const inlinePostsRun1 = posts.filter(
      (p) =>
        p.route.includes("/pulls/{pull_number}/comments") &&
        !p.route.includes("/replies"),
    );
    expect(inlinePostsRun1).toHaveLength(1);

    // 2. Commit 2: finding is still present (persistent) -> duplicate suppressed!
    currentHead = sha2;
    const result2 = await executeReviewWorkflow(
      env,
      event("lifecycle-run-2", createJobForSha(sha2)),
      immediateStep([]),
      setup.value,
    );
    expect(result2.outcome).toBe("completed");
    expect(result2.findingsPublished).toBe(0); // Suppressed!

    const inlinePostsRun2 = posts.filter(
      (p) =>
        p.route.includes("/pulls/{pull_number}/comments") &&
        !p.route.includes("/replies"),
    );
    expect(inlinePostsRun2).toHaveLength(1); // No new inline comment created

    // 3. Commit 3: author fixes the finding -> resolved!
    currentHead = sha3;
    currentFindings = [];
    const result3 = await executeReviewWorkflow(
      env,
      event("lifecycle-run-3", createJobForSha(sha3)),
      immediateStep([]),
      setup.value,
    );
    expect(result3.outcome).toBe("completed");
    expect(result3.findingsPublished).toBe(0);

    const replyPosts = posts.filter((p) =>
      p.route.includes("/pulls/{pull_number}/comments/{comment_id}/replies"),
    );
    expect(replyPosts).toHaveLength(1);
    const resolutionReply = posts.find((p) =>
      p.route.includes("/pulls/{pull_number}/comments/{comment_id}/replies"),
    );
    expect(resolutionReply?.body).toContain("Defeito resolvido no commit");

    // Verdict for run 3 transitions to APPROVE automatically!
    const summaryPostRun3 = posts.findLast((p) =>
      p.route.includes("/pulls/{pull_number}/reviews"),
    );
    expect(summaryPostRun3?.event).toBe("APPROVE");

    // 4. Commit 4: finding is reintroduced!
    const sha4 = "4".repeat(40);
    currentHead = sha4;
    currentFindings = [finding];
    const result4 = await executeReviewWorkflow(
      env,
      event("lifecycle-run-4", createJobForSha(sha4)),
      immediateStep([]),
      setup.value,
    );
    expect(result4.outcome).toBe("completed");
    expect(result4.findingsPublished).toBe(1);

    const inlinePostsRun4 = posts.filter(
      (p) =>
        p.route.includes("/pulls/{pull_number}/comments") &&
        !p.route.includes("/replies"),
    );
    expect(inlinePostsRun4).toHaveLength(2); // New inline comment for reintroduced finding
  });

  it("handles resolution reply failure gracefully without failing review", async () => {
    const posts: Array<{
      readonly body: unknown;
      readonly event?: unknown;
      readonly route: string;
    }> = [];

    const sha1 = "1".repeat(40);
    const sha2 = "2".repeat(40);
    const createJobForSha = (sha: string): ReviewJob =>
      reviewJobV2Schema.parse({
        ...job,
        envelope: {
          ...job.envelope,
          pullRequest: {
            ...job.envelope.pullRequest,
            headSha: sha,
          },
        },
        runId: `github:42:pr:7:head:${sha}`,
      });

    let currentHead = sha1;

    const setup = runtime({
      head: () => currentHead,
      model: () => ({
        review: () =>
          Promise.resolve({
            output: {
              findings: currentHead === sha1 ? [finding] : [],
              summary: "Model analysis.",
            },
            promptTruncated: false,
          }),
      }),
      posts,
    });

    // Run 1 creates finding
    await executeReviewWorkflow(
      env,
      event("res-fail-run-1", createJobForSha(sha1)),
      immediateStep([]),
      setup.value,
    );

    // Run 2: reply endpoint rejects
    currentHead = sha2;
    const runtimeWithFailingReply: ReviewRuntime = {
      ...setup.value,
      createSession: async () => {
        const s = session(posts, () => currentHead);
        return {
          ...s,
          api: {
            ...s.api,
            request: (route: string, params: Record<string, unknown>) => {
              if (route.includes("/replies")) {
                return Promise.reject(new Error("GitHub network glitch"));
              }
              return s.api.request(route, params);
            },
          },
        };
      },
    };

    const result2 = await executeReviewWorkflow(
      env,
      event("res-fail-run-2", createJobForSha(sha2)),
      immediateStep([]),
      runtimeWithFailingReply,
    );

    expect(result2.outcome).toBe("completed");
  });

  it("incorporates pre-existing CI evidence saved in ledger into initial review summary", async () => {
    const posts: Array<{ readonly route: string; readonly body: unknown }> = [];
    const targetSha = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const prKey = "github:42:pr:7" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(prKey);

    await ledger.saveCiEvidence(prKey, targetSha, {
      markdown: "### 🧪 CI Test & Coverage Evidence\nCoverage: 92.5%",
      workflowRunId: 789,
    });

    const setup = runtime({
      head: () => targetSha,
      model: () => ({
        review: async () => ({
          output: { findings: [], summary: "Initial clean review." },
          promptTruncated: false,
        }),
      }),
      posts,
    });

    const targetJob: ReviewJob = reviewJobV2Schema.parse({
      ...job,
      envelope: {
        ...job.envelope,
        pullRequest: {
          ...job.envelope.pullRequest,
          headSha: targetSha,
        },
      },
      runId: `github:42:pr:7:head:${targetSha}`,
    });

    const result = await executeReviewWorkflow(
      env,
      event("ci-evidence-handshake", targetJob),
      immediateStep([]),
      setup.value,
    );

    expect(result.outcome).toBe("completed");

    const summaryPost = posts.find((p) => p.route.includes("/reviews"));
    expect(summaryPost).toBeDefined();
    const body = summaryPost?.body as string;
    expect(body).toContain("Initial clean review.");
    expect(body).toContain("### 🧪 CI Test & Coverage Evidence");
    expect(body).toContain("Coverage: 92.5%");
  });

  it("emits slo.breached event when execution or queue wait exceeds SLO threshold", async () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> =
      [];
    const setup = runtime({
      head: () => "a".repeat(40),
      logger: {
        emit: (eventName, fields) => {
          events.push({ event: eventName, fields });
        },
      },
      now: () => "2026-08-29T12:10:00.000Z", // 10 minutes after event
    });

    const result = await executeReviewWorkflow(
      env,
      event("slo-breach-workflow"),
      immediateStep([]),
      setup.value,
    );

    expect(result.outcome).toBe("completed");
    const breach = events.find((e) => e.event === "slo.breached");
    expect(breach).toBeDefined();
    expect(breach?.fields.violations).toBeDefined();
  });

  it("handles terminalization failure and failure notice failure gracefully in workflow catch", async () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> =
      [];
    const setup = runtime({
      head: () => {
        throw new Error("Critical network outage during review");
      },
      logger: {
        emit: (eventName, fields) => {
          events.push({ event: eventName, fields });
        },
      },
    });

    const stepErrors = {
      "mark-review-terminal-and-schedule-cleanup": new Error(
        "Ledger storage error",
      ),
    };
    const sendProjection = vi.fn(() => Promise.resolve());
    const projectionQueue = {
      send: sendProjection,
    } as unknown as Queue<unknown>;

    await expect(
      executeReviewWorkflow(
        env,
        event("terminal-failure-workflow"),
        immediateStep([], undefined, stepErrors),
        { ...setup.value, adminProjectionQueue: projectionQueue },
      ),
    ).rejects.toThrow("HOLON_GITHUB_TRANSIENT:transport");

    expect(
      events.some((e) => e.event === "review.terminalization_failed"),
    ).toBe(true);
    expect(events.some((e) => e.event === "review.failed")).toBe(true);
    expect(sendProjection).not.toHaveBeenCalled();
  });

  it("emits structured repository.preparation_failed diagnostics when prepareRepository fails", async () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> =
      [];
    const setup = runtime({
      logger: {
        emit: (eventName, fields) => {
          events.push({ event: eventName, fields });
        },
      },
    });
    setup.prepareRepositoryV2.mockImplementation(() => {
      const error = new Error(
        "HOLON_REPOSITORY_PERMANENT:fetch:command-failed",
      );
      error.name = "RepositoryPermanentError";
      return Promise.reject(error);
    });

    await expect(
      executeReviewWorkflow(
        env,
        event("prepare-repo-failure-workflow"),
        immediateStep([]),
        setup.value,
      ),
    ).rejects.toThrow();

    const prepFailed = events.find(
      (e) => e.event === "repository.preparation_failed",
    );
    expect(prepFailed).toBeDefined();
    expect(prepFailed?.fields.errorKind).toBe("RepositoryPermanentError");
    expect(prepFailed?.fields.retryable).toBe(false);
  });

  it("synthesizes multi-shard summaries into a unified executive summary when all shards succeed", async () => {
    const files = Array.from({ length: 22 }, (_, index) => ({
      mode: "structural" as const,
      patch: `diff --git a/src/file${index}.ts b/src/file${index}.ts\n--- a/src/file${index}.ts\n+++ b/src/file${index}.ts\n@@ -10,1 +10,1 @@\n-old\n+const x${index} = fn();\n`,
      path: `src/file${index}.ts`,
    }));

    const changedLines = files.map((file) => ({
      line: 10,
      path: file.path,
      side: "RIGHT" as const,
    }));

    let synthesizeCalled = false;
    const setup = runtime({
      context: {
        changedLines,
        files,
        schemaVersion: 2,
        truncated: false,
      },
      model: () => ({
        review: (_job, ctx) =>
          Promise.resolve({
            output: {
              findings: [],
              summary: `Shard review covering ${ctx.files.length} files.`,
            },
            promptTruncated: false,
          }),
        synthesizeReviewSummary: (_job, input) => {
          synthesizeCalled = true;
          expect(input.shardSummaries).toHaveLength(2);
          return Promise.resolve(
            "Unified executive summary synthesized across all shards.",
          );
        },
      }),
    });

    const result = await executeReviewWorkflow(
      env,
      event("multi-shard-synthesized-run"),
      immediateStep([]),
      setup.value,
    );

    expect(result.outcome).toBe("completed");
    expect(synthesizeCalled).toBe(true);
  });

  it("isolates admin projection queue failures and does not fail the review", async () => {
    let projectionFailedEmitted = false;
    const sendMock = vi.fn(() =>
      Promise.reject(new Error("Queue unavailable")),
    );
    const failingQueue = {
      send: sendMock,
    } as unknown as Queue<unknown>;

    const setup = runtime({
      head: () => "a".repeat(40),
      logger: {
        emit: (eventName) => {
          if (eventName === "admin.projection_failed") {
            projectionFailedEmitted = true;
          }
        },
      },
    });

    const runtimeWithFailingQueue: ReviewRuntime = {
      ...setup.value,
      adminProjectionQueue: failingQueue,
    };

    const result = await executeReviewWorkflow(
      env,
      event("failing-queue-run"),
      immediateStep([]),
      runtimeWithFailingQueue,
    );

    expect(result.outcome).toBe("completed");
    expect(projectionFailedEmitted).toBe(true);
    expect(sendMock).toHaveBeenCalled();
  });

  it("does not project when the rollout flag is disabled", async () => {
    const setup = runtime();
    const send = vi.fn();
    const stepNames: string[] = [];
    const envWithoutQueue = {
      ...env,
      ADMIN_PROJECTION_ENABLED: "false",
      ADMIN_PROJECTION_QUEUE: { send },
    } as unknown as Cloudflare.Env;

    const result = await executeReviewWorkflow(
      envWithoutQueue,
      event("no-queue-run"),
      immediateStep(stepNames),
      setup.value,
    );

    expect(result.outcome).toBe("completed");
    expect(send).not.toHaveBeenCalled();
    expect(
      stepNames.some((stepName) => stepName.includes("admin-projection")),
    ).toBe(false);
  });

  it("projects when the rollout flag is enabled", async () => {
    const setup = runtime();
    const send = vi.fn(() => Promise.resolve());
    const envWithQueue = {
      ...env,
      ADMIN_PROJECTION_ENABLED: "true",
      ADMIN_PROJECTION_QUEUE: { send },
    } as unknown as Cloudflare.Env;

    const result = await executeReviewWorkflow(
      envWithQueue,
      event("enabled-queue-run"),
      immediateStep([]),
      setup.value,
    );

    expect(result.outcome).toBe("completed");
    expect(send).toHaveBeenCalledOnce();
  });
});

it("records identified versions and supplies them to the review only in enrich mode", async () => {
  const result = await identifySnapshot({
    snapshotSha: job.envelope.pullRequest.headSha,
    policyDigest: "p",
    modelRevision: "m",
    files: [
      { path: "package.json", content: '{"dependencies":{"react":"19.0.0"}}' },
    ],
  });
  const review = vi.fn(async (_job: ReviewJob, _context: ReviewContextV2) => ({
    output: { findings: [], summary: "No issues." },
    promptTruncated: false,
  }));
  const setup = runtime({ model: () => ({ review }) });
  const settings: Record<string, string> = {
    PROJECT_IDENTIFICATION_ENABLED: "true",
    PROJECT_IDENTIFICATION_MODE: "enrich",
  };
  const configured = { ...env, ...settings } as Cloudflare.Env;
  const names: string[] = [];
  await executeReviewWorkflow(
    configured,
    event("identification-workflow"),
    immediateStep(names),
    {
      ...setup.value,
      identificationModel: {
        identify: async () => ({ selectedFactIds: ["fact-0"] }),
      },
      executor: {
        ...setup.value.executor!,
        discoverProjectMetadataV1: async () => result,
      },
    },
  );
  expect(names).toContain("discover-project-metadata-v1");
  expect(names).toContain("identify-project-v1-0");
  expect(names).toContain("record-project-identification-v1");
  expect(review.mock.calls[0]?.[1]).toMatchObject({
    projectIdentification: {
      projects: [{ root: ".", technologies: [{ name: "react" }] }],
    },
  });
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  await runInDurableObject(ledger, async (_object, state) => {
    expect(
      await state.storage.get("project-identification:" + job.runId),
    ).toMatchObject({
      snapshotSha: job.envelope.pullRequest.headSha,
      projects: [{ interpretation: "model-verified" }],
    });
  });
});

it("waits durably for an existing cache owner then reuses its result", async () => {
  const result = await identifySnapshot({
    snapshotSha: job.envelope.pullRequest.headSha,
    policyDigest: "p",
    modelRevision: "m",
    files: [
      { path: "package.json", content: '{"dependencies":{"react":"19.0.0"}}' },
    ],
  });
  const project = result.projects[0]!;
  const cacheName = await env.PROJECT_IDENTIFICATION_REGISTRY.getByName(
    "99",
  ).register(99, 42);
  const cache = env.PROJECT_IDENTIFICATION_CACHE.getByName(cacheName!);
  const claim = await cache.claim(project.fingerprint, "other-run");
  if (claim.status !== "claimed") throw new Error("claim");
  const identify = vi.fn(async () => ({ selectedFactIds: [] }));
  const setup = runtime();
  const names: string[] = [];
  const overrides: Record<string, string> = {
    PROJECT_IDENTIFICATION_ENABLED: "true",
  };
  await executeReviewWorkflow(
    { ...env, ...overrides },
    event("identification-pending"),
    immediateStep(names, async (name) => {
      if (name.startsWith("wait-project-identification"))
        await cache.complete(project.fingerprint, "other-run", claim.token, {
          ...project,
          interpretation: "model-verified",
        });
    }),
    {
      ...setup.value,
      identificationModel: { identify },
      executor: {
        ...setup.value.executor!,
        discoverProjectMetadataV1: async () => result,
      },
    },
  );
  expect(names).toContain("wait-project-identification-v1-0-0");
  expect(identify).not.toHaveBeenCalled();
});
