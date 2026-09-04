import { reviewJobV2Schema } from "@holon/contracts";
import { env } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { describe, expect, it, vi } from "vitest";

import {
  createReviewServices,
  isExecutorRpcMethodUnavailable,
} from "../src/review-services.js";

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

describe("executor RPC compatibility fixture", () => {
  it("recognizes only the exact workerd unavailable-method signal", () => {
    expect(
      isExecutorRpcMethodUnavailable(
        new TypeError(
          'The RPC receiver does not implement the method "prepareRepositoryV2".',
        ),
        "prepareRepositoryV2",
      ),
    ).toBe(true);
    expect(
      isExecutorRpcMethodUnavailable(
        new TypeError("executor rejected the request"),
        "prepareRepositoryV2",
      ),
    ).toBe(false);
  });

  it("recognizes the unavailable-method signal from a real v1 service binding", async () => {
    let caught: unknown;
    try {
      await env.REPOSITORY_EXECUTOR.prepareRepositoryV2!({
        baseSha: job.envelope.pullRequest.baseSha,
        canonicalDiff: canonicalPatch,
        cloneUrl: "https://github.com/acme/api.git",
        headSha: job.envelope.pullRequest.headSha,
        installationId: job.envelope.installationId,
        pullRequestNumber: job.envelope.pullRequest.number,
        repositoryId: job.envelope.repository.id,
        repositoryName: job.envelope.repository.name,
        repositoryOwner: job.envelope.repository.owner,
        runId: job.runId,
        schemaVersion: 2,
      });
    } catch (error) {
      caught = error;
    }

    expect(isExecutorRpcMethodUnavailable(caught, "prepareRepositoryV2")).toBe(
      true,
    );
  });

  it("falls back to v1 only for unavailable RPC methods and keeps the token ephemeral", async () => {
    const prepare = vi.fn(() =>
      Promise.resolve({
        changedLineCount: 1,
        contextBytes: 100,
        fileCount: 1,
        runId: job.runId,
        schemaVersion: 1 as const,
        truncated: false,
      }),
    );
    const loadContext = vi.fn(() =>
      Promise.resolve({
        changedLines: [
          { line: 10, path: "src/index.ts", side: "RIGHT" as const },
        ],
        diff: canonicalPatch,
        surface: [
          {
            change: "added" as const,
            excerpt: "return null;",
            kind: "contract" as const,
            line: 10,
            path: "src/index.ts",
          },
        ],
      }),
    );
    const services = createReviewServices(
      env,
      job,
      {
        createSession: () => Promise.resolve(installationSession()),
        executor: {
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          loadContext,
          prepare,
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
      },
      { emit: () => undefined },
      {},
    );

    await expect(services.prepareRepository(1)).resolves.toMatchObject({
      schemaVersion: 2,
    });
    await expect(services.loadContext()).resolves.toMatchObject({
      files: [
        { mode: "structural", patch: canonicalPatch, path: "src/index.ts" },
      ],
      schemaVersion: 2,
      surface: [{ kind: "contract", path: "src/index.ts" }],
      truncated: false,
    });
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: 1 }),
      "ephemeral-installation-token",
    );
    expect(loadContext).toHaveBeenCalledWith(job.runId);
  });

  it("never falls back to v1 for a functional v2 failure", async () => {
    const prepare = vi.fn();
    const services = createReviewServices(
      env,
      job,
      {
        createSession: () => Promise.resolve(installationSession()),
        executor: {
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          prepare,
          prepareRepositoryV2: () =>
            Promise.reject(new Error("executor rejected the repository")),
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
      },
      { emit: () => undefined },
      {},
    );

    await expect(services.prepareRepository(1)).rejects.toMatchObject({
      name: "RepositoryTransientError",
    });
    expect(prepare).not.toHaveBeenCalled();
  });

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
          prepareRepositoryV2: () => Promise.reject(permanent),
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

  it("reprepares through v1 when context is absent and converts ignored legacy diffs", async () => {
    const prepare = vi.fn(() =>
      Promise.resolve({
        changedLineCount: 0,
        contextBytes: 10,
        fileCount: 0,
        runId: job.runId,
        schemaVersion: 1 as const,
        truncated: false,
      }),
    );
    const services = createReviewServices(
      env,
      job,
      {
        createSession: () => Promise.resolve(installationSession()),
        executor: {
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(false),
          loadContext: () =>
            Promise.resolve({
              changedLines: [],
              diff: [
                "diff --git a/package-lock.json b/package-lock.json",
                "--- a/package-lock.json",
                "+++ b/package-lock.json",
                "@@ -1,0 +1,1 @@",
                "+{}",
              ].join("\n"),
            }),
          prepare,
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
      },
      { emit: () => undefined },
      {},
    );

    await services.ensureContext(1);
    await expect(services.loadContext()).resolves.toMatchObject({
      files: [],
      schemaVersion: 2,
      truncated: false,
    });
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("fails closed when neither executor version exposes the required method", async () => {
    const services = createReviewServices(
      env,
      job,
      {
        createSession: () => Promise.resolve(installationSession()),
        executor: {
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
      },
      { emit: () => undefined },
      {},
    );

    await expect(services.prepareRepository(1)).rejects.toMatchObject({
      name: "RepositoryTransientError",
    });
    await expect(services.loadContext()).rejects.toMatchObject({
      name: "RepositoryTransientError",
    });
  });

  it("does not fall back to v1 context after a functional v2 error", async () => {
    const loadContext = vi.fn();
    const functional = new Error("context rejected");
    const services = createReviewServices(
      env,
      job,
      {
        createSession: () => Promise.resolve(installationSession()),
        executor: {
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          loadContext,
          loadContextV2: () => Promise.reject(functional),
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
      },
      { emit: () => undefined },
      {},
    );

    await expect(services.loadContext()).rejects.toBe(functional);
    expect(loadContext).not.toHaveBeenCalled();
  });

  it("recognizes workerd unavailable-method signal for V3 methods", () => {
    expect(
      isExecutorRpcMethodUnavailable(
        new TypeError(
          'The RPC receiver does not implement the method "prepareRepositoryV3".',
        ),
        "prepareRepositoryV3",
      ),
    ).toBe(true);
    expect(
      isExecutorRpcMethodUnavailable(
        new TypeError(
          'The RPC receiver does not implement the method "loadContextV3".',
        ),
        "loadContextV3",
      ),
    ).toBe(true);
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

  it("fails closed without fallback to V2 when custom policy is active and prepareRepositoryV3 is unavailable", async () => {
    const customPolicy = {
      additionalExcludes: ["vendor/**"],
      baseSha: "b".repeat(40),
      effectivePolicyDigest: "c".repeat(64),
      source: ".github/holon.yml" as const,
      sourceDigest: "d".repeat(64),
      verdictStrictness: "default" as const,
      version: 1 as const,
    };
    const prepareRepositoryV2 = vi.fn();
    const services = createReviewServices(
      env,
      job,
      {
        createSession: () => Promise.resolve(installationSession()),
        executor: {
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          prepareRepositoryV2,
          prepareRepositoryV3: () =>
            Promise.reject(
              new TypeError(
                'The RPC receiver does not implement the method "prepareRepositoryV3".',
              ),
            ),
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
      },
      { emit: () => undefined },
      {},
    );

    await expect(
      services.prepareRepository(1, customPolicy),
    ).rejects.toMatchObject({ name: "NonRetryableError" });
    expect(prepareRepositoryV2).not.toHaveBeenCalled();
  });

  it("fails closed without loading V2 when custom policy context V3 is unavailable", async () => {
    const customPolicy = {
      additionalExcludes: ["vendor/**"],
      baseSha: "b".repeat(40),
      effectivePolicyDigest: "c".repeat(64),
      source: ".github/holon.yml" as const,
      sourceDigest: "d".repeat(64),
      verdictStrictness: "default" as const,
      version: 1 as const,
    };
    const loadContextV2 = vi.fn();
    const services = createReviewServices(
      env,
      job,
      {
        createSession: () => Promise.resolve(installationSession()),
        executor: {
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          loadContextV2,
          loadContextV3: () =>
            Promise.reject(
              new TypeError(
                'The RPC receiver does not implement the method "loadContextV3".',
              ),
            ),
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
      },
      { emit: () => undefined },
      {},
    );

    await expect(services.loadContext(customPolicy)).rejects.toMatchObject({
      name: "NonRetryableError",
    });
    expect(loadContextV2).not.toHaveBeenCalled();
  });

  it("falls back to V2 when default policy is used and prepareRepositoryV3 is unavailable", async () => {
    const defaultPolicy = {
      additionalExcludes: [],
      baseSha: "b".repeat(40),
      effectivePolicyDigest: "c".repeat(64),
      source: "default" as const,
      sourceDigest: null,
      verdictStrictness: "default" as const,
      version: 1 as const,
    };
    const prepareRepositoryV2 = vi.fn().mockResolvedValue({
      changedLineCount: 1,
      contextBytes: 100,
      fileCount: 1,
      runId: job.runId,
      schemaVersion: 2,
      truncated: false,
    });
    const services = createReviewServices(
      env,
      job,
      {
        createSession: () => Promise.resolve(installationSession()),
        executor: {
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          prepareRepositoryV2,
          prepareRepositoryV3: () =>
            Promise.reject(
              new TypeError(
                'The RPC receiver does not implement the method "prepareRepositoryV3".',
              ),
            ),
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
      },
      { emit: () => undefined },
      {},
    );

    const prepared = await services.prepareRepository(1, defaultPolicy);
    expect(prepared).toMatchObject({ schemaVersion: 2 });
    expect(prepareRepositoryV2).toHaveBeenCalledOnce();
  });

  it("falls back from loadContextV3 to loadContextV2 when unavailable, and does not fall back on functional error", async () => {
    const loadContextV2 = vi.fn().mockResolvedValue({
      changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
      files: [
        { mode: "structural", patch: canonicalPatch, path: "src/index.ts" },
      ],
      schemaVersion: 2,
      truncated: false,
    });
    const services = createReviewServices(
      env,
      job,
      {
        createSession: () => Promise.resolve(installationSession()),
        executor: {
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          loadContextV2,
          loadContextV3: () =>
            Promise.reject(
              new TypeError(
                'The RPC receiver does not implement the method "loadContextV3".',
              ),
            ),
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
      },
      { emit: () => undefined },
      {},
    );

    const context = await services.loadContext();
    expect(context).toMatchObject({ schemaVersion: 2 });
    expect(loadContextV2).toHaveBeenCalledOnce();

    const functionalError = new Error("v3 functional error");
    const failingServices = createReviewServices(
      env,
      job,
      {
        createSession: () => Promise.resolve(installationSession()),
        executor: {
          cleanup: () => Promise.resolve(),
          hasContext: () => Promise.resolve(true),
          loadContextV2: vi.fn(),
          loadContextV3: () => Promise.reject(functionalError),
          runTool: () => Promise.resolve({ content: "", truncated: false }),
        },
      },
      { emit: () => undefined },
      {},
    );
    await expect(failingServices.loadContext()).rejects.toBe(functionalError);
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
});
