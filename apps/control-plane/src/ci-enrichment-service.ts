import type { ReviewPublisher } from "@holon/application";
import { ingestCiArtifactZips } from "@holon/application";
import {
  appendCiEvidenceToSummary,
  buildPublicationMarker,
  calculateChangedLinesCoverage,
  createPrKey,
  createRunId,
  formatCiEvidenceMarkdown,
} from "@holon/domain";
import {
  createInstallationSession,
  GitHubReviewPublisher,
  type GitHubInstallationSession,
} from "@holon/github";
import {
  collectChangedLines,
  isNonBinaryPullRequestPatch,
  splitPullRequestDiff,
} from "@holon/repository-analysis";

import { parseAppId } from "./credential-broker.js";
import { consoleLogger, type StructuredLogger } from "./observability.js";

export interface CiEnrichmentInput {
  readonly deliveryId: string;
  readonly headSha: string;
  readonly installationId: number;
  readonly pullRequestNumber: number;
  readonly repository: {
    readonly id: number;
    readonly name: string;
    readonly owner: string;
  };
  readonly workflowName?: string | undefined;
  readonly workflowRunId: number;
}

export interface CiEnrichmentResult {
  readonly enriched: boolean;
  readonly reason?: string;
}

export interface CiEnrichmentDependencies {
  readonly createPublisher?: (
    api: GitHubInstallationSession["api"],
    target: {
      readonly expectedAuthorLogin: string;
      readonly headSha: string;
      readonly owner: string;
      readonly pullNumber: number;
      readonly repo: string;
    },
  ) => ReviewPublisher;
  readonly createSession?: typeof createInstallationSession;
  readonly logger?: StructuredLogger;
}

/**
 * Enriches an existing review summary comment with CI test execution & coverage evidence
 * after a workflow run completes in the repository.
 */
export async function enrichReviewWithCiEvidence(
  env: Cloudflare.Env,
  input: CiEnrichmentInput,
  dependencies: CiEnrichmentDependencies = {},
): Promise<CiEnrichmentResult> {
  const logger = dependencies.logger ?? consoleLogger;
  const sessionFactory =
    dependencies.createSession ?? createInstallationSession;
  const publisherFactory =
    dependencies.createPublisher ??
    ((api, target) => new GitHubReviewPublisher(api, target));

  let session: GitHubInstallationSession;
  try {
    const credentials = {
      appId: parseAppId(env.GITHUB_APP_ID),
      appSlug: env.GITHUB_APP_SLUG,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
    };

    session = await sessionFactory(
      credentials,
      input.installationId,
      input.repository.id,
    );
  } catch (error) {
    logger.emit("ci_enrichment_session_failed", {
      error: error instanceof Error ? error.message : String(error),
      installationId: input.installationId,
      pullRequestNumber: input.pullRequestNumber,
    });
    return { enriched: false, reason: "session_failed" };
  }

  if (!session.listWorkflowRunArtifacts || !session.downloadArtifactZip) {
    logger.emit("ci_enrichment_unsupported_session", {
      pullRequestNumber: input.pullRequestNumber,
    });
    return { enriched: false, reason: "unsupported_session" };
  }

  // 1. List workflow run artifacts
  const artifacts = await session.listWorkflowRunArtifacts(
    input.repository.owner,
    input.repository.name,
    input.workflowRunId,
  );

  if (artifacts.length === 0) {
    logger.emit("ci_enrichment_skipped_no_artifacts", {
      pullRequestNumber: input.pullRequestNumber,
      workflowRunId: input.workflowRunId,
    });
    return { enriched: false, reason: "no_artifacts" };
  }

  // 2. Download artifact zips (take up to 3 artifacts matching reports or candidates)
  const zipBuffers: ArrayBuffer[] = [];
  for (const artifact of artifacts.slice(0, 3)) {
    try {
      const zip = await session.downloadArtifactZip(
        input.repository.owner,
        input.repository.name,
        artifact.id,
      );
      zipBuffers.push(zip);
    } catch (error) {
      logger.emit("ci_artifact_download_failed", {
        artifactId: artifact.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (zipBuffers.length === 0) {
    return { enriched: false, reason: "download_failed" };
  }

  // 3. Ingest and parse artifacts
  const evidence = ingestCiArtifactZips(zipBuffers, {
    source: "github-actions",
    workflowName: input.workflowName,
    workflowRunId: input.workflowRunId,
  });

  if (evidence.status === "not_available") {
    logger.emit("ci_enrichment_no_valid_reports", {
      workflowRunId: input.workflowRunId,
    });
    return { enriched: false, reason: "no_valid_reports" };
  }

  // 4. Correlate with changed lines from PR diff
  const diff = await session.pullRequestDiff(
    input.repository.owner,
    input.repository.name,
    input.pullRequestNumber,
  );
  const diffFiles = splitPullRequestDiff(diff).filter((file) =>
    isNonBinaryPullRequestPatch(file.patch),
  );
  const changedLines = diffFiles.flatMap((file) =>
    collectChangedLines(file.path, file.patch),
  );
  const changedCoverage = evidence.coverage
    ? calculateChangedLinesCoverage(changedLines, evidence.coverage)
    : undefined;

  // 5. Locate existing review summary comment by deterministic marker
  const prKey = createPrKey({
    provider: "github",
    pullRequestNumber: input.pullRequestNumber,
    repositoryId: input.repository.id,
  });
  const runId = createRunId(prKey, input.headSha);
  const summaryMarker = buildPublicationMarker(runId, "summary");
  const publisher = publisherFactory(session.api, {
    expectedAuthorLogin: session.expectedAuthorLogin,
    headSha: input.headSha,
    owner: input.repository.owner,
    pullNumber: input.pullRequestNumber,
    repo: input.repository.name,
  });

  const existingReview = await publisher.findCommentWithBodyByMarker?.(
    summaryMarker,
    "summary",
  );

  if (!existingReview) {
    logger.emit("ci_enrichment_summary_not_found", {
      pullRequestNumber: input.pullRequestNumber,
      runId,
    });
    return { enriched: false, reason: "summary_not_found" };
  }

  // 6. Format and update the review comment
  const evidenceMarkdown = formatCiEvidenceMarkdown(evidence, changedCoverage);
  const updatedSummary = appendCiEvidenceToSummary(
    existingReview.body,
    evidenceMarkdown,
  );

  if (updatedSummary !== existingReview.body) {
    await publisher.updateReviewComment?.(existingReview.id, updatedSummary);
    logger.emit("ci_enrichment_success", {
      commentId: existingReview.id,
      pullRequestNumber: input.pullRequestNumber,
      runId,
    });
    return { enriched: true };
  }

  return { enriched: false, reason: "no_changes" };
}
