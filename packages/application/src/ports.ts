import type {
  CreateCheckRunInput,
  ModelReviewOutput,
  ReviewContextV2,
  ReviewJob,
  TrackedFinding,
  UpdateCheckRunInput,
} from "@holon/contracts";
import type {
  PrKey,
  PublicationId,
  PublicationRecord,
  ReviewRun,
  ReviewVerdict,
  RunId,
  RunState,
} from "@holon/domain";

export type {
  CreateCheckRunInput,
  ReviewContextV2 as ReviewContext,
  UpdateCheckRunInput,
} from "@holon/contracts";

export interface ModelReviewResult {
  readonly output: ModelReviewOutput;
  readonly promptTruncated: boolean;
}

export interface ModelReviewer {
  review(job: ReviewJob, context: ReviewContextV2): Promise<ModelReviewResult>;
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
  loadPrFindings?(prKey: PrKey): Promise<readonly TrackedFinding[]>;
  savePrFindings?(
    prKey: PrKey,
    findings: readonly TrackedFinding[],
  ): Promise<void>;
}

export interface PublishCommentInput {
  readonly body: string;
  readonly event?: ReviewVerdict | undefined;
  readonly line?: number;
  readonly marker: string;
  readonly path?: string;
  readonly side?: "RIGHT";
  readonly startLine?: number;
}

export interface ReviewPublisher {
  createCheckRun?(input: CreateCheckRunInput): Promise<number>;
  findCheckRunByExternalId?(externalId: string): Promise<number | undefined>;
  findCommentByMarker(
    marker: string,
    kind: "inline" | "summary",
  ): Promise<number | undefined>;
  findCommentWithBodyByMarker?(
    marker: string,
    kind: "inline" | "summary",
  ): Promise<{ readonly body: string; readonly id: number } | undefined>;
  publish(input: PublishCommentInput): Promise<number>;
  replyToComment?(commentId: number, body: string): Promise<number>;
  updateCheckRun?(input: UpdateCheckRunInput): Promise<void>;
  updateReviewComment?(reviewId: number, body: string): Promise<void>;
}
