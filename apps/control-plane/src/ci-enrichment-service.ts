import type { CiEvidenceLedger, ReviewPublisher } from "@holon/application";
import { ingestCiArtifactZips } from "@holon/application";
import { truncateUtf8Bytes, type AdminCiSummary } from "@holon/contracts";
import {
  appendCiEvidenceToSummary,
  buildPublicationMarker,
  calculateChangedLinesCoverage,
  createPrKey,
  createRunId,
  formatCiEvidenceMarkdown,
} from "@holon/domain";
import {
  createInstallationSessionWithKeyring,
  GitHubReviewPublisher,
  type GitHubAppCredentials,
  type GitHubAppKeyring,
  type GitHubInstallationSession,
  type KeyringOperationOptions,
} from "@holon/github";
import {
  collectChangedLines,
  isNonBinaryPullRequestPatch,
  splitPullRequestDiff,
} from "@holon/repository-analysis";

import {
  createKeyringTelemetryOptions,
  resolveControlPlaneKeyring,
} from "./github-credentials.js";
import {
  consoleLogger,
  errorKind,
  type StructuredLogger,
} from "./observability.js";

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
  readonly createSession?: (
    credentialsOrKeyring: GitHubAppCredentials | GitHubAppKeyring,
    installationId: number,
    repositoryId: number,
    options?: KeyringOperationOptions,
  ) => Promise<GitHubInstallationSession>;
  readonly ledger?: CiEvidenceLedger;
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
    dependencies.createSession ?? createInstallationSessionWithKeyring;
  const publisherFactory =
    dependencies.createPublisher ??
    ((api, target) => new GitHubReviewPublisher(api, target));

  let session: GitHubInstallationSession;
  try {
    const keyring = resolveControlPlaneKeyring(env);
    const keyringOptions = createKeyringTelemetryOptions(logger, {
      installationId: input.installationId,
      pullRequestNumber: input.pullRequestNumber,
    });
    const credentials = {
      ...keyring,
      privateKey: keyring.currentPrivateKey,
    };

    session = await sessionFactory(
      credentials,
      input.installationId,
      input.repository.id,
      keyringOptions,
    );
  } catch (error) {
    logger.emit("ci_enrichment_session_failed", {
      errorKind: errorKind(error),
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
        errorKind: errorKind(error),
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

  const prKey = createPrKey({
    provider: "github",
    pullRequestNumber: input.pullRequestNumber,
    repositoryId: input.repository.id,
  });
  const refs = await session.currentPullRequestRefs(
    input.repository.owner,
    input.repository.name,
    input.pullRequestNumber,
  );
  if (refs.headSha !== input.headSha)
    return { enriched: false, reason: "obsolete_head" };
  const runId = createRunId(prKey, input.headSha, refs.baseSha);
  const summaryMarker = buildPublicationMarker(runId, "summary");
  const markdownByLanguage = {
    en: formatCiEvidenceMarkdown(evidence, changedCoverage, "en"),
    "pt-BR": formatCiEvidenceMarkdown(evidence, changedCoverage, "pt-BR"),
    es: formatCiEvidenceMarkdown(evidence, changedCoverage, "es"),
  };

  // 5. Always persist CI evidence in the PR's Durable Object SQLite ledger
  const rawWorkflowName = input.workflowName ?? evidence.workflowName;
  const structuredCi: AdminCiSummary = {
    durationMs: evidence.tests?.durationMs ?? null,
    failed: evidence.tests?.failed ?? 0,
    passed: evidence.tests?.passed ?? 0,
    skipped: evidence.tests?.skipped ?? 0,
    status: evidence.status,
    total: evidence.tests?.total ?? 0,
    workflowName:
      rawWorkflowName && rawWorkflowName.trim().length > 0
        ? truncateUtf8Bytes(rawWorkflowName.trim(), 100)
        : null,
  };
  const ledger = dependencies.ledger ?? env.REVIEW_LEDGERS?.getByName(prKey);
  if (ledger !== undefined) {
    await ledger.saveCiEvidence(prKey, input.headSha, {
      markdownByLanguage,
      structuredCi,
      workflowRunId: input.workflowRunId,
    });
  }

  // 6. Locate existing review summary comment by deterministic marker
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
    logger.emit("ci_enrichment_saved_pending_review", {
      pullRequestNumber: input.pullRequestNumber,
      runId,
    });
    return { enriched: true, reason: "saved_pending_review" };
  }

  const decision = await ledger?.loadLatestReviewDecision(prKey);
  if (decision?.runId !== runId)
    return { enriched: true, reason: "saved_pending_review" };
  const evidenceMarkdown = markdownByLanguage[decision.output.language];

  // 7. Format and update the review comment in-place
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
