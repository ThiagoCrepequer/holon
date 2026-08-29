import type { ReviewJob } from "@holon/contracts";
import {
  buildPublicationMarker,
  classifyFindingPublication,
  createFinding,
  createFindingId,
  createPrKey,
  createPublicationId,
  type Finding,
  type FindingId,
  type PublicationRecord,
  type ReviewRun,
  type RunId,
  type RunState,
} from "@holon/domain";

import type {
  Clock,
  ModelReviewer,
  PullRequestHeadReader,
  RepositoryContextLoader,
  ReviewLedger,
  ReviewPublisher,
} from "./ports.js";

export interface ExecuteReviewDependencies {
  readonly clock: Clock;
  readonly ledger: ReviewLedger;
  readonly model: ModelReviewer;
  readonly pullRequest: PullRequestHeadReader;
  readonly publisher: ReviewPublisher;
  readonly repository: RepositoryContextLoader;
}

export type ExecuteReviewResult =
  | { readonly findingsPublished: number; readonly outcome: "completed" }
  | {
      readonly findingsPublished: 0;
      readonly outcome: "duplicate" | "obsolete";
    };

export function createReviewRun(job: ReviewJob): ReviewRun {
  return {
    attempt: 0,
    createdAt: job.envelope.receivedAt,
    id: job.runId as RunId,
    prKey: createPrKey({
      provider: "github",
      pullRequestNumber: job.envelope.pullRequest.number,
      repositoryId: job.envelope.repository.id,
    }),
    state: "queued",
  };
}

export function renderFinding(finding: Finding): string {
  const suggestion =
    finding.suggestion === undefined
      ? ""
      : `\n\nSuggested action: ${finding.suggestion}`;
  return `${finding.diagnostic}${suggestion}`;
}

export function selectValidFindings(
  candidates: readonly Finding[],
  changedLines: Parameters<typeof createFinding>[1],
): readonly Finding[] {
  return candidates.flatMap((candidate) => {
    try {
      return [createFinding(candidate, changedLines)];
    } catch (error) {
      if (error instanceof TypeError) return [];
      throw error;
    }
  });
}

export async function publishOnce(
  ledger: ReviewLedger,
  publisher: ReviewPublisher,
  runId: RunId,
  findingId: FindingId | "summary",
  kind: "inline" | "summary",
  body: string,
  location: {
    readonly line?: number;
    readonly path?: string;
    readonly side?: "RIGHT";
    readonly startLine?: number;
  },
): Promise<boolean> {
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
  const claim = await ledger.claimPublication(record);
  if (claim.outcome === "published") return false;

  if (claim.outcome === "reconcile") {
    const existingId = await publisher.findCommentByMarker(claim.record.marker);
    if (existingId !== undefined) {
      await ledger.completePublication(id, existingId);
      return false;
    }
  }

  const githubCommentId = await publisher.publish({
    body,
    marker,
    ...location,
  });
  await ledger.completePublication(id, githubCommentId);
  return true;
}

export class ExecuteReview {
  public constructor(
    private readonly dependencies: ExecuteReviewDependencies,
  ) {}

  public async execute(
    job: ReviewJob,
    workflowInstanceId = job.envelope.deliveryId,
  ): Promise<ExecuteReviewResult> {
    const run = createReviewRun(job);
    const claim = await this.dependencies.ledger.claimRun(
      run,
      workflowInstanceId,
    );
    if (claim === "duplicate")
      return { findingsPublished: 0, outcome: "duplicate" };

    const lifecycle: { state: RunState } = {
      state: claim === "resume" ? "failed_retryable" : "queued",
    };
    const moveTo = async (next: RunState): Promise<void> => {
      await this.dependencies.ledger.transition(
        run.id,
        lifecycle.state,
        next,
        this.dependencies.clock.now(),
        `${workflowInstanceId}:${lifecycle.state}->${next}`,
      );
      lifecycle.state = next;
    };

    try {
      await moveTo("running");
      const context = await this.dependencies.repository.loadContext(job);
      const modelOutput = await this.dependencies.model.review(job, context);
      const findings = selectValidFindings(
        modelOutput.findings,
        context.changedLines,
      );

      await moveTo("publishing");
      if (
        !(await this.dependencies.ledger.isLatestRun(run.id)) ||
        (await this.dependencies.pullRequest.currentHeadSha(job)) !==
          job.envelope.pullRequest.headSha
      ) {
        await moveTo("obsolete");
        return { findingsPublished: 0, outcome: "obsolete" };
      }

      let findingsPublished = 0;
      for (const finding of findings) {
        if (classifyFindingPublication(finding) !== "inline") continue;
        const findingId = await createFindingId(run.id, {
          diagnostic: finding.diagnostic,
          endLine: finding.location.line,
          path: finding.location.path,
          startLine: finding.location.startLine ?? finding.location.line,
        });
        const wasPublished = await publishOnce(
          this.dependencies.ledger,
          this.dependencies.publisher,
          run.id,
          findingId,
          "inline",
          renderFinding(finding),
          {
            line: finding.location.line,
            path: finding.location.path,
            side: finding.location.side,
            ...(finding.location.startLine === undefined
              ? {}
              : { startLine: finding.location.startLine }),
          },
        );
        if (wasPublished) findingsPublished += 1;
      }

      await publishOnce(
        this.dependencies.ledger,
        this.dependencies.publisher,
        run.id,
        "summary",
        "summary",
        modelOutput.summary,
        {},
      );
      await moveTo("completed");
      return { findingsPublished, outcome: "completed" };
    } catch (error) {
      if (lifecycle.state === "running" || lifecycle.state === "publishing") {
        await moveTo("failed_retryable");
      }
      throw error;
    }
  }
}
