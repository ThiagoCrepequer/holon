import type { ReviewLedger, ReviewPublisher } from "@holon/application";
import type { PublishCommentInput } from "@holon/application";
import {
  buildPublicationMarker,
  createPublicationId,
  type FindingId,
  type PublicationRecord,
  type RunId,
} from "@holon/domain";

export interface PublicationLedger extends ReviewLedger {
  authorizeMutation(
    runId: RunId,
    purpose: "failure" | "review",
  ): Promise<boolean>;
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
  if (claim.outcome === "published") return false;
  if (claim.outcome === "reconcile") {
    const existingId = await publisher.findCommentByMarker(
      claim.record.marker,
      kind,
    );
    if (existingId !== undefined) {
      await ledger.completePublication(id, existingId);
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
  return true;
}

export async function publishFailureNoticeAuthorized(
  publisher: ReviewPublisher,
  runId: RunId,
  authorizeImmediatelyBeforeMutation: () => Promise<boolean>,
): Promise<boolean> {
  const marker = `<!-- holon:v1;run=${runId};finding=system-failure -->`;
  if ((await publisher.findCommentByMarker(marker, "summary")) !== undefined) {
    return false;
  }
  if (!(await authorizeImmediatelyBeforeMutation())) return false;
  await publisher.publish({
    body: "Holon could not complete this automated review. The run was stopped and its repository sandbox was scheduled for cleanup. Push a new commit or synchronize the pull request to start a fresh run.",
    marker,
  });
  return true;
}
