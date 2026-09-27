import type { CiEvidenceLedger } from "@holon/application";
import { ingestCiArtifactZips } from "@holon/application";
import {
  truncateUtf8Bytes,
  type AdminCiSummary,
  type CiEnrichmentInput,
} from "@holon/contracts";
import {
  calculateChangedLinesCoverage,
  createPrKey,
  formatCiEvidenceMarkdown,
} from "@holon/domain";
import {
  createInstallationSessionWithKeyring,
  type GitHubAppCredentials,
  type GitHubAppKeyring,
  type GitHubInstallationSession,
  type KeyringOperationOptions,
} from "@holon/github";
import { consoleErrorReporter, reportError } from "@holon/observability";
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

export interface CiEnrichmentResult {
  readonly enriched: boolean;
  readonly reason?: string;
}

export interface CiEnrichmentDependencies {
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
    throw error;
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
      workflowRunAttempt: input.workflowRunAttempt,
    });
    return { enriched: false, reason: "no_artifacts" };
  }

  // 2. Download artifact zips (take up to 3 artifacts matching reports or candidates)
  const zipBuffers: ArrayBuffer[] = [];
  let downloadFailed = false;
  for (const artifact of artifacts.slice(0, 3)) {
    try {
      const zip = await session.downloadArtifactZip(
        input.repository.owner,
        input.repository.name,
        artifact.id,
      );
      zipBuffers.push(zip);
    } catch (error) {
      downloadFailed = true;
      logger.emit("ci_artifact_download_failed", {
        artifactId: artifact.id,
        errorKind: errorKind(error),
      });
    }
  }

  if (downloadFailed || zipBuffers.length === 0) {
    throw new Error("CI artifact download failed");
  }

  // 3. Ingest and parse artifacts
  const parsedEvidence = ingestCiArtifactZips(zipBuffers, {
    source: "github-actions",
    workflowName: input.workflowName,
    workflowRunId: input.workflowRunId,
    onPartialError: (kind, index, error) =>
      reportError(consoleErrorReporter, "ci.artifact_partial_failure", error, {
        component: "control-plane",
        operation: `ci.${kind}`,
        deliveryId: input.deliveryId,
        repositoryId: input.repository.id,
        pullRequestNumber: input.pullRequestNumber,
        messageIndex: index,
      }),
  });

  const evidence =
    artifacts.length > 3
      ? {
          ...parsedEvidence,
          status:
            parsedEvidence.status === "available"
              ? ("partial" as const)
              : parsedEvidence.status,
          limitations: [
            ...(parsedEvidence.limitations ?? []),
            `${artifacts.length - 3} artifact(s) omitted by the per-execution download budget.`,
          ],
        }
      : parsedEvidence;

  if (evidence.status === "not_available") {
    logger.emit("ci_enrichment_no_valid_reports", {
      workflowRunId: input.workflowRunId,
      workflowRunAttempt: input.workflowRunAttempt,
    });
    return { enriched: false, reason: "no_valid_reports" };
  }

  // Correlate only when a mutable PR diff is bracketed by identical refs for this CI head.
  const refsBefore = await session.currentPullRequestRefs(
    input.repository.owner,
    input.repository.name,
    input.pullRequestNumber,
  );
  let changedCoverage;
  if (refsBefore.headSha === input.headSha && evidence.coverage) {
    const diff = await session.pullRequestDiff(
      input.repository.owner,
      input.repository.name,
      input.pullRequestNumber,
    );
    const refsAfter = await session.currentPullRequestRefs(
      input.repository.owner,
      input.repository.name,
      input.pullRequestNumber,
    );
    if (
      refsAfter.headSha === refsBefore.headSha &&
      refsAfter.baseSha === refsBefore.baseSha
    ) {
      const changedLines = splitPullRequestDiff(diff)
        .filter((file) => isNonBinaryPullRequestPatch(file.patch))
        .flatMap((file) => collectChangedLines(file.path, file.patch));
      changedCoverage = calculateChangedLinesCoverage(
        changedLines,
        evidence.coverage,
      );
    }
  }

  const prKey = createPrKey({
    provider: "github",
    pullRequestNumber: input.pullRequestNumber,
    repositoryId: input.repository.id,
  });
  const markdownByLanguage = {
    en: truncateUtf8Bytes(
      formatCiEvidenceMarkdown(evidence, changedCoverage, "en"),
      16000,
    ),
    "pt-BR": truncateUtf8Bytes(
      formatCiEvidenceMarkdown(evidence, changedCoverage, "pt-BR"),
      16000,
    ),
    es: truncateUtf8Bytes(
      formatCiEvidenceMarkdown(evidence, changedCoverage, "es"),
      16000,
    ),
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
      workflowRunAttempt: input.workflowRunAttempt,
      target: {
        installationId: input.installationId,
        repositoryId: input.repository.id,
        owner: input.repository.owner,
        repo: input.repository.name,
        pullNumber: input.pullRequestNumber,
      },
    });
  }

  // The durable outbox revalidates live head/base and the persisted decision
  // before publishing the localized summary, including CI that arrives first.
  if (ledger === undefined) throw new Error("CI ledger is unavailable");
  return { enriched: true, reason: "saved_pending_review" };
}
