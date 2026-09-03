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
  executorRequestV1Schema,
  executorRequestV2Schema,
  preparedRepositoryV1Schema,
  preparedRepositoryV2Schema,
  repositoryToolResultSchema,
  reviewContextV1Schema,
  reviewContextV2Schema,
  type ExecutorRequestV1,
  type ExecutorRequestV2,
  type GitHubCredentialRequest,
  type PreparedRepositoryV2,
  type RepositoryToolCall,
  type RepositoryToolResult,
  type ReviewContextV2,
  type ReviewJob,
} from "@holon/contracts";
import { createPrKey, type RunId, type RunState } from "@holon/domain";
import {
  createInstallationSession,
  GitHubReviewPublisher,
  type GitHubInstallationSession,
} from "@holon/github";
import {
  AiSdkReviewGenerator,
  GatewayModelReviewer,
  createBoundedRepositoryToolRunner,
  createRedactingRepositoryToolRunner,
} from "@holon/model";
import {
  classifyPullRequestDiffFile,
  isNonBinaryPullRequestPatch,
  splitPullRequestDiff,
} from "@holon/repository-analysis";
import { NonRetryableError } from "cloudflare:workflows";

import type { PublicationLedger } from "./authorized-publication.js";
import { createExpectedContainerId, parseAppId } from "./credential-broker.js";
import {
  executeGitHubOperation,
  GitHubTransientError,
} from "./github-operations.js";
import { errorKind, type StructuredLogger } from "./observability.js";
import {
  AnalyticsEngineTelemetryEmitter,
  CompositeTelemetryEmitter,
  StructuredLogTelemetryEmitter,
  type AnalyticsEngineDatasetLike,
} from "./telemetry-emitter.js";

export interface RepositoryExecutorBinding {
  cleanup(runId: string): Promise<void>;
  hasContext(runId: string): Promise<boolean>;
  loadContext?(runId: string): Promise<unknown>;
  loadContextV2?(runId: string): Promise<ReviewContextV2>;
  prepare?(
    request: ExecutorRequestV1,
    installationToken: string,
  ): Promise<unknown>;
  prepareRepositoryV2?(
    request: ExecutorRequestV2,
  ): Promise<PreparedRepositoryV2>;
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
  readonly createModel?: (
    toolRunner: ReturnType<typeof createBoundedRepositoryToolRunner>,
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
}

export interface GitHubMutationContext {
  readonly publisher: ReviewPublisher;
  readCurrentHead(): Promise<string>;
}

export interface ReviewServices {
  readonly executor: RepositoryExecutorBinding;
  readonly ledger: WorkflowLedger;
  readonly model: ModelReviewer;
  readonly telemetry: TelemetryEmitter;
  getAccumulatedUsage(): {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly toolCallsCount: number;
  };
  createMutationContext(): Promise<GitHubMutationContext>;
  ensureContext(maximumPreparationAttempts: number): Promise<void>;
  loadContext(): Promise<ReviewContextV2>;
  prepareRepository(maximumAttempts: number): Promise<PreparedRepositoryV2>;
  readCurrentHead(): Promise<string>;
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
  public constructor(reason: "executor" | "repository") {
    super(`HOLON_REPOSITORY_TRANSIENT:${reason}`);
    this.name = "RepositoryTransientError";
  }
}

type ExecutorV2Method =
  | "loadContextV2"
  | "prepareRepositoryV2"
  | "resolveContainerId";

export function isExecutorRpcMethodUnavailable(
  error: unknown,
  method: ExecutorV2Method,
): boolean {
  return (
    error instanceof TypeError &&
    error.message ===
      `The RPC receiver does not implement the method "${method}".`
  );
}

function legacyContextAsV2(rawContext: unknown): ReviewContextV2 {
  const context = reviewContextV1Schema.parse(rawContext);
  const files = splitPullRequestDiff(context.diff).flatMap((file) => {
    const mode = classifyPullRequestDiffFile(file);
    return mode === undefined || !isNonBinaryPullRequestPatch(file.patch)
      ? []
      : [{ mode, patch: file.patch, path: file.path }];
  });
  return reviewContextV2Schema.parse({
    changedLines: context.changedLines,
    files,
    schemaVersion: 2,
    ...(context.surface === undefined ? {} : { surface: context.surface }),
    truncated: context.truncated ?? false,
  });
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
  const executor: RepositoryExecutorBinding =
    runtime.executor ?? env.REPOSITORY_EXECUTOR;
  const ledger: WorkflowLedger = env.REVIEW_LEDGERS.getByName(prKeyFor(job));
  const wait = runtime.wait ?? ((delay) => scheduler.wait(delay));
  const createSession = async () =>
    await executeGitHubOperation(
      async () =>
        await (runtime.createSession?.(
          job.envelope.installationId,
          job.envelope.repository.id,
        ) ??
          createInstallationSession(
            {
              appId: parseAppId(env.GITHUB_APP_ID),
              appSlug: env.GITHUB_APP_SLUG,
              privateKey: env.GITHUB_APP_PRIVATE_KEY,
            },
            job.envelope.installationId,
            job.envelope.repository.id,
          )),
    );

  const resolveCredentialContainerId = async (): Promise<string> => {
    try {
      if (executor.resolveContainerId === undefined) {
        throw new TypeError(
          'The RPC receiver does not implement the method "resolveContainerId".',
        );
      }
      const containerId = await executor.resolveContainerId(job.runId);
      if (!/^[a-f0-9]{64}$/u.test(containerId)) {
        throw new TypeError("Executor returned an invalid container ID");
      }
      return containerId;
    } catch (error) {
      if (!isExecutorRpcMethodUnavailable(error, "resolveContainerId")) {
        throw error;
      }
      // Rollout bridge for an N-1 executor. That version still receives the
      // installation token directly and does not consult the credential scope.
      return createExpectedContainerId(job.runId);
    }
  };

  const prepareOnce = async (): Promise<PreparedRepositoryV2> => {
    try {
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
      const request = executorRequestV2Schema.parse({
        ...commonRequest,
        installationId: job.envelope.installationId,
        repositoryName: job.envelope.repository.name,
        repositoryOwner: job.envelope.repository.owner,
        schemaVersion: 2,
      });
      let prepared: unknown;
      try {
        if (executor.prepareRepositoryV2 === undefined) {
          throw new TypeError(
            'The RPC receiver does not implement the method "prepareRepositoryV2".',
          );
        }
        prepared = await executor.prepareRepositoryV2(request);
      } catch (error) {
        if (!isExecutorRpcMethodUnavailable(error, "prepareRepositoryV2")) {
          throw error;
        }
        if (executor.prepare === undefined) {
          throw new RepositoryTransientError("executor");
        }
        // Rollout-only bridge: the installation token exists only in this
        // call frame and is never stored or forwarded to the sandbox by the
        // dual-stack executor. Functional v2 failures never enter this path.
        const legacyRequest = executorRequestV1Schema.parse({
          ...commonRequest,
          schemaVersion: 1,
        });
        const legacy = preparedRepositoryV1Schema.parse(
          await executor.prepare(legacyRequest, github.token),
        );
        return preparedRepositoryV2Schema.parse({
          ...legacy,
          schemaVersion: 2,
        });
      }
      return preparedRepositoryV2Schema.parse(prepared);
    } catch (error) {
      return normalizeRepositoryFailure(error, logger, logContext);
    }
  };

  const prepareRepository = async (
    maximumAttempts: number,
  ): Promise<PreparedRepositoryV2> => {
    if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts <= 0) {
      throw new TypeError("maximumAttempts must be a positive safe integer");
    }
    let lastError: unknown;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        return await prepareOnce();
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

  const toolRunner = createBoundedRepositoryToolRunner(
    createRedactingRepositoryToolRunner({
      run: async (call) => {
        toolCallsCount += 1;
        if (!(await executor.hasContext(job.runId))) {
          await prepareRepository(2);
        }
        return repositoryToolResultSchema.parse(
          await executor.runTool(job.runId, call),
        );
      },
    }),
    12,
  );
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
        (usage) => {
          inputTokens += usage.inputTokens ?? 0;
          outputTokens += usage.outputTokens ?? 0;
          logger.emit("model.usage", { ...logContext, ...usage });
        },
      ),
    );

  const telemetry =
    runtime.telemetry ??
    new CompositeTelemetryEmitter([
      new AnalyticsEngineTelemetryEmitter(
        (
          env as unknown as {
            ANALYTICS_ENGINE?: AnalyticsEngineDatasetLike;
          }
        ).ANALYTICS_ENGINE,
      ),
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
    };
  };

  return {
    executor,
    ledger,
    model,
    telemetry,
    getAccumulatedUsage: () => ({
      inputTokens,
      outputTokens,
      toolCallsCount,
    }),
    createMutationContext: mutationContext,
    ensureContext: async (maximumPreparationAttempts) => {
      if (!(await executor.hasContext(job.runId))) {
        await prepareRepository(maximumPreparationAttempts);
      }
    },
    loadContext: async () => {
      try {
        if (executor.loadContextV2 === undefined) {
          throw new TypeError(
            'The RPC receiver does not implement the method "loadContextV2".',
          );
        }
        const loaded = await executor.loadContextV2(job.runId);
        return reviewContextV2Schema.parse(loaded);
      } catch (error) {
        if (!isExecutorRpcMethodUnavailable(error, "loadContextV2")) {
          throw error;
        }
        if (executor.loadContext === undefined) {
          throw new RepositoryTransientError("executor");
        }
        return legacyContextAsV2(await executor.loadContext(job.runId));
      }
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
