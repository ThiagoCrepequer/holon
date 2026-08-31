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
});
