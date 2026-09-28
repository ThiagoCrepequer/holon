import type { LocalizedCiMarkdown } from "@holon/contracts";
import type { ReviewOutputPreferences } from "@holon/contracts";
import type {
  CiSummary,
  CreateCheckRunInput,
  ModelReviewOutput,
  ReviewShardContext,
  ReviewJob,
  RunClaimResult,
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

import type { ShardReviewGuidance } from "./configuration-projections.js";

export type ReviewContext = ReviewShardContext & {
  readonly repositoryGuidance?: ShardReviewGuidance | undefined;
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
  readonly promptOmissions?: readonly string[];
  readonly output: ModelReviewOutput;
  readonly promptTruncated: boolean;
}

export interface ModelReviewer {
  review(job: ReviewJob, context: ReviewContext): Promise<ModelReviewResult>;
  synthesizeReviewSummary?(
    job: ReviewJob,
    input: {
      readonly output?: ReviewOutputPreferences | undefined;
      readonly deadlineAt?: number | undefined;
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
  loadLatestReviewDecision(
    prKey: PrKey,
  ): Promise<ReviewDecisionContext | undefined>;
  loadCiEvidence(
    prKey: PrKey,
    headSha: string,
  ): Promise<
    | {
        readonly markdownByLanguage: LocalizedCiMarkdown;
        readonly workflowRunId?: number | undefined;
        readonly structuredCi?: CiSummary | null | undefined;
      }
    | undefined
  >;
  saveCiEvidence(
    prKey: PrKey,
    headSha: string,
    evidence: import("@holon/contracts").SavedCiEvidence,
  ): Promise<void>;
}

export interface FindingLifecycleLedger {
  loadPrFindings(prKey: PrKey): Promise<readonly TrackedFinding[]>;
  savePrFindings(
    prKey: PrKey,
    findings: readonly TrackedFinding[],
    writerRunId: RunId,
  ): Promise<void>;
}

export interface ReviewDecisionContext {
  readonly verdictPolicy: { readonly mediumSeverityThreshold: number };
  readonly output: ReviewOutputPreferences;
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
