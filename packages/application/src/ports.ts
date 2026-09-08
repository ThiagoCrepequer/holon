import type {
  AdminCiSummary,
  CreateCheckRunInput,
  ModelReviewOutput,
  ReviewShardContext,
  ReviewJob,
  RunClaimResult,
  RunTelemetry,
  StepTiming,
  TrackedFinding,
  UpdateCheckRunInput,
} from "@holon/contracts";
import type {
  FindingFeedbackRecord,
  FindingSeverity,
  FindingStatus,
  PrKey,
  PublicationId,
  PublicationRecord,
  ReviewRun,
  ReviewVerdict,
  RunId,
  RunState,
} from "@holon/domain";

export type ReviewContext = ReviewShardContext & {
  readonly deadlineAt?: number | undefined;
  readonly priorFindings?:
    | readonly Pick<
        TrackedFinding,
        "fingerprint" | "diagnostic" | "filePath" | "severity"
      >[]
    | undefined;
};
export type {
  CreateCheckRunInput,
  UpdateCheckRunInput,
} from "@holon/contracts";

export interface ModelReviewResult {
  readonly output: ModelReviewOutput;
  readonly promptTruncated: boolean;
}

export interface ModelReviewer {
  review(job: ReviewJob, context: ReviewContext): Promise<ModelReviewResult>;
  synthesizeReviewSummary?(
    job: ReviewJob,
    input: {
      readonly shardSummaries: readonly string[];
      readonly verifiedFindings: readonly {
        diagnostic: string;
        severity: string;
        path: string;
      }[];
    },
  ): Promise<string>;
}

export type ClaimedPublication =
  | { readonly outcome: "claimed"; readonly record: PublicationRecord }
  | { readonly outcome: "published"; readonly record: PublicationRecord }
  | { readonly outcome: "reconcile"; readonly record: PublicationRecord };

export interface ReviewLedger {
  claimRun(run: ReviewRun, workflowInstanceId: string): Promise<RunClaimResult>;
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

export interface CiEvidenceLedger {
  loadCiEvidence(
    prKey: PrKey,
    headSha: string,
  ): Promise<
    | {
        readonly markdown: string;
        readonly workflowRunId?: number | undefined;
        readonly structuredCi?: AdminCiSummary | null | undefined;
      }
    | undefined
  >;
  saveCiEvidence(
    prKey: PrKey,
    headSha: string,
    evidence: {
      readonly markdown: string;
      readonly workflowRunId?: number | undefined;
      readonly structuredCi?: AdminCiSummary | null | undefined;
    },
  ): Promise<void>;
}

export interface FindingLifecycleLedger {
  loadPrFindings(prKey: PrKey): Promise<readonly TrackedFinding[]>;
  savePrFindings(
    prKey: PrKey,
    findings: readonly TrackedFinding[],
  ): Promise<void>;
}

export interface RunTelemetryLedger {
  loadRunTelemetry(runId: string): Promise<RunTelemetry | undefined>;
  saveRunTelemetry(telemetry: RunTelemetry): Promise<void>;
}

export interface ReviewDecisionContext {
  readonly checkRunId?: number | undefined;
  readonly headSha: string;
  readonly isDegraded: boolean;
  readonly runId: RunId;
  readonly scopeStatus:
    | "complete"
    | "partial_by_policy"
    | "partial_by_failure"
    | "unsupported";
  readonly shardsAnalyzed: number;
  readonly totalShards: number;
}

export interface ApplyFindingFeedbackInput {
  readonly authorAssociation?: string | undefined;
  readonly authorLogin: string;
  readonly createdAt: string;
  readonly deliveryId: string;
  readonly githubCommentId: number;
  readonly label: FindingFeedbackRecord["label"];
  readonly prKey: PrKey;
  readonly reason?: string | undefined;
  readonly targetCommentId: number;
  readonly targetSeverity?: FindingSeverity | undefined;
  readonly update?:
    | { readonly status: Extract<FindingStatus, "dismissed"> }
    | { readonly severity: FindingSeverity }
    | undefined;
}

export interface AppliedFindingFeedback {
  readonly activeFindings: readonly TrackedFinding[];
  readonly decision?: ReviewDecisionContext | undefined;
  readonly feedback?: FindingFeedbackRecord | undefined;
  readonly outcome: "applied" | "duplicate" | "not_found";
  readonly replyCommentId?: number | undefined;
}

export interface FeedbackLedger {
  applyFindingFeedback(
    input: ApplyFindingFeedbackInput,
  ): Promise<AppliedFindingFeedback>;
  completeFeedbackReply(
    deliveryId: string,
    replyCommentId: number,
  ): Promise<void>;
  loadLatestReviewDecision(
    prKey: PrKey,
  ): Promise<ReviewDecisionContext | undefined>;
}

export interface ReviewDecisionLedger {
  recordReviewDecision(
    runId: RunId,
    decision: Omit<ReviewDecisionContext, "checkRunId" | "runId">,
  ): Promise<void>;
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
