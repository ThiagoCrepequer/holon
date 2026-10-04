import type { ReviewPublisher } from "@holon/application";
import {
  buildPublicationMarker,
  createPublicationId,
  type FindingId,
  type PublicationRecord,
  type RunId,
} from "@holon/domain";
import { describe, expect, it, vi } from "vitest";

import {
  isReviewMutationNotAuthorizedError,
  publishAuthorized,
  publishFailureNoticeAuthorized,
  publishResolutionAuthorized,
  publishReviewAuthorized,
  ReviewMutationNotAuthorizedError,
  type PublicationLedger,
  type ReviewInlinePublication,
} from "../src/authorized-publication.js";

const runId =
  `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as RunId;
const findingId: FindingId = `finding:${"b".repeat(64)}`;
const record: PublicationRecord = {
  findingId,
  id: createPublicationId(runId, findingId),
  kind: "inline",
  marker: buildPublicationMarker(runId, findingId),
  runId,
  state: "publishing",
};

function ledger(
  claim: PublicationLedger["claimPublication"],
  authorize = vi.fn(() => Promise.resolve(true)),
) {
  return {
    authorizeMutation: authorize,
    checkRunId: () => undefined,
    claimPublication: claim,
    claimRun: () =>
      Promise.resolve({ outcome: "claimed" as const, supersededWorkflows: [] }),
    completePublication: vi.fn(() => Promise.resolve()),
    isLatestRun: () => Promise.resolve(true),
    recordCheckRunId: () => undefined,
    transition: () => Promise.resolve(),
  } satisfies PublicationLedger;
}

function publisher(
  existing?: number,
): ReviewPublisher & { readonly publish: ReturnType<typeof vi.fn> } {
  return {
    findCommentByMarker: () => Promise.resolve(existing),
    publish: vi.fn(() => Promise.resolve(321)),
  };
}

describe("authorized publication", () => {
  it("reuses an already published clean review without another GitHub mutation", async () => {
    const state = ledger(() =>
      Promise.resolve({
        outcome: "published",
        record: {
          findingId: "summary",
          id: createPublicationId(runId, "summary"),
          kind: "summary",
          marker: buildPublicationMarker(runId, "summary"),
          runId,
          state: "published",
          githubCommentId: 321,
        } as const,
      }),
    );
    const github = publisher();

    await expect(
      publishReviewAuthorized(
        state,
        github,
        runId,
        "Clean review",
        "APPROVE",
        [],
        async () => true,
      ),
    ).resolves.toEqual({ commentIds: [], published: false });
    expect(github.publish).not.toHaveBeenCalled();
  });

  it("requires every inline ID from the submitted review before tracking findings", async () => {
    const state = ledger((next) =>
      Promise.resolve({
        outcome: "published",
        record: { ...next, state: "published", githubCommentId: 321 },
      }),
    );
    const finding = {
      body: "Verified defect",
      findingId,
      fingerprint: `fp:${"c".repeat(64)}`,
      line: 10,
      path: "src/index.ts",
      side: "RIGHT",
    } satisfies ReviewInlinePublication;
    const github = publisher();

    await expect(
      publishReviewAuthorized(
        state,
        github,
        runId,
        "Defect review",
        "REQUEST_CHANGES",
        [finding],
        async () => true,
      ),
    ).rejects.toThrow("Review comment reconciliation is unavailable");

    const incomplete: ReviewPublisher = {
      ...github,
      findReviewCommentsByMarkers: () => Promise.resolve(new Map()),
    };
    await expect(
      publishReviewAuthorized(
        state,
        incomplete,
        runId,
        "Defect review",
        "REQUEST_CHANGES",
        [finding],
        async () => true,
      ),
    ).rejects.toThrow("Published review is missing an inline comment");
    expect(github.publish).not.toHaveBeenCalled();
  });

  it("reconciles one review and its inline IDs after a lost ledger acknowledgement", async () => {
    let claimed: PublicationRecord | undefined;
    let posted = false;
    const state = ledger(async (next) => {
      const previous = claimed;
      claimed = next;
      return {
        outcome: previous ? "reconcile" : "claimed",
        record: previous ?? next,
      };
    });
    state.completePublication.mockRejectedValueOnce(
      new Error("lost ledger acknowledgement"),
    );
    const marker = buildPublicationMarker(runId, findingId);
    const github: ReviewPublisher & { publish: ReturnType<typeof vi.fn> } = {
      findCommentByMarker: () => Promise.resolve(posted ? 321 : undefined),
      findReviewCommentsByMarkers: (_reviewId, markers) =>
        Promise.resolve(new Map(markers.map((value) => [value, 777]))),
      publish: vi.fn(async () => {
        posted = true;
        return 321;
      }),
    };
    const finding = {
      body: "Verified defect",
      findingId,
      fingerprint: `fp:${"c".repeat(64)}`,
      line: 10,
      path: "src/index.ts",
      side: "RIGHT" as const,
    } satisfies ReviewInlinePublication;

    await expect(
      publishReviewAuthorized(
        state,
        github,
        runId,
        "Summary",
        "REQUEST_CHANGES",
        [finding],
        () => Promise.resolve(true),
      ),
    ).rejects.toThrow("lost ledger acknowledgement");
    await expect(
      publishReviewAuthorized(
        state,
        github,
        runId,
        "Summary",
        "REQUEST_CHANGES",
        [finding],
        () => Promise.resolve(true),
      ),
    ).resolves.toEqual({
      commentIds: [{ fingerprint: finding.fingerprint, id: 777 }],
      published: false,
    });
    expect(github.publish).toHaveBeenCalledOnce();
    expect(github.publish.mock.calls[0]?.[0].comments[0].marker).toBe(marker);
  });

  it("reconciles a resolution reply accepted before the ledger completion failed", async () => {
    let persisted: PublicationRecord | undefined;
    const state = ledger(async (next) => {
      const previous = persisted;
      persisted = next;
      return {
        outcome: previous ? "reconcile" : "claimed",
        record: previous ?? next,
      };
    });
    state.completePublication.mockRejectedValueOnce(
      new Error("lost ledger acknowledgement"),
    );
    const bodies: string[] = [];
    const github: ReviewPublisher = {
      publish: vi.fn(),
      findCommentByMarker: async (marker) =>
        bodies.some((body) => body.includes(marker)) ? 87 : undefined,
      replyToComment: vi.fn(async (_id, body) => {
        bodies.push(body);
        return 87;
      }),
    };
    const resolved = {
      fingerprint: `fp:${"c".repeat(64)}` as const,
      githubCommentId: 77,
    };
    await expect(
      publishResolutionAuthorized(
        state,
        github,
        runId,
        resolved,
        "a".repeat(40),
        async () => true,
      ),
    ).rejects.toThrow("lost ledger");
    await publishResolutionAuthorized(
      state,
      github,
      runId,
      resolved,
      "a".repeat(40),
      async () => true,
    );
    expect(bodies).toHaveLength(1);
  });
  it("recognizes only the local or serialized authorization error", () => {
    expect(
      isReviewMutationNotAuthorizedError(
        new ReviewMutationNotAuthorizedError(),
      ),
    ).toBe(true);
    expect(
      isReviewMutationNotAuthorizedError(
        Object.assign(new Error(), {
          name: "ReviewMutationNotAuthorizedError",
        }),
      ),
    ).toBe(true);
    expect(isReviewMutationNotAuthorizedError(new Error("different"))).toBe(
      false,
    );
    expect(isReviewMutationNotAuthorizedError("different")).toBe(false);
  });

  it("returns without a GitHub call when publication was already completed", async () => {
    const state = ledger(() =>
      Promise.resolve({
        outcome: "published",
        record: { ...record, state: "published", githubCommentId: 123 },
      }),
    );
    const github = publisher();

    await expect(
      publishAuthorized(
        state,
        github,
        runId,
        findingId,
        "inline",
        "body",
        {},
        () => Promise.resolve(true),
      ),
    ).resolves.toBe(false);
    expect(github.publish).not.toHaveBeenCalled();
  });

  it("reconciles a marker after a lost completion response", async () => {
    const state = ledger(() =>
      Promise.resolve({ outcome: "reconcile", record }),
    );
    const github = publisher(123);

    await expect(
      publishAuthorized(
        state,
        github,
        runId,
        findingId,
        "inline",
        "body",
        {},
        () => Promise.resolve(true),
      ),
    ).resolves.toBe(false);
    expect(state.completePublication).toHaveBeenCalledWith(record.id, 123);
    expect(github.publish).not.toHaveBeenCalled();
  });

  it("publishes a missing reconciliation only after fresh authorization", async () => {
    const state = ledger(() =>
      Promise.resolve({ outcome: "reconcile", record }),
    );
    const github = publisher();

    await expect(
      publishAuthorized(
        state,
        github,
        runId,
        findingId,
        "inline",
        "body",
        {},
        () => Promise.resolve(true),
      ),
    ).resolves.toBe(true);
    expect(github.publish).toHaveBeenCalledOnce();
    expect(state.completePublication).toHaveBeenCalledWith(record.id, 321);
  });

  it("fails closed before claim and immediately before mutation", async () => {
    const initiallyDenied = ledger(
      () => Promise.resolve({ outcome: "claimed", record }),
      vi.fn(() => Promise.resolve(false)),
    );
    await expect(
      publishAuthorized(
        initiallyDenied,
        publisher(),
        runId,
        findingId,
        "inline",
        "body",
        {},
        () => Promise.resolve(true),
      ),
    ).rejects.toBeInstanceOf(ReviewMutationNotAuthorizedError);

    const github = publisher();
    await expect(
      publishAuthorized(
        ledger(() => Promise.resolve({ outcome: "claimed", record })),
        github,
        runId,
        findingId,
        "inline",
        "body",
        {},
        () => Promise.resolve(false),
      ),
    ).rejects.toBeInstanceOf(ReviewMutationNotAuthorizedError);
    expect(github.publish).not.toHaveBeenCalled();
  });

  it("normalizes ledger authorization errors and preserves other failures", async () => {
    for (const error of [
      Object.assign(new Error(), { name: "ReviewMutationNotAuthorizedError" }),
      new Error("storage unavailable"),
    ]) {
      const operation = publishAuthorized(
        ledger(() => Promise.reject(error)),
        publisher(),
        runId,
        findingId,
        "inline",
        "body",
        {},
        () => Promise.resolve(true),
      );
      if (error.name === "ReviewMutationNotAuthorizedError") {
        await expect(operation).rejects.toBeInstanceOf(
          ReviewMutationNotAuthorizedError,
        );
      } else {
        await expect(operation).rejects.toBe(error);
      }
    }
  });

  it("deduplicates, denies and publishes failure notices", async () => {
    const duplicate = publisher(123);
    await expect(
      publishFailureNoticeAuthorized(duplicate, runId, () =>
        Promise.resolve(true),
      ),
    ).resolves.toBe(false);
    expect(duplicate.publish).not.toHaveBeenCalled();

    const denied = publisher();
    await expect(
      publishFailureNoticeAuthorized(denied, runId, () =>
        Promise.resolve(false),
      ),
    ).resolves.toBe(false);
    expect(denied.publish).not.toHaveBeenCalled();

    const accepted = publisher();
    await expect(
      publishFailureNoticeAuthorized(accepted, runId, () =>
        Promise.resolve(true),
      ),
    ).resolves.toBe(true);
    expect(accepted.publish).toHaveBeenCalledOnce();
  });
});
