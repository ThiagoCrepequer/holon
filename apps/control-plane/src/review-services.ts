import type {
  RunConfigurationRef,
  RunConfigurationSnapshot,
} from "@holon/contracts";

import type { DesiredCheckRun } from "./check-run-reconciliation.js";
function shouldEnrichProjects(value: string): boolean {
  return value === "enrich";
}
import type {
  CiEvidenceLedger,
  FindingLifecycleLedger,
  ModelReviewer,
  ReviewDecisionLedger,
  ReviewPublisher,
  RunTelemetryLedger,
  TelemetryEmitter,
} from "@holon/application";
import {
  projectIdentificationResultSchema,
  type ProjectIdentificationResult,
  type ProjectMetadataRequest,
} from "@holon/contracts";
import {
  executorRequestSchema,
  preparedRepositorySchema,
  repositoryToolResultSchema,
  reviewContextSchema,
  type AdminRunProjectionEvent,
  type ExecutorRequest,
  type GitHubCredentialRequest,
  type PreparedRepository,
  type RepositoryPolicy,
  type RepositoryToolCall,
  type RepositoryToolResult,
  type ReviewContext,
  type ReviewJob,
  type RunClaimResult,
  type StepExecutionNode,
  type StepPhase,
} from "@holon/contracts";
import type {
  ReconciledReviewOutput,
  ReviewAnalysisCheckpoint,
  AnalysisUsage,
  AnalysisAccounting,
} from "@holon/contracts";
import { createPrKey, type RunId, type RunState } from "@holon/domain";
import {
  createInstallationSessionWithKeyring,
  GitHubReviewPublisher,
  type GitHubInstallationSession,
} from "@holon/github";
import { GatewayProjectIdentificationModel } from "@holon/model";
import {
  AiSdkReviewGenerator,
  GatewayModelReviewer,
  createPartitionedRepositoryToolRunner,
  RepositoryToolBudgetExceededError,
  createRedactingRepositoryToolRunner,
} from "@holon/model";
import { safeErrorDetails } from "@holon/observability";
import {
  interpretProjects,
  detectorRevision,
} from "@holon/project-identification";
import { NonRetryableError } from "cloudflare:workflows";

import type { PublicationLedger } from "./authorized-publication.js";
import {
  createKeyringTelemetryOptions,
  resolveControlPlaneKeyring,
} from "./github-credentials.js";
import {
  executeGitHubOperation,
  GitHubTransientError,
} from "./github-operations.js";
import { errorKind, type StructuredLogger } from "./observability.js";
import { configurationScopePolicy } from "./run-configuration-resolver.js";
import {
  AnalyticsEngineTelemetryEmitter,
  CompositeTelemetryEmitter,
  StructuredLogTelemetryEmitter,
} from "./telemetry-emitter.js";
import type { WorkflowController } from "./workflow-superseding.js";

export interface RepositoryExecutorBinding {
  discoverProjectMetadata(
    request: ProjectMetadataRequest,
  ): Promise<ProjectIdentificationResult>;
  cleanup(runId: string): Promise<void>;
  hasContext(runId: string): Promise<boolean>;
  loadContext(runId: string): Promise<ReviewContext>;
  prepareRepository(request: ExecutorRequest): Promise<PreparedRepository>;
  resolveContainerId(runId: string): Promise<string> | string;
  runTool(
    runId: string,
    call: RepositoryToolCall,
  ): Promise<RepositoryToolResult>;
}

export interface WorkflowLedger
  extends
    PublicationLedger,
    ReviewDecisionLedger,
    CiEvidenceLedger,
    FindingLifecycleLedger,
    RunTelemetryLedger {
  scheduleCheckRun(runId: string, desired: DesiredCheckRun): Promise<number>;
  reconcileCheckRun(runId: string): Promise<number | undefined>;
  saveRunConfiguration(
    snapshot: RunConfigurationSnapshot,
  ): Promise<RunConfigurationRef>;
  loadRunConfiguration(
    reference: RunConfigurationRef,
  ): Promise<RunConfigurationSnapshot>;
  findRunConfiguration(runId: string): Promise<RunConfigurationRef | undefined>;
  saveReviewAnalysis(
    runId: string,
    output: ReconciledReviewOutput,
  ): Promise<ReviewAnalysisCheckpoint>;
  loadReviewAnalysis(runId: string): Promise<ReconciledReviewOutput>;
  recordAnalysisUsage(
    runId: string,
    eventId: string,
    usage: AnalysisUsage,
  ): Promise<void>;

  reserveAnalysisToolCall(
    runId: string,
    index: number,
    totalShards: number,
  ): Promise<boolean>;
  loadAnalysisAccounting(runId: string): Promise<AnalysisAccounting>;
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
  recordProjectionTask(event: AdminRunProjectionEvent): Promise<void>;
  markProjectionTaskCompleted(runId: RunId): Promise<void>;
  scheduleProjectionRetry(runId: RunId, errorKind: string): Promise<void>;
  registerCredentialScope(request: GitHubCredentialRequest): Promise<void>;
  runState(runId: RunId): Promise<RunState | undefined> | RunState | undefined;
  transitionAndRequestCleanup(
    runId: RunId,
    expected: RunState,
    next: RunState,
    occurredAt: string,
    operationId: string,
  ): Promise<void>;
  recordStepAttemptStart?(
    runId: string,
    stepName: string,
    phase: StepPhase,
    attempt: number,
    startedAt: string,
    sanitizedInput?: Record<string, unknown> | null,
    waitBeforeRetryMs?: number | null,
    stepOrder?: number | null,
  ): Promise<void>;
  recordStepAttemptComplete?(
    runId: string,
    stepName: string,
    attempt: number,
    endedAt: string,
    durationMs: number,
    sanitizedOutput?: Record<string, unknown> | null,
  ): Promise<void>;
  recordStepAttemptFailure?(
    runId: string,
    stepName: string,
    attempt: number,
    endedAt: string,
    durationMs: number,
    errorCode: string,
  ): Promise<void>;
  getStepExecutions?(runId: string): Promise<StepExecutionNode[]>;
}

export interface ReviewRuntime {
  readonly reconcileCheckRun?: (
    runId: string,
    connect: () => Promise<GitHubInstallationSession>,
  ) => Promise<number | undefined>;
  readonly identificationModel?: import("@holon/application").ProjectIdentificationModel;
  readonly adminProjectionQueue?: Queue<unknown>;
  readonly createModel?: (
    toolRunner: ReturnType<
      typeof createPartitionedRepositoryToolRunner
    >["runner"],
  ) => ModelReviewer;
  readonly createSession?: (
    installationId: number,
    repositoryId: number,
  ) => Promise<GitHubInstallationSession>;
  readonly executor?: RepositoryExecutorBinding;
  readonly logger?: StructuredLogger;
  readonly now?: () => string;
  readonly telemetry?: TelemetryEmitter;
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

function isAdminProjectionEnabled(env: Cloudflare.Env): boolean {
  return env.ADMIN_PROJECTION_ENABLED === "true";
}

export interface ReviewServices {
  createShardReviewer(
    index: number,
    totalShards: number,
    policy?: RepositoryPolicy,
  ): {
    readonly model: ModelReviewer;
    toolBudgetExceeded(): boolean;
  };
  useProjectIdentification?(result: ProjectIdentificationResult): void;
  getProjectIdentification?(): ProjectIdentificationResult | undefined;
  identifyProjects?(
    policy: RepositoryPolicy,
    input?: ProjectIdentificationResult,
    discoveryOnly?: boolean,
    deadlineAt?: number,
  ): Promise<ProjectIdentificationResult | null>;
  readonly adminProjectionQueue?: Queue<unknown> | undefined;
  readonly executor: RepositoryExecutorBinding;
  readonly ledger: WorkflowLedger;
  readonly model: ModelReviewer;
  readonly modelRoute?: string | undefined;
  readonly toolsBudget?: number | undefined;
  readonly telemetry: TelemetryEmitter;
  readonly workflow: WorkflowController;
  getAccumulatedUsage(): {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly toolCallsCount: number;
  };
  reconcileCheckRun(runId: string): Promise<number | undefined>;
  createMutationContext(): Promise<GitHubMutationContext>;
  createSession(): Promise<GitHubInstallationSession>;
  ensureContext(
    maximumPreparationAttempts: number,
    effectivePolicy?: RepositoryPolicy,
  ): Promise<void>;
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
        reason: safeErrorDetails(error).errorCode ?? "typed_repository_failure",
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
        reason: safeErrorDetails(error).errorCode ?? "typed_repository_failure",
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
  let identificationInputTokens = 0,
    identificationOutputTokens = 0;
  const executor: RepositoryExecutorBinding =
    runtime.executor ?? env.REPOSITORY_EXECUTOR;
  const ledger = env.REVIEW_LEDGERS.getByName(
    prKeyFor(job),
  ) as unknown as WorkflowLedger;
  const wait = runtime.wait ?? ((delay) => scheduler.wait(delay));
  const createSession = async () =>
    await executeGitHubOperation(
      async () => {
        if (runtime.createSession) {
          return await runtime.createSession(
            job.envelope.installationId,
            job.envelope.repository.id,
          );
        }
        const keyring = resolveControlPlaneKeyring(env);
        const keyringOptions = createKeyringTelemetryOptions(
          logger,
          logContext,
        );
        return await createInstallationSessionWithKeyring(
          keyring,
          job.envelope.installationId,
          job.envelope.repository.id,
          keyringOptions,
        );
      },
      Date.now,
      {
        context: {
          operation: "github.create_installation_session",
          runId: job.runId,
          repositoryId: job.envelope.repository.id,
          pullRequestNumber: job.envelope.pullRequest.number,
          installationId: job.envelope.installationId,
        },
      },
    );

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

  let inputTokens = 0;
  let outputTokens = 0;
  let toolCallsCount = 0;
  let contextPreparation: Promise<void> | undefined;
  const ensureContext = (
    maximumAttempts: number,
    policy?: RepositoryPolicy,
  ): Promise<void> => {
    if (contextPreparation) return contextPreparation;
    const pending = (async () => {
      if (!(await executor.hasContext(job.runId)))
        await prepareRepository(maximumAttempts, policy);
    })();
    contextPreparation = pending;
    return pending.finally(() => {
      if (contextPreparation === pending) contextPreparation = undefined;
    });
  };
  const createShardReviewer = (
    shardIndex: number,
    shardCount: number,
    policy?: RepositoryPolicy,
  ) => {
    let infrastructureFailure: unknown;
    let toolSequence = 0;
    const toolBudget = createPartitionedRepositoryToolRunner(
      createRedactingRepositoryToolRunner({
        run: async (call) => {
          const startedAt = Date.now();
          const toolCallIndex = ++toolSequence;
          const emitTool = (event: string, reason?: string) => {
            try {
              logger.emit(event, {
                ...logContext,
                eventId: `${logContext.workflowInstanceId ?? job.runId}:${event}:${shardIndex}:${toolCallIndex}`,
                shardIndex,
                toolName: call.name,
                toolCallIndex,
                durationMs: Date.now() - startedAt,
                reason,
              });
            } catch {
              /* Telemetry cannot alter infrastructure failures. */
            }
          };
          emitTool("repository.tool_started");
          try {
            if (
              !(await ledger.reserveAnalysisToolCall(
                job.runId,
                shardIndex,
                shardCount,
              ))
            )
              throw new RepositoryToolBudgetExceededError(12);
            toolCallsCount += 1;
            await ensureContext(2, policy);
            const result = repositoryToolResultSchema.parse(
              await executor.runTool(job.runId, call),
            );
            emitTool("repository.tool_finished");
            return result;
          } catch (error) {
            const reason =
              error instanceof RepositoryToolBudgetExceededError
                ? "tool_budget_exhausted"
                : error instanceof Error && error.name === "TimeoutError"
                  ? "repository_tool_timeout"
                  : "repository_tool_failed";
            emitTool("repository.tool_failed", reason);
            if (!(error instanceof RepositoryToolBudgetExceededError))
              infrastructureFailure = Object.assign(
                new Error("Repository infrastructure failed", { cause: error }),
                {
                  name: "RepositoryToolError",
                  code: reason,
                  phase: "repository_tool",
                },
              );
            throw error;
          }
        },
      }),
      12 * shardCount,
    );
    toolBudget.beginShard(shardIndex, shardCount);
    const delegateModel =
      runtime.createModel?.(toolBudget.runner) ??
      new GatewayModelReviewer(
        new AiSdkReviewGenerator(
          {
            accountId: env.AI_GATEWAY_ACCOUNT_ID,
            apiToken: env.AI_GATEWAY_API_TOKEN,
            gatewayId: env.AI_GATEWAY_ID,
            metadata: {
              pr_number: String(job.envelope.pullRequest.number),
              repository_id: String(job.envelope.repository.id),
              run_id: job.runId,
              stage: "review",
            },
            model: env.AI_MODEL_ID,
          },
          toolBudget.runner,
          async (usage) => {
            inputTokens += usage.inputTokens ?? 0;
            outputTokens += usage.outputTokens ?? 0;
            await ledger.recordAnalysisUsage(job.runId, crypto.randomUUID(), {
              inputTokens: usage.inputTokens ?? 0,
              outputTokens: usage.outputTokens ?? 0,
              toolCallsCount: 0,
            });
            logger.emit("model.usage", { ...logContext, ...usage });
          },
          "portable",
          ({ event, ...details }) =>
            logger.emit(event, {
              ...logContext,
              eventId: `${logContext.workflowInstanceId ?? job.runId}:${event}:${shardIndex}:${details.phase}:${details.attempt}:${details.round ?? 0}`,
              shardIndex,
              modelRoute: env.AI_MODEL_ID,
              ...details,
            }),
        ),
      );

    return {
      model: {
        async review(
          reviewJob: ReviewJob,
          context: Parameters<ModelReviewer["review"]>[1],
        ) {
          try {
            const result = await delegateModel.review(reviewJob, context);
            if (infrastructureFailure !== undefined)
              throw infrastructureFailure;
            return result;
          } catch (error) {
            throw infrastructureFailure ?? error;
          }
        },
        ...(delegateModel.synthesizeReviewSummary
          ? {
              synthesizeReviewSummary:
                delegateModel.synthesizeReviewSummary.bind(delegateModel),
            }
          : {}),
      },
      toolBudgetExceeded: () => toolBudget.exceeded(),
    };
  };
  const model = createShardReviewer(0, 1).model;

  const telemetry =
    runtime.telemetry ??
    new CompositeTelemetryEmitter([
      new AnalyticsEngineTelemetryEmitter(env.ANALYTICS_ENGINE),
      new StructuredLogTelemetryEmitter(logger),
    ]);

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
    adminProjectionQueue:
      runtime.adminProjectionQueue ??
      (isAdminProjectionEnabled(env) ? env.ADMIN_PROJECTION_QUEUE : undefined),
    executor,
    ledger,
    model,
    modelRoute: env.AI_MODEL_ID,
    toolsBudget: 12,
    createShardReviewer,
    telemetry,
    workflow: runtime.workflow ?? env.REVIEW_WORKFLOW,
    getAccumulatedUsage: () => ({
      inputTokens: inputTokens + identificationInputTokens,
      outputTokens: outputTokens + identificationOutputTokens,
      toolCallsCount,
    }),
    createMutationContext: mutationContext,
    reconcileCheckRun: runtime.reconcileCheckRun
      ? (runId) => runtime.reconcileCheckRun!(runId, createSession)
      : (runId) => ledger.reconcileCheckRun(runId),
    createSession: async () => await createSession(),
    ensureContext,
    loadContext: async () =>
      reviewContextSchema.parse(await executor.loadContext(job.runId)),
    useProjectIdentification: (result) => {
      identificationInputTokens = result.usage?.inputTokens ?? 0;
      identificationOutputTokens = result.usage?.outputTokens ?? 0;
      if (shouldEnrichProjects(env.PROJECT_IDENTIFICATION_MODE))
        projectIdentification = result;
    },
    getProjectIdentification: () => projectIdentification,
    identifyProjects: async (
      policy,
      input,
      discoveryOnly = false,
      deadlineAt = Date.now() + 120000,
    ) => {
      const unavailable = (reason: string): ProjectIdentificationResult => ({
        snapshotSha: job.envelope.pullRequest.headSha,
        inventoryDigest: "0".repeat(64),
        detectorRevision,
        projects: [],
        status: "unavailable",
        limitations: [reason],
      });
      const cacheName = await env.PROJECT_IDENTIFICATION_REGISTRY.getByName(
        String(job.envelope.installationId),
      ).register(job.envelope.installationId, job.envelope.repository.id);
      if (!cacheName) return unavailable("access-revoked");
      if (!input && !(await executor.hasContext(job.runId)))
        await prepareRepository(1, policy);
      const request: ProjectMetadataRequest = {
        runId: job.runId,
        installationId: job.envelope.installationId,
        repositoryId: job.envelope.repository.id,
        snapshotSha: job.envelope.pullRequest.headSha,
        policyDigest: policy.effectivePolicyDigest,
        modelRevision:
          env.AI_MODEL_ID +
          ":" +
          detectorRevision +
          ":" +
          env.PROJECT_IDENTIFICATION_PROFILE,
        mode: "affected",
        deadlineAt,
      };
      let result: ProjectIdentificationResult;
      try {
        result =
          input ??
          projectIdentificationResultSchema.parse(
            await executor.discoverProjectMetadata(request),
          );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("PROJECT_METADATA_AUTHORITY")
        )
          throw error;
        return unavailable("metadata-unavailable");
      }
      if (!input && result.metadataChanged) {
        try {
          const base = projectIdentificationResultSchema.parse(
            await executor.discoverProjectMetadata({
              ...request,
              snapshotSha: job.envelope.pullRequest.baseSha,
            }),
          );
          result = {
            ...result,
            baseline: {
              snapshotSha: base.snapshotSha,
              projects: base.projects,
              status: base.status === "complete" ? "complete" : "partial",
              limitations: base.limitations,
            },
          };
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("PROJECT_METADATA_AUTHORITY")
          )
            throw error;
          result = {
            ...result,
            baseline: {
              snapshotSha: job.envelope.pullRequest.baseSha,
              projects: [],
              status: "unavailable",
              limitations: ["base-metadata-unavailable"],
            },
          };
        }
      }
      if (discoveryOnly) return result;
      const usage = { inputTokens: 0, outputTokens: 0, modelCalls: 0 };
      const cache = env.PROJECT_IDENTIFICATION_CACHE.getByName(cacheName);
      const identificationModel =
        runtime.identificationModel ??
        new GatewayProjectIdentificationModel(
          {
            accountId: env.AI_GATEWAY_ACCOUNT_ID,
            apiToken: env.AI_GATEWAY_API_TOKEN,
            gatewayId: env.AI_GATEWAY_ID,
            model: env.AI_MODEL_ID,
          },
          (consumedInput, output) => {
            usage.inputTokens += consumedInput;
            usage.outputTokens += output;
          },
        );
      let interpreted: ProjectIdentificationResult;
      try {
        interpreted = await interpretProjects(result, {
          cache,
          owner: job.runId,
          model: identificationModel,
          deadlineAt,
          onAttempt: () => {
            usage.modelCalls++;
          },
        });
      } catch {
        interpreted = {
          ...result,
          status: "partial",
          limitations: [
            ...result.limitations,
            "identification-cache-unavailable",
          ],
        };
      }
      return { ...interpreted, usage };
    },
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
      return await executeGitHubOperation(
        async () => {
          return await github.currentPullRequestRefs(
            job.envelope.repository.owner,
            job.envelope.repository.name,
            job.envelope.pullRequest.number,
          );
        },
        Date.now,
        {
          context: {
            operation: "github.pull_request_refs",
            runId: job.runId,
            repositoryId: job.envelope.repository.id,
            pullRequestNumber: job.envelope.pullRequest.number,
            installationId: job.envelope.installationId,
          },
        },
      );
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
