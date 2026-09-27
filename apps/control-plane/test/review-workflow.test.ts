import {
  createReviewRun,
  RepositoryConfigurationError,
} from "@holon/application";
import {
  reviewJobSchema,
  type ReviewShardContext,
  type ReviewJob,
  type ModelReviewOutput,
} from "@holon/contracts";
import type { RunId } from "@holon/domain";
import { computeStableFingerprint } from "@holon/domain";
import { ModelProviderRequestError } from "@holon/model";
import { identifySnapshot } from "@holon/project-identification";
import {
  reset,
  runInDurableObject,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { WorkflowStep } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckRunReconciliationStore } from "../src/check-run-reconciliation.js";
import {
  executeReviewWorkflow,
  parseAppId,
  type ReviewRuntime,
} from "../src/review-workflow.js";
import {
  configurationReader,
  defaultScopePolicy,
} from "./configuration-fixtures.js";
import { unconfiguredExecutor } from "./executor-fixture.js";

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
      updatedAt: "2026-08-29T12:00:00.000Z",
    },
    receivedAt: "2026-08-29T12:00:01.000Z",
    repository: {
      fullName: "acme/api",
      id: 42,
      name: "api",
      owner: "acme",
    },
  },
  runId: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
});

const canonicalPatch = [
  "diff --git a/src/index.ts b/src/index.ts",
  "--- a/src/index.ts",
  "+++ b/src/index.ts",
  "@@ -9,0 +10,1 @@",
  "+return null;",
].join("\n");

const context: ReviewShardContext = {
  changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
  files: [{ mode: "structural", patch: canonicalPatch, path: "src/index.ts" }],
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

function cachedSteps(cache: Map<string, unknown>): WorkflowStep {
  return {
    sleep: async () => {},
    do: async (name: string, config: unknown, callback: unknown) => {
      if (cache.has(name)) return structuredClone(cache.get(name));
      // Keep the artifact alive while this test replays the publication tail.
      if (name === "complete-run-and-schedule-cleanup")
        return new Date(Date.now()).toISOString();
      const fn = typeof config === "function" ? config : callback;
      if (typeof fn !== "function") throw new TypeError("callback");
      const result: unknown = await fn();
      cache.set(name, structuredClone(result));
      return result;
    },
  } as unknown as WorkflowStep;
}

it("publishes the latest human severity even when feedback arrives after analysis", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  const fingerprint = await computeStableFingerprint({
    diagnostic: finding.diagnostic,
    excerpt: finding.evidence[0]!.excerpt,
    path: finding.location.path,
  });
  const baseline = {
    ...createReviewRun(job),
    id: `github:42:pr:7:head:${"c".repeat(40)}:base:${"b".repeat(40)}` as RunId,
    causalVersion: "2026-08-28T12:00:00.000Z",
  };
  await ledger.claimRun(baseline, "baseline");
  await ledger.transition(
    baseline.id,
    "queued",
    "running",
    baseline.createdAt,
    "baseline-start",
  );
  await ledger.transition(
    baseline.id,
    "running",
    "publishing",
    baseline.createdAt,
    "baseline-publish",
  );
  await ledger.savePrFindings(
    "github:42:pr:7",
    [
      {
        fingerprint,
        evidenceFingerprint: fingerprint.slice(3),
        diagnostic: finding.diagnostic,
        filePath: finding.location.path,
        line: 10,
        severity: "high",
        confidence: 0.95,
        status: "new",
        prKey: "github:42:pr:7",
        firstSeenHeadSha: "a".repeat(40),
        lastSeenHeadSha: "a".repeat(40),
        firstSeenRunId: baseline.id,
        lastSeenRunId: baseline.id,
        githubCommentId: 99,
        updatedAt: new Date().toISOString(),
      },
    ],
    baseline.id,
  );
  const setup = runtime();
  await executeReviewWorkflow(
    env,
    event("late-feedback"),
    immediateStep([], async (name) => {
      if (name !== "analyze-review") return;
      await ledger.applyFindingFeedback({
        prKey: "github:42:pr:7",
        targetCommentId: 99,
        githubCommentId: 100,
        deliveryId: "github:late-feedback",
        createdAt: new Date().toISOString(),
        authorLogin: "maintainer",
        authorAssociation: "MEMBER",
        label: "wrong_severity",
        targetSeverity: "low",
        update: { severity: "low" },
      });
    }),
    setup.value,
  );
  const summary = setup.posts.findLast((post) =>
    post.route.includes("/pulls/{pull_number}/reviews"),
  );
  expect(summary?.event).toBe("APPROVE");
  expect((await ledger.loadPrFindings("github:42:pr:7"))[0]?.severity).toBe(
    "low",
  );
});

it("reconstructs persisted versions, usage and start time when callbacks are replayed after the identification deadline", async () => {
  const initialTime = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(initialTime);
  const identification = await identifySnapshot({
    snapshotSha: job.envelope.pullRequest.headSha,
    policyDigest: "p",
    modelRevision: "m",
    files: [
      { path: "package.json", content: '{"dependencies":{"react":"19.0.0"}}' },
    ],
  });
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  const review = vi.fn(
    async (_job: ReviewJob, _context: ReviewShardContext) => {
      await ledger.recordAnalysisUsage(job.runId, "test-model-call", {
        inputTokens: 100,
        outputTokens: 20,
        toolCallsCount: 0,
      });
      return {
        output: { findings: [], summary: "No issues." },
        promptTruncated: false,
      };
    },
  );
  const setup = runtime({
    model: () => ({ review }),
    now: () => new Date(Date.now()).toISOString(),
  });
  const identificationSettings: Record<string, string> = {
    PROJECT_IDENTIFICATION_MODE: "enrich",
  };
  const settings = { ...env, ...identificationSettings } as Cloudflare.Env;
  const configured = {
    ...setup.value,
    identificationModel: {
      identify: async () => ({ selectedFactIds: ["fact-0"] }),
    },
    executor: {
      ...unconfiguredExecutor,
      ...setup.value.executor!,
      discoverProjectMetadata: async () => identification,
    },
  };
  const cache = new Map<string, unknown>();
  await executeReviewWorkflow(
    settings,
    event("cached-replay"),
    cachedSteps(cache),
    configured,
  );
  const first = await ledger.loadRunTelemetry(job.runId);
  expect(first?.tokens.inputTokens).toBe(100);
  clock.mockReturnValue(initialTime + 180_000);
  cache.delete("analyze-shard-1");
  cache.delete("analyze-review");
  cache.delete("save-run-telemetry");
  await executeReviewWorkflow(
    settings,
    event("cached-replay"),
    cachedSteps(cache),
    configured,
  );
  expect(review).toHaveBeenCalledTimes(2);
  expect(review.mock.calls[1]?.[1]).toMatchObject({
    projectIdentification: {
      projects: [{ technologies: [{ name: "react" }] }],
    },
  });
  const replayed = await ledger.loadRunTelemetry(job.runId);
  expect(replayed?.tokens.inputTokens).toBe(100);
  expect(replayed?.queueWaitMs).toBe(first?.queueWaitMs);
});

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
    configurationReader: () => configurationReader(),
    currentHeadSha: () => Promise.resolve(readHead()),
    currentPullRequestRefs: () =>
      Promise.resolve({ baseSha: "b".repeat(40), headSha: readHead() }),
    expectedAuthorLogin: "holon-reviewer[bot]",
    expiresAt: "2026-08-29T13:00:00.000Z",
    pullRequestDiff: () => Promise.resolve(canonicalPatch),
    token: "installation-token-long-enough",
  };
}

function runtime(
  options: {
    readonly containerId?: string | null;
    readonly context?: ReviewShardContext;
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
  const prepareRepository = vi.fn(() =>
    Promise.resolve({
      changedLineCount: (options.context ?? context).changedLines.length,
      contextBytes: 100,
      fileCount: (options.context ?? context).files.length,
      runId: job.runId,
      effectivePolicyDigest: "c".repeat(64),
      waiversCount: 0,
      truncated: false,
    }),
  );
  const value: ReviewRuntime = {
    reconcileCheckRun: async (runId, connect) => {
      const ledger = env.REVIEW_LEDGERS.getByName(
        runId.slice(0, runId.indexOf(":head:")),
      );
      await runInDurableObject(ledger, async (_object, state) => {
        await new CheckRunReconciliationStore(state.storage).processDue(
          env,
          new Date().toISOString(),
          connect,
          runId,
        );
      });
      return await ledger.checkRunId(runId as RunId);
    },
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
      ...unconfiguredExecutor,
      cleanup,
      hasContext: () => Promise.resolve(true),
      loadContext: () =>
        Promise.resolve({
          ...(options.context ?? context),
          effectivePolicyDigest: "c".repeat(64),
          policySource: "default",
          sourceDigest: null,
          verdictStrictness: "default",
          waiversCount: 0,
        }),
      prepareRepository,
      ...(options.containerId === null ? {} : { resolveContainerId }),
      runTool: () => Promise.resolve({ content: "", truncated: false }),
    },
    logger: options.logger ?? { emit: () => undefined },
    now: options.now ?? (() => "2026-08-29T12:00:05.000Z"),
    wait: () => Promise.resolve(),
    ...(options.workflow === undefined ? {} : { workflow: options.workflow }),
  };
  return { cleanup, posts, prepareRepository, resolveContainerId, value };
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
  it.each([
    ["en", "The saved repository configuration failed integrity validation."],
    ["pt-BR", "A configuração persistida falhou na validação de integridade."],
    ["es", "La configuración guardada falló la validación de integridad."],
  ])(
    "localizes post-seal failure and cleans private configuration without starting the Sandbox (%s)",
    async (language, message) => {
      const setup = runtime();
      setup.value = {
        ...setup.value,
        createSession: () =>
          Promise.resolve({
            ...session(setup.posts),
            configurationReader: () =>
              configurationReader({
                ".holon.yml": `output:\n  language: ${language}\ninstructions:\n  - private-guidance-never-log\n`,
              }),
          }),
        executor: {
          ...unconfiguredExecutor,
          ...setup.value.executor!,
          resolveContainerId: async () => {
            throw new RepositoryConfigurationError("snapshot_mismatch");
          },
        },
      };
      await expect(
        executeReviewWorkflow(
          env,
          event(`configuration-cleanup-${language}`),
          immediateStep([]),
          setup.value,
        ),
      ).rejects.toThrow();
      expect(setup.prepareRepository).not.toHaveBeenCalled();
      expect(JSON.stringify(setup.posts)).toContain(message);
      expect(JSON.stringify(setup.posts)).not.toContain(
        "private-guidance-never-log",
      );
      const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
      const ref = await ledger.findRunConfiguration(job.runId);
      expect(ref).toBeDefined();
      await runDurableObjectAlarm(ledger);
      await expect
        .poll(
          async () => (await ledger.cleanupState(job.runId as RunId))?.state,
        )
        .toBe("completed");
      await runInDurableObject(ledger, async (object, state) => {
        expect(
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM run_configuration_artifacts",
            )
            .one().count,
        ).toBe(0);
        expect(
          (await object.getSanitizedAdminRunDetail(job.runId))?.configuration
            ?.output.language,
        ).toBe(language);
      });
    },
  );

  it.each([0, 1])(
    "limits inline publication to %i without losing findings or changing verdict",
    async (cap) => {
      const second = {
        ...finding,
        diagnostic:
          "The second changed return also violates its caller contract.",
        location: { ...finding.location, path: "src/second.ts" },
        evidence: finding.evidence.map((entry) => ({
          ...entry,
          path: "src/second.ts",
        })),
      };
      const secondPatch = canonicalPatch.replaceAll(
        "src/index.ts",
        "src/second.ts",
      );
      const setup = runtime({
        context: {
          ...context,
          changedLines: [
            ...context.changedLines,
            { line: 10, path: "src/second.ts", side: "RIGHT" },
          ],
          files: [
            ...context.files,
            { mode: "structural", path: "src/second.ts", patch: secondPatch },
          ],
        },
        model: () => ({
          review: async () => ({
            output: {
              findings: [finding, second],
              summary: "Two independent regressions.",
            },
            promptTruncated: false,
          }),
        }),
      });
      const readerFactory = vi.fn(() =>
        configurationReader({
          ".github/holon.yml": `output:\n  language: es\n  max_inline_comments: ${cap}\n`,
        }),
      );
      setup.value = {
        ...setup.value,
        createSession: () =>
          Promise.resolve({
            ...session(setup.posts),
            configurationReader: readerFactory,
            pullRequestDiff: async () => canonicalPatch + "\n" + secondPatch,
          }),
      };
      const result = await executeReviewWorkflow(
        env,
        event(`cap-${cap}`),
        immediateStep([]),
        setup.value,
      );
      expect(result).toEqual({ findingsPublished: cap, outcome: "completed" });
      expect(
        setup.posts.filter(
          (post) =>
            post.route ===
            "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments",
        ),
      ).toHaveLength(cap);
      expect(
        setup.posts.find((post) =>
          post.route.includes("/pulls/{pull_number}/reviews"),
        )?.event,
      ).toBe("REQUEST_CHANGES");
      const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
      const detail = await ledger.getSanitizedAdminRunDetail(job.runId);
      expect(detail?.historicalRunFindings).toHaveLength(2);
      expect(detail?.historicalRunFindings?.[0]?.details?.evidence).toEqual(
        finding.evidence,
      );
      expect(
        (await ledger.loadLatestReviewDecision("github:42:pr:7"))?.output,
      ).toMatchObject({ language: "es", maxInlineComments: cap });
      expect(readerFactory).toHaveBeenCalledTimes(1);
    },
  );

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

  it("fails instead of synthesizing a legacy container identity", async () => {
    const setup = runtime({ containerId: null });
    await expect(
      executeReviewWorkflow(
        env,
        event("missing-container-identity"),
        immediateStep([]),
        setup.value,
      ),
    ).rejects.toBeInstanceOf(TypeError);
    expect(setup.prepareRepository).not.toHaveBeenCalled();
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
    expect(setup.prepareRepository).not.toHaveBeenCalled();
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

    expect(headReads).toBe(7);
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
        return headReads < 5 ? "a".repeat(40) : "c".repeat(40);
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
          configurationReader: () =>
            configurationReader({
              ".github/holon.yml": "output: [secret-invalid-value",
            }),
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

    expect(setup.prepareRepository).not.toHaveBeenCalled();
    expect(setup.resolveContainerId).not.toHaveBeenCalled();
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
    expect(setup.prepareRepository).not.toHaveBeenCalled();
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

    const newerJob = reviewJobSchema.parse({
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
      runId: `github:42:pr:7:head:${"b".repeat(40)}:base:${"b".repeat(40)}`,
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

    const newerJob = reviewJobSchema.parse({
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
      runId: `github:42:pr:7:head:${"b".repeat(40)}:base:${"b".repeat(40)}`,
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
    expect(duplicate.prepareRepository).not.toHaveBeenCalled();
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
        ...unconfiguredExecutor,
        ...setup.value.executor!,
        hasContext: () => Promise.resolve(contextExists),
        prepareRepository: () => {
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
            effectivePolicyDigest: "c".repeat(64),
            waiversCount: 0,
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
          "github:42:pr:7:head:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:base:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
    const cachedRunId =
      `github:42:pr:7:head:${"b".repeat(40)}:base:${"b".repeat(40)}` as RunId;
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
      { ...testRun, causalVersion: "2026-08-29T12:00:00.000Z" },
      "workflow-cached",
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
          configurationReader: () => configurationReader(),
          currentHeadSha: () => Promise.resolve("b".repeat(40)),
          currentPullRequestRefs: () =>
            Promise.resolve({
              baseSha: "b".repeat(40),
              headSha: "b".repeat(40),
            }),
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
    ).toHaveLength(2);
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

    expect(checkRunPatches).toHaveLength(2);
    expect(checkRunPatches[1]?.parameters).toMatchObject({
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

    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
    await runInDurableObject(ledger, (_object, state) => {
      const row = state.storage.sql
        .exec<{
          revision: number;
          completed_revision: number;
          attempts: number;
        }>("SELECT * FROM check_run_tasks WHERE run_id=?", job.runId)
        .one();
      expect(row.revision).toBeGreaterThan(row.completed_revision);
      expect(row.attempts).toBeGreaterThan(0);
    });
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
        truncated: false,
      },
      model: () => ({
        review: () => {
          modelCalls += 1;
          if (modelCalls === 2) {
            return Promise.reject(new ModelProviderRequestError(true, 504));
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
    expect(summaryPost?.body).toContain("This review is incomplete.");
    expect(summaryPost?.body).not.toContain("Shard 2 review succeeded.");
    expect(summaryPost?.body).toContain(
      "Partial review: some changes could not be analyzed due to an execution failure.",
    );
  });

  it("handles unsupported plans with 0 eligible files in review-workflow", async () => {
    const setup = runtime({
      context: {
        changedLines: [],
        files: [],
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
    const reviewContext = { ...context, files: [...context.files] };
    let resolutions: NonNullable<ModelReviewOutput["resolutions"]> = [];

    const createJobForSha = (sha: string): ReviewJob =>
      reviewJobSchema.parse({
        ...job,
        envelope: {
          ...job.envelope,
          pullRequest: {
            ...job.envelope.pullRequest,
            headSha: sha,
          },
        },
        runId: `github:42:pr:7:head:${sha}:base:${"b".repeat(40)}`,
      });

    const setup = runtime({
      context: reviewContext,
      head: () => currentHead,
      model: () => ({
        review: () =>
          Promise.resolve({
            output: {
              resolutions,
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
    reviewContext.files = [
      {
        ...context.files[0]!,
        patch: canonicalPatch.replace("return null;", "return value;"),
      },
    ];
    const previous = (
      await env.REVIEW_LEDGERS.getByName("github:42:pr:7").loadPrFindings(
        "github:42:pr:7",
      )
    )[0]!;
    resolutions = [
      {
        fingerprint: previous.fingerprint,
        confidence: 0.98,
        diagnostic: "The corrected branch now returns the required value.",
        location: finding.location,
        evidence: [
          {
            ...finding.evidence[0]!,
            excerpt: "return value;",
            reason: "The required non-null value is returned.",
          },
        ],
      },
    ];

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
    expect(resolutionReply?.body).toContain("Issue resolved in commit");

    // Verdict for run 3 transitions to APPROVE automatically!
    const summaryPostRun3 = posts.findLast((p) =>
      p.route.includes("/pulls/{pull_number}/reviews"),
    );
    expect(summaryPostRun3?.event).toBe("APPROVE");

    // 4. Commit 4: finding is reintroduced!
    const sha4 = "4".repeat(40);
    currentHead = sha4;
    currentFindings = [finding];
    resolutions = [];
    reviewContext.files = [...context.files];
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

  it("propagates resolution reply failure for durable retry instead of silently completing", async () => {
    const posts: Array<{
      readonly body: unknown;
      readonly event?: unknown;
      readonly route: string;
    }> = [];

    const sha1 = "1".repeat(40);
    const sha2 = "2".repeat(40);
    const createJobForSha = (sha: string): ReviewJob =>
      reviewJobSchema.parse({
        ...job,
        envelope: {
          ...job.envelope,
          pullRequest: {
            ...job.envelope.pullRequest,
            headSha: sha,
          },
        },
        runId: `github:42:pr:7:head:${sha}:base:${"b".repeat(40)}`,
      });

    let currentHead = sha1;
    const reviewContext = { ...context, files: [...context.files] };
    let resolutions: NonNullable<ModelReviewOutput["resolutions"]> = [];

    const setup = runtime({
      context: reviewContext,
      head: () => currentHead,
      model: () => ({
        review: () =>
          Promise.resolve({
            output: {
              resolutions,
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

    // Run 2: a verified correction requires a reply, but the endpoint rejects.
    currentHead = sha2;
    reviewContext.files = [
      {
        ...context.files[0]!,
        patch: canonicalPatch.replace("return null;", "return value;"),
      },
    ];
    const previous = (
      await env.REVIEW_LEDGERS.getByName("github:42:pr:7").loadPrFindings(
        "github:42:pr:7",
      )
    )[0]!;
    resolutions = [
      {
        fingerprint: previous.fingerprint,
        confidence: 0.98,
        diagnostic: "The corrected branch now returns the required value.",
        location: finding.location,
        evidence: [
          {
            ...finding.evidence[0]!,
            excerpt: "return value;",
            reason: "The required non-null value is returned.",
          },
        ],
      },
    ];

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

    await expect(
      executeReviewWorkflow(
        env,
        event("res-fail-run-2", createJobForSha(sha2)),
        immediateStep([]),
        runtimeWithFailingReply,
      ),
    ).rejects.toThrow("HOLON_GITHUB_TRANSIENT");
  });

  it("incorporates pre-existing CI evidence saved in ledger into initial review summary", async () => {
    const posts: Array<{ readonly route: string; readonly body: unknown }> = [];
    const targetSha = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const prKey = "github:42:pr:7" as const;
    const ledger = env.REVIEW_LEDGERS.getByName(prKey);

    await ledger.saveCiEvidence(prKey, targetSha, {
      workflowRunAttempt: 1,
      target: {
        installationId: 99,
        repositoryId: 42,
        owner: "acme",
        repo: "api",
        pullNumber: 7,
      },
      markdownByLanguage: {
        en: "### 🧪 CI Test & Coverage Evidence\nCoverage: 92.5%",
        "pt-BR": "### 🧪 CI Test & Coverage Evidence\nCoverage: 92.5%",
        es: "### 🧪 CI Test & Coverage Evidence\nCoverage: 92.5%",
      },
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

    const targetJob: ReviewJob = reviewJobSchema.parse({
      ...job,
      envelope: {
        ...job.envelope,
        pullRequest: {
          ...job.envelope.pullRequest,
          headSha: targetSha,
        },
      },
      runId: `github:42:pr:7:head:${targetSha}:base:${"b".repeat(40)}`,
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
    setup.prepareRepository.mockImplementation(() => {
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
  const review = vi.fn(
    async (_job: ReviewJob, _context: ReviewShardContext) => ({
      output: { findings: [], summary: "No issues." },
      promptTruncated: false,
    }),
  );
  const setup = runtime({ model: () => ({ review }) });
  const settings: Record<string, string> = {
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
        ...unconfiguredExecutor,
        ...setup.value.executor!,
        discoverProjectMetadata: async () => result,
      },
    },
  );
  expect(names).toContain("discover-project-metadata");
  expect(names).toContain("identify-project-0");
  expect(names).toContain("record-project-identification");
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
  const overrides: Record<string, string> = {};
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
        ...unconfiguredExecutor,
        ...setup.value.executor!,
        discoverProjectMetadata: async () => result,
      },
    },
  );
  expect(names).toContain("wait-project-identification-0-0");
  expect(identify).not.toHaveBeenCalled();
});

it("schedules durable cleanup before failed accounting can interrupt terminalization", async () => {
  const setup = runtime({
    model: () => ({
      review: async () => {
        throw new Error("analysis infrastructure unavailable");
      },
    }),
  });
  const steps: string[] = [];
  await expect(
    executeReviewWorkflow(
      env,
      event("failed-accounting"),
      immediateStep(steps, undefined, {
        "failed-snapshot-accounting": new Error("accounting unavailable"),
      }),
      setup.value,
    ),
  ).rejects.toThrow("accounting unavailable");
  expect(
    steps.indexOf("mark-review-terminal-and-schedule-cleanup"),
  ).toBeLessThan(steps.indexOf("failed-snapshot-accounting"));
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  expect(await ledger.runState(job.runId as RunId)).toBe("failed_terminal");
  await runInDurableObject(ledger, (_object, state) => {
    expect(
      state.storage.sql
        .exec("SELECT run_id FROM cleanup_tasks WHERE run_id=?", job.runId)
        .toArray(),
    ).toHaveLength(1);
  });
});

it("parallel shard tools share one preparation and retain independent budgets", async () => {
  const { createReviewServices } = await import("../src/review-services.js");
  const setup = runtime();
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  await ledger.claimRun(createReviewRun(job), "parallel-tools");
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prepare = vi.fn(async () => {
    await barrier;
    return {
      changedLineCount: 1,
      contextBytes: 100,
      fileCount: 1,
      runId: job.runId,
      effectivePolicyDigest: "c".repeat(64),
      waiversCount: 0,
      truncated: false,
    };
  });
  let ready = false;
  const runTool = vi.fn(async () => ({
    content: "return null;",
    truncated: false,
  }));
  const services = createReviewServices(
    env,
    job,
    {
      ...setup.value,
      executor: {
        ...setup.value.executor!,
        hasContext: async () => ready,
        prepareRepository: async (request) => {
          const result = await prepare();
          expect(request.runId).toBe(job.runId);
          ready = true;
          return result;
        },
        runTool,
      },
      createModel: (toolRunner) => ({
        review: async () => {
          await toolRunner.run({
            name: "read_file",
            arguments: { path: "src/index.ts", startLine: 1, endLine: 10 },
          });
          return {
            output: { findings: [], summary: "Checked the changed code." },
            promptTruncated: false,
          };
        },
      }),
    },
    { emit: () => {} },
    {},
  );
  const policy = await defaultScopePolicy(job.envelope.pullRequest.baseSha);
  const a = services.createShardReviewer(0, 2, policy);
  const b = services.createShardReviewer(1, 2, policy);
  const tasks = [a.model.review(job, context), b.model.review(job, context)];
  await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  release();
  await Promise.all(tasks);
  expect(prepare).toHaveBeenCalledOnce();
  expect(runTool).toHaveBeenCalledTimes(2);
  expect(a.toolBudgetExceeded()).toBe(false);
  expect(b.toolBudgetExceeded()).toBe(false);
});
