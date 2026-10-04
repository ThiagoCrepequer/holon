import type { ReviewLedger, ReviewPublisher } from "@holon/application";
import type { PublishCommentInput } from "@holon/application";
import { reviewMessage, type ReviewLanguage } from "@holon/domain";
import {
  buildPublicationMarker,
  createPublicationId,
  createFindingId,
  type FindingFingerprint,
  type FindingId,
  type PublicationRecord,
  type ReviewVerdict,
  type RunId,
} from "@holon/domain";

export interface PublicationLedger extends ReviewLedger {
  authorizeMutation(
    runId: RunId,
    purpose: "failure" | "review",
  ): Promise<boolean>;
  checkRunId(runId: RunId): Promise<number | undefined> | number | undefined;
  recordCheckRunId(runId: RunId, checkRunId: number): Promise<void> | void;
}

export class ReviewMutationNotAuthorizedError extends Error {
  public constructor() {
    super("Review mutation is not authorized");
    this.name = "ReviewMutationNotAuthorizedError";
  }
}

export function isReviewMutationNotAuthorizedError(error: unknown): boolean {
  return (
    error instanceof ReviewMutationNotAuthorizedError ||
    (error instanceof Error &&
      error.name === "ReviewMutationNotAuthorizedError")
  );
}

async function requireAuthorization(
  authorize: () => Promise<boolean>,
): Promise<void> {
  if (!(await authorize())) throw new ReviewMutationNotAuthorizedError();
}

export async function publishAuthorized(
  ledger: PublicationLedger,
  publisher: ReviewPublisher,
  runId: RunId,
  findingId: FindingId | "summary",
  kind: "inline" | "summary",
  body: string,
  location: Omit<PublishCommentInput, "body" | "marker">,
  authorizeImmediatelyBeforeMutation: () => Promise<boolean>,
  onPublished?: (commentId: number) => void,
): Promise<boolean> {
  await requireAuthorization(() => ledger.authorizeMutation(runId, "review"));
  const marker = buildPublicationMarker(runId, findingId);
  const id = createPublicationId(runId, findingId);
  const record: PublicationRecord = {
    findingId,
    id,
    kind,
    marker,
    runId,
    state: "publishing",
  };
  let claim: Awaited<ReturnType<ReviewLedger["claimPublication"]>>;
  try {
    claim = await ledger.claimPublication(record);
  } catch (error) {
    if (isReviewMutationNotAuthorizedError(error)) {
      throw new ReviewMutationNotAuthorizedError();
    }
    throw error;
  }
  if (claim.outcome === "published") {
    if (claim.record.githubCommentId !== undefined)
      onPublished?.(claim.record.githubCommentId);
    return false;
  }
  if (claim.outcome === "reconcile") {
    const existingId = await publisher.findCommentByMarker(
      claim.record.marker,
      kind,
    );
    if (existingId !== undefined) {
      await ledger.completePublication(id, existingId);
      onPublished?.(existingId);
      return false;
    }
  }
  await requireAuthorization(authorizeImmediatelyBeforeMutation);
  const githubCommentId = await publisher.publish({
    body,
    marker,
    ...location,
  });
  await ledger.completePublication(id, githubCommentId);
  onPublished?.(githubCommentId);
  return true;
}

export interface ReviewInlinePublication {
  readonly fingerprint: FindingFingerprint;
  readonly findingId: FindingId;
  readonly body: string;
  readonly line: number;
  readonly path: string;
  readonly side: "RIGHT";
  readonly startLine?: number | undefined;
}

/** A single GitHub review owns its verdict and all newly published findings. */
export async function publishReviewAuthorized(
  ledger: PublicationLedger,
  publisher: ReviewPublisher,
  runId: RunId,
  body: string,
  event: ReviewVerdict,
  findings: readonly ReviewInlinePublication[],
  authorizeImmediatelyBeforeMutation: () => Promise<boolean>,
): Promise<{
  readonly commentIds: readonly {
    readonly fingerprint: FindingFingerprint;
    readonly id: number;
  }[];
  readonly published: boolean;
}> {
  await requireAuthorization(() => ledger.authorizeMutation(runId, "review"));
  const marker = buildPublicationMarker(runId, "summary");
  const publicationId = createPublicationId(runId, "summary");
  let claim: Awaited<ReturnType<ReviewLedger["claimPublication"]>>;
  try {
    claim = await ledger.claimPublication({
      findingId: "summary",
      id: publicationId,
      kind: "summary",
      marker,
      runId,
      state: "publishing",
    });
  } catch (error) {
    if (isReviewMutationNotAuthorizedError(error)) {
      throw new ReviewMutationNotAuthorizedError();
    }
    throw error;
  }

  let reviewId: number;
  let published = false;
  if (claim.outcome === "published") {
    if (claim.record.githubCommentId === undefined) {
      throw new Error("Published review is missing its GitHub id");
    }
    reviewId = claim.record.githubCommentId;
  } else {
    const existingId =
      claim.outcome === "reconcile"
        ? await publisher.findCommentByMarker(marker, "summary")
        : undefined;
    if (existingId !== undefined) {
      reviewId = existingId;
      await ledger.completePublication(publicationId, reviewId);
    } else {
      await requireAuthorization(authorizeImmediatelyBeforeMutation);
      reviewId = await publisher.publish({
        body,
        comments: findings.map((finding) => ({
          body: finding.body,
          line: finding.line,
          marker: buildPublicationMarker(runId, finding.findingId),
          path: finding.path,
          side: finding.side,
          ...(finding.startLine === undefined
            ? {}
            : { startLine: finding.startLine }),
        })),
        event,
        marker,
      });
      published = true;
      await ledger.completePublication(publicationId, reviewId);
    }
  }

  if (findings.length === 0) return { commentIds: [], published };
  const lookup = publisher.findReviewCommentsByMarkers?.bind(publisher);
  if (lookup === undefined) {
    throw new TypeError("Review comment reconciliation is unavailable");
  }
  const markers = findings.map((finding) =>
    buildPublicationMarker(runId, finding.findingId),
  );
  const ids = await lookup(reviewId, markers);
  const commentIds = findings.map((finding, index) => {
    const id = ids.get(markers[index]!);
    if (id === undefined) {
      throw new Error("Published review is missing an inline comment");
    }
    return { fingerprint: finding.fingerprint, id };
  });
  return { commentIds, published };
}

export async function publishResolutionAuthorized(
  ledger: PublicationLedger,
  publisher: ReviewPublisher,
  runId: RunId,
  resolved: {
    readonly fingerprint: FindingFingerprint;
    readonly githubCommentId?: number | undefined;
  },
  headSha: string,
  authorizeImmediatelyBeforeMutation: () => Promise<boolean>,
  language: ReviewLanguage = "en",
): Promise<boolean> {
  const commentId = resolved.githubCommentId;
  if (commentId === undefined) return false;
  const reply = publisher.replyToComment?.bind(publisher);
  if (reply === undefined)
    throw new TypeError("Resolution publisher is unavailable");
  const findingId = await createFindingId(runId, {
    diagnostic: `resolution:${resolved.fingerprint}:${headSha}`,
    path: "holon-resolution",
    startLine: 1,
    endLine: 1,
  });
  return publishAuthorized(
    ledger,
    {
      findCommentByMarker: (marker, kind) =>
        publisher.findCommentByMarker(marker, kind),
      publish: ({ body, marker }) => reply(commentId, `${body}\n\n${marker}`),
    },
    runId,
    findingId,
    "inline",
    reviewMessage(language, "resolved", { sha: headSha.slice(0, 7) }),
    {},
    authorizeImmediatelyBeforeMutation,
  );
}

export async function publishFailureNoticeAuthorized(
  publisher: ReviewPublisher,
  runId: RunId,
  authorizeImmediatelyBeforeMutation: () => Promise<boolean>,
  customBody?: string,
): Promise<boolean> {
  const marker = `<!-- holon;run=${runId};finding=system-failure -->`;
  if ((await publisher.findCommentByMarker(marker, "summary")) !== undefined) {
    return false;
  }
  if (!(await authorizeImmediatelyBeforeMutation())) return false;
  await publisher.publish({
    body:
      customBody ??
      "Holon could not complete this automated review. The run was stopped and its repository sandbox was scheduled for cleanup. Push a new commit or synchronize the pull request to start a fresh run.",
    marker,
  });
  return true;
}
