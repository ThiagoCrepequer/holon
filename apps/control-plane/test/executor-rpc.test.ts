import { reviewJobSchema } from "@holon/contracts";
import { env } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { describe, expect, it, vi } from "vitest";

import { createReviewServices } from "../src/review/review-services.js";
import { defaultScopePolicy } from "./configuration-fixtures.js";
import { configurationReader } from "./configuration-fixtures.js";
import { toolOperation } from "./executor-fixture.js";
import { unconfiguredExecutor } from "./executor-fixture.js";

const canonicalPatch = [
  "diff --git a/src/index.ts b/src/index.ts",
  "--- a/src/index.ts",
  "+++ b/src/index.ts",
  "@@ -9,0 +10,1 @@",
  "+return null;",
].join("\n");

const job = reviewJobSchema.parse({
  envelope: {
    action: "opened",
    deliveryId: "github:delivery-rpc-current",
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

function installationSession() {
  return {
    api: {
      async *iterate() {
        yield [];
      },
      request: () => Promise.resolve({ data: { id: 1 } }),
    },
    configurationReader: () => configurationReader(),
    currentHeadSha: () => Promise.resolve("a".repeat(40)),
    currentPullRequestRefs: () =>
      Promise.resolve({ baseSha: "b".repeat(40), headSha: "a".repeat(40) }),
    expectedAuthorLogin: "holon-reviewer[bot]",
    expiresAt: "2026-08-29T13:00:00.000Z",
    pullRequestDiff: () => Promise.resolve(canonicalPatch),
    token: "ephemeral-installation-token",
  };
}

describe("current executor RPC contract", () => {
  it("validates retry bounds and preserves a non-retryable repository result", async () => {
    const permanent = new NonRetryableError("permanent");
    const services = createReviewServices(
      env,
      job,
      {
        createSession: () => Promise.resolve(installationSession()),
        executor: {
          ...unconfiguredExecutor,
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          prepareRepository: () => Promise.reject(permanent),
          startTool: toolOperation(async () => ({
            content: "",
            truncated: false,
          })),
          acquireReviewLease: async () => {},
        },
      },
      { emit: () => undefined },
      {},
    );

    await expect(services.prepareRepository(0)).rejects.toThrow(
      "maximumAttempts must be a positive safe integer",
    );
    await expect(
      services.prepareRepository(1, await defaultScopePolicy("b".repeat(40))),
    ).rejects.toBe(permanent);
  });
  it("prepares and reads context using the current RPC contracts", async () => {
    const policy = {
      additionalExcludes: ["vendor/**"],
      baseSha: "b".repeat(40),
      effectivePolicyDigest: "c".repeat(64),
      source: ".github/holon.yml" as const,
      sourceDigest: "d".repeat(64),
      verdictStrictness: "block_all_confident_medium" as const,
    };
    const prepareRepository = vi.fn().mockResolvedValue({
      changedLineCount: 1,
      contextBytes: 100,
      effectivePolicyDigest: "c".repeat(64),
      fileCount: 1,
      runId: job.runId,
      truncated: false,
      waiversCount: 0,
    });
    const loadContext = vi.fn().mockResolvedValue({
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      effectivePolicyDigest: "c".repeat(64),
      files: [
        {
          mode: "structural",
          patch: canonicalPatch,
          path: "src/index.ts",
        },
      ],
      policySource: ".github/holon.yml",
      sourceDigest: "d".repeat(64),
      truncated: false,
      verdictStrictness: "block_all_confident_medium",
      waiversCount: 0,
    });
    const services = createReviewServices(
      env,
      job,
      {
        createSession: () => Promise.resolve(installationSession()),
        executor: {
          ...unconfiguredExecutor,
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          loadContext,
          prepareRepository,
          startTool: toolOperation(async () => ({
            content: "",
            truncated: false,
          })),
          acquireReviewLease: async () => {},
        },
      },
      { emit: () => undefined },
      {},
    );

    const prepared = await services.prepareRepository(1, policy);
    expect(prepared).toMatchObject({
      runId: job.runId,
      effectivePolicyDigest: policy.effectivePolicyDigest,
    });
    expect(prepareRepository).toHaveBeenCalledOnce();

    const loaded = await services.loadContext();
    expect(loaded).toMatchObject({
      policySource: ".github/holon.yml",
    });
    expect(loadContext).toHaveBeenCalledOnce();
  });
  it("reads live refs and rejects sessions without the required method", async () => {
    const sessionWithRefs = {
      ...installationSession(),
      currentPullRequestRefs: () =>
        Promise.resolve({ baseSha: "b".repeat(40), headSha: "a".repeat(40) }),
    };
    const services1 = createReviewServices(
      env,
      job,
      {
        createSession: () => Promise.resolve(sessionWithRefs),
        executor: {
          ...unconfiguredExecutor,
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          startTool: toolOperation(async () => ({
            content: "",
            truncated: false,
          })),
          acquireReviewLease: async () => {},
        },
      },
      { emit: () => undefined },
      {},
    );
    const refs1 = await services1.readCurrentRefs();
    expect(refs1).toEqual({
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
    });
    const head1 = await services1.readCurrentHead();
    expect(head1).toBe("a".repeat(40));

    const mutation1 = await services1.createMutationContext();
    const mutationRefs1 = await mutation1.readCurrentRefs();
    expect(mutationRefs1).toEqual({
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
    });
    const mutationHead1 = await mutation1.readCurrentHead();
    expect(mutationHead1).toBe("a".repeat(40));

    const sessionWithoutRefs = {
      ...installationSession(),
      configurationReader: () => configurationReader(),
      currentHeadSha: () => Promise.resolve("a".repeat(40)),
      currentPullRequestRefs: undefined,
    };
    const services2 = createReviewServices(
      env,
      job,
      {
        createSession: () =>
          Promise.resolve(
            sessionWithoutRefs as unknown as ReturnType<
              typeof installationSession
            >,
          ),
        executor: {
          ...unconfiguredExecutor,
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          startTool: toolOperation(async () => ({
            content: "",
            truncated: false,
          })),
          acquireReviewLease: async () => {},
        },
      },
      { emit: () => undefined },
      {},
    );
    await expect(services2.readCurrentRefs()).rejects.toThrow();
    const mutation2 = await services2.createMutationContext();
    await expect(mutation2.readCurrentRefs()).rejects.toThrow();
  });

  it("rejects unavailable current RPCs without calling old methods", async () => {
    const executor = {
      ...unconfiguredExecutor,
      cleanup: async () => {},
      hasContext: async () => true,
      startTool: toolOperation(async () => ({ content: "", truncated: false })),
      acquireReviewLease: async () => {},
      prepareRepository: async () => {
        throw new TypeError(
          'The RPC receiver does not implement the method "prepareRepository".',
        );
      },
      loadContext: async () => {
        throw new TypeError(
          'The RPC receiver does not implement the method "loadContext".',
        );
      },
    };
    const services = createReviewServices(
      env,
      job,
      {
        executor,
        createSession: async () => installationSession(),
      },
      { emit: () => {} },
      {},
    );
    await expect(
      services.prepareRepository(1, await defaultScopePolicy("b".repeat(40))),
    ).rejects.toBeInstanceOf(NonRetryableError);
    await expect(services.loadContext()).rejects.toBeInstanceOf(TypeError);
  });
  it.each([2, 3])(
    "rejects old context V%s from the current endpoint",
    async (schemaVersion) => {
      const services = createReviewServices(
        env,
        job,
        {
          createSession: async () => installationSession(),
          executor: {
            ...unconfiguredExecutor,
            cleanup: async () => {},
            hasContext: async () => true,
            startTool: toolOperation(async () => ({
              content: "",
              truncated: false,
            })),
            acquireReviewLease: async () => {},
            prepareRepository: vi.fn().mockResolvedValue({
              changedLineCount: 0,
              contextBytes: 1,
              fileCount: 0,
              runId: job.runId,
              truncated: false,
            }),
            loadContext: vi.fn().mockResolvedValue({
              schemaVersion,
              effectivePolicyDigest: "c".repeat(64),
              policySource: "default",
              sourceDigest: null,
              verdictStrictness: "default",
              waiversCount: 0,
              changedLines: [],
              files: [],
              truncated: false,
            }),
          },
        },
        { emit: () => {} },
        {},
      );
      await expect(
        services.prepareRepository(1, await defaultScopePolicy("b".repeat(40))),
      ).rejects.toBeInstanceOf(NonRetryableError);
      await expect(services.loadContext()).rejects.toThrow();
    },
  );
});
