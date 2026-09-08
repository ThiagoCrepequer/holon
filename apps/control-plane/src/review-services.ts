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
  projectIdentificationResultV1Schema,
  type ProjectIdentificationResultV1,
  type ProjectMetadataRequestV1,
} from "@holon/contracts";
import {
  executorRequestV3Schema,
  preparedRepositoryV3Schema,
  repositoryToolResultSchema,
  reviewContextV3Schema,
  type AdminRunProjectionEventV1,
  type ExecutorRequestV3,
  type GitHubCredentialRequest,
  type PreparedRepositoryV3,
  type RepositoryPolicy,
  type RepositoryToolCall,
  type RepositoryToolResult,
  type ReviewContextV3,
  type ReviewJob,
  type RunClaimV2Result,
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
import { createDefaultRepositoryPolicy } from "./repository-policy-resolver.js";
import {
  AnalyticsEngineTelemetryEmitter,
  CompositeTelemetryEmitter,
  StructuredLogTelemetryEmitter,
} from "./telemetry-emitter.js";
import type { WorkflowController } from "./workflow-superseding.js";

export interface RepositoryExecutorBinding {
  discoverProjectMetadataV1?(
    request: ProjectMetadataRequestV1,
  ): Promise<ProjectIdentificationResultV1>;
  cleanup(runId: string): Promise<void>;
  hasContext(runId: string): Promise<boolean>;
  loadContextV3?(runId: string): Promise<ReviewContextV3>;
  prepareRepositoryV3?(
    request: ExecutorRequestV3,
  ): Promise<PreparedRepositoryV3>;
  resolveContainerId?(runId: string): Promise<string> | string;
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
    result: ProjectIdentificationResultV1,
  ): Promise<void>;
  claimRunV2(
    run: Parameters<PublicationLedger["claimRun"]>[0],
    workflowInstanceId: string,
    causalVersion?: string,
  ): Promise<RunClaimV2Result>;
  completeWorkflowSupersession(
    runId: RunId,
    completedAt: string,
  ): Promise<void>;
  claimRun(
    run: Parameters<PublicationLedger["claimRun"]>[0],
    workflowInstanceId: string,
    causalVersion?: string,
  ): ReturnType<PublicationLedger["claimRun"]>;
  markTerminalAndRequestCleanup(
    runId: RunId,
    occurredAt: string,
    requiresCleanup: boolean,
  ): Promise<boolean>;
  recordProjectionTask(event: AdminRunProjectionEventV1): Promise<void>;
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
  beginReviewShard?(index: number, totalShards: number): void;
  reviewToolBudgetExceeded?(): boolean;
  useProjectIdentification?(result: ProjectIdentificationResultV1): void;
  getProjectIdentification?(): ProjectIdentificationResultV1 | undefined;
  identifyProjects?(
    policy: RepositoryPolicy,
    input?: ProjectIdentificationResultV1,
    discoveryOnly?: boolean,
    deadlineAt?: number,
  ): Promise<ProjectIdentificationResultV1 | null>;
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
  createMutationContext(): Promise<GitHubMutationContext>;
  createSession(): Promise<GitHubInstallationSession>;
  ensureContext(
    maximumPreparationAttempts: number,
    effectivePolicy?: RepositoryPolicy,
  ): Promise<void>;
  loadContext(effectivePolicy?: RepositoryPolicy): Promise<ReviewContextV3>;
  prepareRepository(
    maximumAttempts: number,
    effectivePolicy?: RepositoryPolicy,
  ): Promise<PreparedRepositoryV3>;
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
        reason: error.message.slice(0, 100),
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
        reason: error.message.slice(0, 100),
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
  let projectIdentification: ProjectIdentificationResultV1 | undefined;
  let identificationInputTokens = 0,
    identificationOutputTokens = 0;
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
    });

  const resolveCredentialContainerId = async (): Promise<string> => {
    const containerId = await executor.resolveContainerId!(job.runId);
    if (!/^[a-f0-9]{64}$/u.test(containerId)) {
      throw new TypeError("Executor returned an invalid container ID");
    }
    return containerId;
  };

  const prepareOnce = async (
    policy?: RepositoryPolicy,
  ): Promise<PreparedRepositoryV3> => {
    try {
      const effectivePolicy =
        policy ??
        (await createDefaultRepositoryPolicy(job.envelope.pullRequest.baseSha));

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

      const requestV3 = executorRequestV3Schema.parse({
        ...commonRequest,
        effectivePolicy,
        installationId: job.envelope.installationId,
        repositoryName: job.envelope.repository.name,
        repositoryOwner: job.envelope.repository.owner,
        schemaVersion: 3,
      });

      return preparedRepositoryV3Schema.parse(
        await executor.prepareRepositoryV3!(requestV3),
      );
    } catch (error) {
      return normalizeRepositoryFailure(error, logger, logContext);
    }
  };

  const prepareRepository = async (
    maximumAttempts: number,
    policy?: RepositoryPolicy,
  ): Promise<PreparedRepositoryV3> => {
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
  let shardIndex = 0;
  let shardCount = 1;
  let currentAnalysisPolicy: RepositoryPolicy | undefined;

  const toolBudget = createPartitionedRepositoryToolRunner(
    createRedactingRepositoryToolRunner({
      run: async (call) => {
        if (
          !(await ledger.reserveAnalysisToolCall(
            job.runId,
            shardIndex,
            shardCount,
          ))
        )
          throw new RepositoryToolBudgetExceededError(12);
        toolCallsCount += 1;
        if (!(await executor.hasContext(job.runId))) {
          await prepareRepository(2, currentAnalysisPolicy);
        }
        return repositoryToolResultSchema.parse(
          await executor.runTool(job.runId, call),
        );
      },
    }),
    12,
  );
  const toolRunner = toolBudget.runner;
  const model =
    runtime.createModel?.(toolRunner) ??
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
            schema_version: String(job.schemaVersion),
            stage: "review",
          },
          model: env.AI_MODEL_ID,
        },
        toolRunner,
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
      ),
    );

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
          if (typeof github.currentPullRequestRefs === "function") {
            return await github.currentPullRequestRefs(
              job.envelope.repository.owner,
              job.envelope.repository.name,
              job.envelope.pullRequest.number,
            );
          }
          const headSha = await github.currentHeadSha(
            job.envelope.repository.owner,
            job.envelope.repository.name,
            job.envelope.pullRequest.number,
          );
          return {
            baseSha: job.envelope.pullRequest.baseSha,
            headSha,
          };
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
    beginReviewShard: (index, totalShards) => {
      shardIndex = index;
      shardCount = totalShards;
      toolBudget.beginShard(index, totalShards);
    },
    reviewToolBudgetExceeded: () => toolBudget.exceeded(),
    telemetry,
    workflow: runtime.workflow ?? env.REVIEW_WORKFLOW,
    getAccumulatedUsage: () => ({
      inputTokens: inputTokens + identificationInputTokens,
      outputTokens: outputTokens + identificationOutputTokens,
      toolCallsCount,
    }),
    createMutationContext: mutationContext,
    createSession: async () => await createSession(),
    ensureContext: async (maximumPreparationAttempts, effectivePolicy) => {
      currentAnalysisPolicy = effectivePolicy;
      if (!(await executor.hasContext(job.runId))) {
        await prepareRepository(maximumPreparationAttempts, effectivePolicy);
      }
    },
    loadContext: async (effectivePolicy) => {
      currentAnalysisPolicy = effectivePolicy;
      return reviewContextV3Schema.parse(
        await executor.loadContextV3!(job.runId),
      );
    },
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
      const unavailable = (reason: string): ProjectIdentificationResultV1 => ({
        schemaVersion: 1,
        snapshotSha: job.envelope.pullRequest.headSha,
        inventoryDigest: "0".repeat(64),
        detectorRevision,
        projects: [],
        status: "unavailable",
        limitations: [reason],
      });
      if (!executor.discoverProjectMetadataV1)
        return unavailable("executor-capability-unavailable");
      const cacheName = await env.PROJECT_IDENTIFICATION_REGISTRY.getByName(
        String(job.envelope.installationId),
      ).register(job.envelope.installationId, job.envelope.repository.id);
      if (!cacheName) return unavailable("access-revoked");
      if (!input && !(await executor.hasContext(job.runId)))
        await prepareRepository(1, policy);
      const request: ProjectMetadataRequestV1 = {
        schemaVersion: 1,
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
      let result: ProjectIdentificationResultV1;
      try {
        result =
          input ??
          projectIdentificationResultV1Schema.parse(
            await executor.discoverProjectMetadataV1(request),
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
          const base = projectIdentificationResultV1Schema.parse(
            await executor.discoverProjectMetadataV1({
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
      let interpreted: ProjectIdentificationResultV1;
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
      return await executeGitHubOperation(async () => {
        if (typeof github.currentPullRequestRefs === "function") {
          return await github.currentPullRequestRefs(
            job.envelope.repository.owner,
            job.envelope.repository.name,
            job.envelope.pullRequest.number,
          );
        }
        const headSha = await github.currentHeadSha(
          job.envelope.repository.owner,
          job.envelope.repository.name,
          job.envelope.pullRequest.number,
        );
        return {
          baseSha: job.envelope.pullRequest.baseSha,
          headSha,
        };
      });
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
