import { reviewJobV2Schema } from "@holon/contracts";
import { env } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { describe, expect, it, vi } from "vitest";

import { createReviewServices } from "../src/review-services.js";

const canonicalPatch = [
  "diff --git a/src/index.ts b/src/index.ts",
  "--- a/src/index.ts",
  "+++ b/src/index.ts",
  "@@ -9,0 +10,1 @@",
  "+return null;",
].join("\n");

const job = reviewJobV2Schema.parse({
  envelope: {
    action: "opened",
    deliveryId: "github:delivery-rpc-compatibility",
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

function installationSession() {
  return {
    api: {
      async *iterate() {
        yield [];
      },
      request: () => Promise.resolve({ data: { id: 1 } }),
    },
    currentHeadSha: () => Promise.resolve("a".repeat(40)),
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
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          prepareRepositoryV3: () => Promise.reject(permanent),
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
      },
      { emit: () => undefined },
      {},
    );

    await expect(services.prepareRepository(0)).rejects.toThrow(
      "maximumAttempts must be a positive safe integer",
    );
    await expect(services.prepareRepository(1)).rejects.toBe(permanent);
  });
  it("prepares repository and loads context with V3 when supported", async () => {
    const policy = {
      additionalExcludes: ["vendor/**"],
      baseSha: "b".repeat(40),
      effectivePolicyDigest: "c".repeat(64),
      source: ".github/holon.yml" as const,
      sourceDigest: "d".repeat(64),
      verdictStrictness: "block_all_confident_medium" as const,
      version: 1 as const,
    };
    const prepareRepositoryV3 = vi.fn().mockResolvedValue({
      changedLineCount: 1,
      contextBytes: 100,
      effectivePolicyDigest: "c".repeat(64),
      fileCount: 1,
      runId: job.runId,
      schemaVersion: 3,
      truncated: false,
      waiversCount: 0,
    });
    const loadContextV3 = vi.fn().mockResolvedValue({
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
      schemaVersion: 3,
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
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          loadContextV3,
          prepareRepositoryV3,
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
      },
      { emit: () => undefined },
      {},
    );

    const prepared = await services.prepareRepository(1, policy);
    expect(prepared).toMatchObject({ schemaVersion: 3 });
    expect(prepareRepositoryV3).toHaveBeenCalledOnce();

    const loaded = await services.loadContext();
    expect(loaded).toMatchObject({
      policySource: ".github/holon.yml",
      schemaVersion: 3,
    });
    expect(loadContextV3).toHaveBeenCalledOnce();
  });
  it("reads current refs via session or falls back to headSha", async () => {
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
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          runTool: () => Promise.resolve({ content: "", truncated: false }),
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
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
      },
      { emit: () => undefined },
      {},
    );
    const refs2 = await services2.readCurrentRefs();
    expect(refs2).toEqual({
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
    });

    const mutation2 = await services2.createMutationContext();
    const mutationRefs2 = await mutation2.readCurrentRefs();
    expect(mutationRefs2).toEqual({
      baseSha: "b".repeat(40),
      headSha: "a".repeat(40),
    });
  });

  it("rejects unavailable current RPCs without calling old methods", async () => {
    const prepare = vi.fn();
    const prepareRepositoryV2 = vi.fn().mockResolvedValue({ schemaVersion: 2 });
    const loadContext = vi.fn();
    const loadContextV2 = vi.fn().mockResolvedValue({ schemaVersion: 2 });
    const executor = {
      cleanup: async () => {},
      hasContext: async () => true,
      runTool: async () => ({ content: "", truncated: false }),
      prepare,
      prepareRepositoryV2,
      loadContext,
      loadContextV2,
      prepareRepositoryV3: async () => {
        throw new TypeError(
          'The RPC receiver does not implement the method "prepareRepositoryV3".',
        );
      },
      loadContextV3: async () => {
        throw new TypeError(
          'The RPC receiver does not implement the method "loadContextV3".',
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
    await expect(services.prepareRepository(1)).rejects.toBeInstanceOf(
      NonRetryableError,
    );
    await expect(services.loadContext()).rejects.toBeInstanceOf(TypeError);
    for (const old of [
      prepare,
      prepareRepositoryV2,
      loadContext,
      loadContextV2,
    ])
      expect(old).not.toHaveBeenCalled();
  });
  it("rejects old response shapes from current endpoints", async () => {
    const services = createReviewServices(
      env,
      job,
      {
        createSession: async () => installationSession(),
        executor: {
          cleanup: async () => {},
          hasContext: async () => true,
          runTool: async () => ({ content: "", truncated: false }),
          prepareRepositoryV3: vi
            .fn()
            .mockResolvedValue({
              schemaVersion: 2,
              changedLineCount: 0,
              contextBytes: 1,
              fileCount: 0,
              runId: job.runId,
              truncated: false,
            }),
          loadContextV3: vi
            .fn()
            .mockResolvedValue({
              schemaVersion: 2,
              changedLines: [],
              files: [],
              truncated: false,
            }),
        },
      },
      { emit: () => {} },
      {},
    );
    await expect(services.prepareRepository(1)).rejects.toBeInstanceOf(
      NonRetryableError,
    );
    await expect(services.loadContext()).rejects.toThrow();
  });
});
