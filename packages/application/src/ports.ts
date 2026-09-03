import type {
  CreateCheckRunInput,
  ModelReviewOutput,
  ReviewContextV2,
  ReviewJob,
  RunTelemetry,
  StepTiming,
  TrackedFinding,
  UpdateCheckRunInput,
} from "@holon/contracts";
import type {
  FindingFeedbackRecord,
  FindingFingerprint,
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
  findFindingByCommentId?(
    prKey: PrKey,
    commentId: number,
  ): Promise<TrackedFinding | undefined>;
  loadCiEvidence?(
    prKey: PrKey,
    headSha: string,
  ): Promise<
    | { readonly markdown: string; readonly workflowRunId?: number | undefined }
    | undefined
  >;
  loadFindingFeedbacks?(
    prKey: PrKey,
    fingerprint?: FindingFingerprint,
  ): Promise<readonly FindingFeedbackRecord[]>;
  loadPrFindings?(prKey: PrKey): Promise<readonly TrackedFinding[]>;
  recordFindingFeedback?(
    prKey: PrKey,
    feedback: FindingFeedbackRecord,
  ): Promise<void>;
  saveCiEvidence?(
    prKey: PrKey,
    headSha: string,
    evidence: {
      readonly markdown: string;
      readonly workflowRunId?: number | undefined;
    },
  ): Promise<void>;
  loadRunTelemetry?(runId: string): Promise<RunTelemetry | undefined>;
  savePrFindings?(
    prKey: PrKey,
    findings: readonly TrackedFinding[],
  ): Promise<void>;
  saveRunTelemetry?(telemetry: RunTelemetry): Promise<void>;
}

export interface TelemetryEmitter {
  emitRunTelemetry(telemetry: RunTelemetry): Promise<void> | void;
  emitStepTiming(step: StepTiming): Promise<void> | void;
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
