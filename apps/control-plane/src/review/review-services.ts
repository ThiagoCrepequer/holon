import type {
  FindingLifecycleLedger,
  ModelReviewer,
  ReviewDecisionLedger,
  ReviewPublisher,
} from "@holon/application";
import type {
  ReviewBudgetPlan,
  ModelGenerationAdmission,
  ModelGenerationReservation,
  ModelGenerationStopReason,
} from "@holon/contracts";
import type { RepositoryToolOperation } from "@holon/contracts";
import {
  type ProjectIdentificationResult,
  type ProjectMetadataRequest,
} from "@holon/contracts";
import {
  executorRequestSchema,
  preparedRepositorySchema,
  reviewContextSchema,
  type ExecutorRequest,
  type GitHubCredentialRequest,
  type PreparedRepository,
  type RepositoryPolicy,
  type RepositoryToolCall,
  type ReviewContext,
  type ReviewJob,
  type RunClaimResult,
} from "@holon/contracts";
import type {
  ReconciledReviewOutput,
  ReviewAnalysisCheckpoint,
} from "@holon/contracts";
import { createPrKey, type RunId, type RunState } from "@holon/domain";
import {
  createInstallationSessionWithKeyring,
  GitHubReviewPublisher,
  type GitHubInstallationSession,
} from "@holon/github";
import { NonRetryableError } from "cloudflare:workflows";

import {
  createKeyringTelemetryOptions,
  resolveControlPlaneKeyring,
} from "../github/github-credentials.js";
import {
  executeGitHubOperation,
  GitHubTransientError,
} from "../github/github-operations.js";
import type { DesiredCheckRun } from "../ledger/check-run-reconciliation.js";
import type { WorkflowController } from "../ledger/workflow-superseding.js";
import {
  resolveRunMemory,
  type RunMemoryLedger,
} from "../memory/run-memory.js";
import { errorKind, type StructuredLogger } from "../observability.js";
import { createProjectIdentifier } from "../project-identification/project-identification-service.js";
import type { PublicationLedger } from "./authorized-publication.js";
import {
  configurationScopePolicy,
  type RunConfigurationLedger,
} from "./run-configuration-resolver.js";
import { ThinkReviewModelReviewer } from "./think-reviewer.js";

function shouldEnrichProjects(value: string): boolean {
  return value === "enrich";
}

export interface RepositoryExecutorBinding {
  getEvidencePack(
    runId: string,
    deadlineAt: number,
  ): Promise<import("@holon/contracts").ReviewEvidencePack>;
  discoverProjectMetadata(
    request: ProjectMetadataRequest,
  ): Promise<ProjectIdentificationResult>;
  cleanup(runId: string): Promise<void>;
  hasContext(runId: string): Promise<boolean>;
  loadContext(runId: string): Promise<ReviewContext>;
  prepareRepository(request: ExecutorRequest): Promise<PreparedRepository>;
  resolveContainerId(runId: string): Promise<string> | string;
  acquireReviewLease(runId: string, deadlineAt: number): Promise<void>;
  startTool(
    runId: string,
    call: RepositoryToolCall,
    deadlineAt: number,
  ): Promise<RepositoryToolOperation>;
}

export interface WorkflowLedger
  extends
    PublicationLedger,
    ReviewDecisionLedger,
    FindingLifecycleLedger,
    RunConfigurationLedger,
    RunMemoryLedger {
  hasPriorPublishedReview(runId: string): Promise<boolean>;
  scheduleCheckRun(runId: string, desired: DesiredCheckRun): Promise<number>;
  reconcileCheckRun(runId: string): Promise<number | undefined>;
  saveReviewAnalysis(
    runId: string,
    output: ReconciledReviewOutput,
  ): Promise<ReviewAnalysisCheckpoint>;
  loadReviewAnalysis(runId: string): Promise<ReconciledReviewOutput>;

  configureReviewBudget(runId: string, plan: ReviewBudgetPlan): Promise<void>;
  completeReviewBudgetShard(runId: string, index: number): Promise<void>;
  reserveModelGeneration(
    runId: string,
    request: ModelGenerationReservation,
  ): Promise<ModelGenerationAdmission | undefined>;
  loadModelGenerationStop(
    runId: string,
  ): Promise<ModelGenerationStopReason | undefined>;
  settleModelGeneration(
    runId: string,
    id: number,
    outputTokens: number,
  ): Promise<void>;

  reserveAnalysisToolCall(
    runId: string,
    index: number,
    totalShards: number,
  ): Promise<boolean>;

  loadFindingFeedbacks(
    prKey: Parameters<FindingLifecycleLedger["loadPrFindings"]>[0],
  ): Promise<readonly import("@holon/domain").FindingFeedbackRecord[]>;
  saveProjectIdentification?(
    runId: string,
    result: ProjectIdentificationResult,
  ): Promise<void>;
  claimRun(
    run: Parameters<PublicationLedger["claimRun"]>[0],
    workflowInstanceId: string,
  ): Promise<RunClaimResult>;
  completeWorkflowSupersession(
    runId: RunId,
    completedAt: string,
  ): Promise<void>;
  markTerminalAndRequestCleanup(
    runId: RunId,
    occurredAt: string,
    requiresCleanup: boolean,
  ): Promise<boolean>;

  registerCredentialScope(request: GitHubCredentialRequest): Promise<void>;
  runState(runId: RunId): Promise<RunState | undefined> | RunState | undefined;
  transitionAndRequestCleanup(
    runId: RunId,
    expected: RunState,
    next: RunState,
    occurredAt: string,
    operationId: string,
  ): Promise<void>;
}

export interface ReviewRuntime {
  readonly reconcileCheckRun?: (
    runId: string,
    connect: () => Promise<GitHubInstallationSession>,
  ) => Promise<number | undefined>;
  readonly identificationModel?: import("@holon/application").ProjectIdentificationModel;

  readonly createModel?: () => ModelReviewer;
  readonly createSession?: (
    installationId: number,
    repositoryId: number,
  ) => Promise<GitHubInstallationSession>;
  readonly executor?: RepositoryExecutorBinding;
  readonly logger?: StructuredLogger;
  readonly now?: () => string;
  readonly wait?: (delayMilliseconds: number) => Promise<void>;
  readonly workflow?: WorkflowController;
}

export interface GitHubMutationContext {
  readonly publisher: ReviewPublisher;
  readCurrentHead(): Promise<string>;
  readCurrentRefs(): Promise<{
    readonly baseSha: string;
    readonly headSha: string;
  }>;
}

export interface ReviewServices {
  resolveMemory(
    paths: string[],
  ): Promise<import("@holon/contracts").MemorySnapshot>;
  createShardReviewer(
    index: number,
    totalShards: number,
    cancellation?: AbortController,
  ): {
    readonly model: ModelReviewer;
  };
  useProjectIdentification?(result: ProjectIdentificationResult): void;
  getProjectIdentification?(): ProjectIdentificationResult | undefined;
  identifyProjects?(
    policy: RepositoryPolicy,
    input?: ProjectIdentificationResult,
    discoveryOnly?: boolean,
    deadlineAt?: number,
  ): Promise<ProjectIdentificationResult | null>;

  readonly executor: RepositoryExecutorBinding;
  readonly ledger: WorkflowLedger;
  readonly model: ModelReviewer;
  readonly workflow: WorkflowController;
  reconcileCheckRun(runId: string): Promise<number | undefined>;
  createMutationContext(): Promise<GitHubMutationContext>;
  createSession(): Promise<GitHubInstallationSession>;
  /** True when the canonical checkout/context was reconstructed. */
  ensureContext(
    maximumPreparationAttempts: number,
    effectivePolicy?: RepositoryPolicy,
  ): Promise<boolean>;
  loadContext(effectivePolicy?: RepositoryPolicy): Promise<ReviewContext>;
  prepareRepository(
    maximumAttempts: number,
    effectivePolicy?: RepositoryPolicy,
  ): Promise<PreparedRepository>;
  readCurrentHead(): Promise<string>;
  readCurrentRefs(): Promise<{
    readonly baseSha: string;
    readonly headSha: string;
  }>;
  registerCredentialScope(): Promise<void>;
}

function prKeyFor(job: ReviewJob) {
  return createPrKey({
    provider: "github",
    pullRequestNumber: job.envelope.pullRequest.number,
    repositoryId: job.envelope.repository.id,
  });
}

export class RepositoryTransientError extends Error {
  public constructor(
    reason: "executor" | "repository",
    options?: ErrorOptions,
  ) {
    super(`HOLON_REPOSITORY_TRANSIENT:${reason}`, options);
    this.name = "RepositoryTransientError";
  }
}

function normalizeRepositoryFailure(
  error: unknown,
  logger?: StructuredLogger,
  logContext?: Readonly<Record<string, number | string>>,
): never {
  if (
    error instanceof NonRetryableError ||
    error instanceof GitHubTransientError
  ) {
    throw error;
  }
  if (error instanceof Error) {
    if (
      error.name === "RepositoryTransientError" ||
      error.message.startsWith("HOLON_REPOSITORY_TRANSIENT:")
    ) {
      logger?.emit("repository.preparation_failed", {
        ...logContext,
        errorKind: "RepositoryTransientError",
        reason: "typed_repository_failure",
        retryable: true,
      });
      throw new RepositoryTransientError("repository");
    }
    if (
      error.name === "RepositoryPermanentError" ||
      error.name === "ZodError" ||
      error instanceof TypeError ||
      error.message.startsWith("HOLON_REPOSITORY_PERMANENT:")
    ) {
      logger?.emit("repository.preparation_failed", {
        ...logContext,
        errorKind: "RepositoryPermanentError",
        reason: "typed_repository_failure",
        retryable: false,
      });
      throw new NonRetryableError("HOLON_REPOSITORY_NON_RETRYABLE");
    }
  }
  logger?.emit("repository.preparation_failed", {
    ...logContext,
    errorKind: errorKind(error),
    reason: "unknown",
    retryable: true,
  });
  throw new RepositoryTransientError("executor");
}

export function createReviewServices(
  env: Cloudflare.Env,
  job: ReviewJob,
  runtime: ReviewRuntime,
  logger: StructuredLogger,
  logContext: Readonly<Record<string, number | string>>,
): ReviewServices {
  let projectIdentification: ProjectIdentificationResult | undefined;
  const executor: RepositoryExecutorBinding =
    runtime.executor ?? env.REPOSITORY_EXECUTOR;
  const ledger = env.REVIEW_LEDGERS.getByName(
    prKeyFor(job),
  ) as unknown as WorkflowLedger;
  const wait = runtime.wait ?? ((delay) => scheduler.wait(delay));
  const createSession = async () =>
    await executeGitHubOperation(async () => {
      if (runtime.createSession) {
        return await runtime.createSession(
          job.envelope.installationId,
          job.envelope.repository.id,
        );
      }
      const keyring = resolveControlPlaneKeyring(env);
      const keyringOptions = createKeyringTelemetryOptions(logger, logContext);
      return await createInstallationSessionWithKeyring(
        keyring,
        job.envelope.installationId,
        job.envelope.repository.id,
        keyringOptions,
      );
    }, Date.now);

  const resolveCredentialContainerId = async (): Promise<string> => {
    const containerId = await executor.resolveContainerId(job.runId);
    if (!/^[a-f0-9]{64}$/u.test(containerId)) {
      throw new TypeError("Executor returned an invalid container ID");
    }
    return containerId;
  };

  const prepareOnce = async (
    policy?: RepositoryPolicy,
  ): Promise<PreparedRepository> => {
    try {
      let effectivePolicy = policy;
      if (effectivePolicy === undefined) {
        const reference = await ledger.findRunConfiguration(job.runId);
        if (reference === undefined)
          throw new NonRetryableError(
            "Repository configuration is not compiled",
          );
        effectivePolicy = configurationScopePolicy(
          await ledger.loadRunConfiguration(reference),
        );
      }

      const github = await createSession();
      const canonicalDiff = await executeGitHubOperation(() =>
        github.pullRequestDiff(
          job.envelope.repository.owner,
          job.envelope.repository.name,
          job.envelope.pullRequest.number,
        ),
      );
      const commonRequest = {
        baseSha: job.envelope.pullRequest.baseSha,
        canonicalDiff,
        cloneUrl: `https://github.com/${job.envelope.repository.fullName}.git`,
        headSha: job.envelope.pullRequest.headSha,
        pullRequestNumber: job.envelope.pullRequest.number,
        repositoryId: job.envelope.repository.id,
        runId: job.runId,
      } as const;

      const request = executorRequestSchema.parse({
        ...commonRequest,
        effectivePolicy,
        installationId: job.envelope.installationId,
        repositoryName: job.envelope.repository.name,
        repositoryOwner: job.envelope.repository.owner,
      });

      return preparedRepositorySchema.parse(
        await executor.prepareRepository(request),
      );
    } catch (error) {
      return normalizeRepositoryFailure(error, logger, logContext);
    }
  };

  const prepareRepository = async (
    maximumAttempts: number,
    policy?: RepositoryPolicy,
  ): Promise<PreparedRepository> => {
    if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts <= 0) {
      throw new TypeError("maximumAttempts must be a positive safe integer");
    }
    let lastError: unknown;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        return await prepareOnce(policy);
      } catch (error) {
        if (error instanceof NonRetryableError) throw error;
        lastError = error;
        if (attempt < maximumAttempts)
          await wait(Math.min(5_000, attempt * 1_000));
      }
    }
    throw lastError;
  };

  let contextPreparation: Promise<boolean> | undefined;
  const ensureContext = (
    maximumAttempts: number,
    policy?: RepositoryPolicy,
  ): Promise<boolean> => {
    if (contextPreparation) return contextPreparation;
    const pending = (async () => {
      if (await executor.hasContext(job.runId)) return false;
      await prepareRepository(maximumAttempts, policy);
      return true;
    })();
    contextPreparation = pending;
    return pending.finally(() => {
      if (contextPreparation === pending) contextPreparation = undefined;
    });
  };
  const createShardReviewer = (
    shardIndex: number,
    shardCount: number,
    cancellation = new AbortController(),
  ) => {
    const model =
      runtime.createModel?.() ??
      new ThinkReviewModelReviewer(
        env,
        shardIndex,
        shardCount,
        wait,
        (event, fields) => logger.emit(event, { ...logContext, ...fields }),
      );
    return {
      model: {
        review: (
          reviewJob: ReviewJob,
          context: Parameters<ModelReviewer["review"]>[1],
        ) =>
          model.review(reviewJob, {
            ...context,
            abortSignal: context.abortSignal
              ? AbortSignal.any([context.abortSignal, cancellation.signal])
              : cancellation.signal,
          }),
      },
    };
  };
  const model = createShardReviewer(0, 1).model;

  const mutationContext = async (): Promise<GitHubMutationContext> => {
    const github = await createSession();
    const delegate = new GitHubReviewPublisher(github.api, {
      expectedAuthorLogin: github.expectedAuthorLogin,
      headSha: job.envelope.pullRequest.headSha,
      owner: job.envelope.repository.owner,
      pullNumber: job.envelope.pullRequest.number,
      repo: job.envelope.repository.name,
    });
    return {
      publisher: {
        createCheckRun: (input) =>
          executeGitHubOperation(() => delegate.createCheckRun(input)),
        findCheckRunByExternalId: (externalId) =>
          executeGitHubOperation(() =>
            delegate.findCheckRunByExternalId(externalId),
          ),
        findCommentByMarker: (marker, kind) =>
          executeGitHubOperation(() =>
            delegate.findCommentByMarker(marker, kind),
          ),
        findReviewCommentsByMarkers: (reviewId, markers) =>
          executeGitHubOperation(() =>
            delegate.findReviewCommentsByMarkers(reviewId, markers),
          ),
        publish: (input) =>
          executeGitHubOperation(() => delegate.publish(input)),
        replyToComment: (commentId, body) =>
          executeGitHubOperation(() =>
            delegate.replyToComment(commentId, body),
          ),
        updateCheckRun: (input) =>
          executeGitHubOperation(() => delegate.updateCheckRun(input)),
      },
      readCurrentHead: () =>
        executeGitHubOperation(() =>
          github.currentHeadSha(
            job.envelope.repository.owner,
            job.envelope.repository.name,
            job.envelope.pullRequest.number,
          ),
        ),
      readCurrentRefs: () =>
        executeGitHubOperation(async () => {
          return await github.currentPullRequestRefs(
            job.envelope.repository.owner,
            job.envelope.repository.name,
            job.envelope.pullRequest.number,
          );
        }),
    };
  };

  return {
    resolveMemory: (paths) => resolveRunMemory(env, job, ledger, paths),
    executor,
    ledger,
    model,
    createShardReviewer,
    workflow: runtime.workflow ?? env.REVIEW_WORKFLOW,
    createMutationContext: mutationContext,
    reconcileCheckRun: runtime.reconcileCheckRun
      ? (runId) => runtime.reconcileCheckRun!(runId, createSession)
      : (runId) => ledger.reconcileCheckRun(runId),
    createSession: async () => await createSession(),
    ensureContext,
    loadContext: async () =>
      reviewContextSchema.parse(await executor.loadContext(job.runId)),
    useProjectIdentification: (result) => {
      if (shouldEnrichProjects(env.PROJECT_IDENTIFICATION_MODE))
        projectIdentification = result;
    },
    getProjectIdentification: () => projectIdentification,
    identifyProjects: createProjectIdentifier(
      env,
      job,
      executor,
      prepareRepository,
      runtime.identificationModel,
    ),
    prepareRepository,
    readCurrentHead: async () => {
      const github = await createSession();
      return await executeGitHubOperation(() =>
        github.currentHeadSha(
          job.envelope.repository.owner,
          job.envelope.repository.name,
          job.envelope.pullRequest.number,
        ),
      );
    },
    readCurrentRefs: async () => {
      const github = await createSession();
      return await executeGitHubOperation(async () => {
        return await github.currentPullRequestRefs(
          job.envelope.repository.owner,
          job.envelope.repository.name,
          job.envelope.pullRequest.number,
        );
      }, Date.now);
    },
    registerCredentialScope: async () => {
      await ledger.registerCredentialScope({
        containerId: await resolveCredentialContainerId(),
        installationId: job.envelope.installationId,
        repositoryId: job.envelope.repository.id,
        repositoryName: job.envelope.repository.name,
        repositoryOwner: job.envelope.repository.owner,
        runId: job.runId,
      });
    },
  };
}
