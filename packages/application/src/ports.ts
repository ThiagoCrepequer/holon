import type {
  ModelReviewOutput,
  ReviewContext,
  ReviewJob,
} from "@holon/contracts";
import type {
  PublicationId,
  PublicationRecord,
  ReviewRun,
  RunId,
  RunState,
} from "@holon/domain";

export interface Clock {
  now(): string;
}

export interface RepositoryContextLoader {
  loadContext(job: ReviewJob): Promise<ReviewContext>;
}

export type { ReviewContext } from "@holon/contracts";

export interface ModelReviewer {
  review(job: ReviewJob, context: ReviewContext): Promise<ModelReviewOutput>;
}

export interface PullRequestHeadReader {
  currentHeadSha(job: ReviewJob): Promise<string>;
}

export type ClaimedPublication =
  | { readonly outcome: "claimed"; readonly record: PublicationRecord }
  | { readonly outcome: "published"; readonly record: PublicationRecord }
  | { readonly outcome: "reconcile"; readonly record: PublicationRecord };

export interface ReviewLedger {
  claimRun(
    run: ReviewRun,
    workflowInstanceId: string,
  ): Promise<"claimed" | "duplicate" | "resume">;
  isLatestRun(runId: RunId): Promise<boolean>;
  transition(
    runId: RunId,
    expected: RunState,
    next: RunState,
    occurredAt: string,
    operationId: string,
  ): Promise<void>;
  claimPublication(record: PublicationRecord): Promise<ClaimedPublication>;
  completePublication(
    id: PublicationId,
    githubCommentId: number,
  ): Promise<void>;
}

export interface PublishCommentInput {
  readonly body: string;
  readonly line?: number;
  readonly marker: string;
  readonly path?: string;
  readonly side?: "RIGHT";
  readonly startLine?: number;
}

export interface ReviewPublisher {
  findCommentByMarker(marker: string): Promise<number | undefined>;
  publish(input: PublishCommentInput): Promise<number>;
}
