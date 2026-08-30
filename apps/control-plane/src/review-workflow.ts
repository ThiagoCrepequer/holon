import {
  ExecuteReview,
  createReviewRun,
  publishOnce,
  renderFinding,
  selectValidFindings,
  type ModelReviewer,
  type ReviewLedger,
  type ReviewPublisher,
} from "@holon/application";
import {
  executorRequestSchema,
  modelReviewOutputSchema,
  repositoryToolResultSchema,
  preparedRepositorySchema,
  reviewContextSchema,
  reviewJobSchema,
  type ExecutorRequest,
  type RepositoryToolCall,
  type RepositoryToolResult,
  type PreparedRepository,
  type ReviewContext,
  type ReviewJob,
} from "@holon/contracts";
import {
  classifyFindingPublication,
  createFindingId,
  createPrKey,
  type RunId,
  type RunState,
} from "@holon/domain";
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
  isNonRetryableModelError,
} from "@holon/model";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import {
  consoleLogger,
  errorKind,
  type StructuredLogger,
} from "./observability.js";

export interface RepositoryExecutorBinding {
  cleanup(runId: string): Promise<void>;
  hasContext(runId: string): Promise<boolean>;
  loadContext(runId: string): Promise<ReviewContext>;
  prepare(
    request: ExecutorRequest,
    installationToken: string,
  ): Promise<PreparedRepository>;
  runTool(
    runId: string,
    call: RepositoryToolCall,
  ): Promise<RepositoryToolResult>;
}

export interface ReviewRuntime {
  readonly createModel?: (
    toolRunner: ReturnType<typeof createBoundedRepositoryToolRunner>,
  ) => ModelReviewer;
  readonly createSession?: (
    installationId: number,
  ) => Promise<GitHubInstallationSession>;
  readonly executor?: RepositoryExecutorBinding;
  readonly logger?: StructuredLogger;
  readonly milliseconds?: () => number;
  readonly now?: () => string;
}

export function parseAppId(value: string): number {
  const appId = Number(value);
  if (!Number.isSafeInteger(appId) || appId <= 0)
    throw new TypeError("GITHUB_APP_ID must be a positive integer");
  return appId;
}

export class ReviewWorkflow extends WorkflowEntrypoint<
  Cloudflare.Env,
  ReviewJob
> {
  public override async run(
    event: Readonly<WorkflowEvent<ReviewJob>>,
    step: WorkflowStep,
  ) {
    return await executeReviewWorkflow(this.env, event, step);
  }
}

function prKeyFor(job: ReviewJob) {
  return createPrKey({
    provider: "github",
    pullRequestNumber: job.envelope.pullRequest.number,
    repositoryId: job.envelope.repository.id,
  });
}

interface WorkflowLedger extends ReviewLedger {
  markTerminal(runId: RunId, occurredAt: string): boolean | Promise<boolean>;
  runState(runId: RunId): Promise<RunState | undefined> | RunState | undefined;
}

interface ReviewServices {
  readonly executor: RepositoryExecutorBinding;
  readonly ledger: WorkflowLedger;
  readonly loadContext: () => Promise<ReviewContext>;
  readonly model: ModelReviewer;
  readonly prepareRepository: () => Promise<PreparedRepository>;
  readonly publisher: ReviewPublisher;
  readonly readCurrentHead: () => Promise<string>;
}

function createReviewServices(
  env: Cloudflare.Env,
  job: ReviewJob,
  runtime: ReviewRuntime,
  logger: StructuredLogger,
  logContext: Record<string, number | string>,
): ReviewServices {
  const executor =
    runtime.executor ??
    (env.REPOSITORY_EXECUTOR as unknown as RepositoryExecutorBinding);
  const ledger = env.REVIEW_LEDGERS.getByName(
    prKeyFor(job),
  ) as unknown as WorkflowLedger;
  let sessionPromise: Promise<GitHubInstallationSession> | undefined;
  const session = () => {
    sessionPromise ??=
      runtime.createSession?.(job.envelope.installationId) ??
      createInstallationSession(
        {
          appId: parseAppId(env.GITHUB_APP_ID),
          privateKey: env.GITHUB_APP_PRIVATE_KEY,
        },
        job.envelope.installationId,
      );
    return sessionPromise;
  };
  const prepareRepository = async () => {
    const github = await session();
    const request = executorRequestSchema.parse({
      baseSha: job.envelope.pullRequest.baseSha,
      cloneUrl: `https://github.com/${job.envelope.repository.fullName}.git`,
      headSha: job.envelope.pullRequest.headSha,
      pullRequestNumber: job.envelope.pullRequest.number,
      repositoryId: job.envelope.repository.id,
      runId: job.runId,
      schemaVersion: 1,
    });
    return preparedRepositorySchema.parse(
      await executor.prepare(request, github.token),
    );
  };
  const toolRunner = createBoundedRepositoryToolRunner(
    createRedactingRepositoryToolRunner({
      run: async (call) => {
        if (!(await executor.hasContext(job.runId))) {
          await prepareRepository();
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
          model: env.AI_MODEL_ID,
        },
        toolRunner,
        (usage) => logger.emit("model.usage", { ...logContext, ...usage }),
      ),
    );
  const githubPublisher = async () => {
    const github = await session();
    return new GitHubReviewPublisher(github.api, {
      headSha: job.envelope.pullRequest.headSha,
      owner: job.envelope.repository.owner,
      pullNumber: job.envelope.pullRequest.number,
      repo: job.envelope.repository.name,
    });
  };
  const publisher: ReviewPublisher = {
    findCommentByMarker: async (marker) =>
      (await githubPublisher()).findCommentByMarker(marker),
    publish: async (input) => (await githubPublisher()).publish(input),
  };
  return {
    executor,
    ledger,
    loadContext: async () =>
      reviewContextSchema.parse(await executor.loadContext(job.runId)),
    model,
    prepareRepository,
    publisher,
    readCurrentHead: async () => {
      const github = await session();
      return await github.currentHeadSha(
        job.envelope.repository.owner,
        job.envelope.repository.name,
        job.envelope.pullRequest.number,
      );
    },
  };
}

const stateStep = {
  retries: { backoff: "exponential", delay: "1 second", limit: 3 },
  timeout: "30 seconds",
} as const;
const repositoryStep = {
  retries: { backoff: "exponential", delay: "5 seconds", limit: 1 },
  timeout: "2 minutes",
} as const;
const modelStep = {
  retries: { backoff: "exponential", delay: "10 seconds", limit: 2 },
  sensitive: "output",
  timeout: "10 minutes",
} as const;
const publicationStep = {
  retries: { backoff: "exponential", delay: "5 seconds", limit: 4 },
  timeout: "2 minutes",
} as const;

function isRetryableRepositoryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "RepositoryTransientError" ||
    error.message.includes("HOLON_REPOSITORY_TRANSIENT:")
  );
}

export async function executeReviewWorkflow(
  env: Cloudflare.Env,
  rawEvent: Readonly<WorkflowEvent<ReviewJob>>,
  step: WorkflowStep,
  runtime: ReviewRuntime = {},
) {
  const job = reviewJobSchema.parse(rawEvent.payload);
  const workflowInstanceId = rawEvent.instanceId;
  const logger = runtime.logger ?? consoleLogger;
  const milliseconds = runtime.milliseconds ?? Date.now;
  const now = runtime.now ?? (() => new Date().toISOString());
  const startedAt = milliseconds();
  const logContext = {
    pullRequestNumber: job.envelope.pullRequest.number,
    repositoryId: job.envelope.repository.id,
    runId: job.runId,
    workflowInstanceId,
  };
  const services = createReviewServices(env, job, runtime, logger, logContext);
  const run = createReviewRun(job);
  let repositoryStarted = false;
  logger.emit("review.started", logContext);

  const moveTo = async (
    stepName: string,
    expected: RunState,
    next: RunState,
  ): Promise<void> => {
    await step.do(stepName, stateStep, async () => {
      const current = await services.ledger.runState(run.id);
      if (current === next) return;
      if (current !== expected) {
        throw new Error(
          `Review run cannot execute ${stepName} from ${current ?? "missing"}`,
        );
      }
      await services.ledger.transition(
        run.id,
        expected,
        next,
        now(),
        `${workflowInstanceId}:${stepName}`,
      );
    });
  };

  try {
    const claim = await step.do("claim-run", stateStep, () =>
      services.ledger.claimRun(run, workflowInstanceId),
    );
    if (claim === "duplicate") {
      return { findingsPublished: 0, outcome: "duplicate" } as const;
    }

    await step.do("start-run", stateStep, async () => {
      const current = await services.ledger.runState(run.id);
      if (current === "running" || current === "publishing") return;
      if (current !== "queued" && current !== "failed_retryable") {
        throw new Error(`Review run cannot start from ${current ?? "missing"}`);
      }
      await services.ledger.transition(
        run.id,
        current,
        "running",
        now(),
        `${workflowInstanceId}:start-run:${current}`,
      );
    });

    repositoryStarted = true;
    const preparation = await step.do(
      "prepare-repository",
      repositoryStep,
      async () => {
        try {
          await services.prepareRepository();
          return { status: "prepared" } as const;
        } catch (error) {
          if (isRetryableRepositoryError(error)) throw error;
          return { errorKind: errorKind(error), status: "failed" } as const;
        }
      },
    );
    if (preparation.status === "failed") {
      throw new Error(
        `Repository preparation failed (${preparation.errorKind})`,
      );
    }

    const output = await step.do("analyze-review", modelStep, async () => {
      try {
        if (!(await services.executor.hasContext(job.runId))) {
          await services.prepareRepository();
        }
        const context = await services.loadContext();
        const modelOutput = modelReviewOutputSchema.parse(
          await services.model.review(job, context),
        );
        return modelReviewOutputSchema.parse({
          ...modelOutput,
          findings: selectValidFindings(
            modelOutput.findings,
            context.changedLines,
          ),
        });
      } catch (error) {
        if (isNonRetryableModelError(error)) {
          throw new NonRetryableError(
            "HOLON_MODEL_NON_RETRYABLE",
            "ModelNonRetryableError",
          );
        }
        throw error;
      }
    });

    await moveTo("begin-publication", "running", "publishing");
    const isCurrent = await step.do(
      "revalidate-current-head",
      publicationStep,
      async () =>
        (await services.ledger.isLatestRun(run.id)) &&
        (await services.readCurrentHead()) === job.envelope.pullRequest.headSha,
    );
    if (!isCurrent) {
      await moveTo("mark-obsolete", "publishing", "obsolete");
      await step.do("cleanup-obsolete-repository", repositoryStep, () =>
        services.executor.cleanup(job.runId),
      );
      logger.emit("review.completed", {
        ...logContext,
        durationMs: Math.max(0, milliseconds() - startedAt),
        findingsPublished: 0,
        outcome: "obsolete",
      });
      return { findingsPublished: 0, outcome: "obsolete" } as const;
    }

    let findingsPublished = 0;
    for (const [index, finding] of output.findings.entries()) {
      if (classifyFindingPublication(finding) !== "inline") continue;
      const published = await step.do(
        `publish-inline-${index + 1}`,
        publicationStep,
        async () => {
          const findingId = await createFindingId(run.id, {
            diagnostic: finding.diagnostic,
            endLine: finding.location.line,
            path: finding.location.path,
            startLine: finding.location.startLine ?? finding.location.line,
          });
          return await publishOnce(
            services.ledger,
            services.publisher,
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
        },
      );
      if (published) findingsPublished += 1;
    }
    await step.do("publish-summary", publicationStep, () =>
      publishOnce(
        services.ledger,
        services.publisher,
        run.id,
        "summary",
        "summary",
        output.summary,
        {},
      ),
    );
    await moveTo("complete-run", "publishing", "completed");
    await step.do("cleanup-completed-repository", repositoryStep, () =>
      services.executor.cleanup(job.runId),
    );
    const result = { findingsPublished, outcome: "completed" } as const;
    logger.emit("review.completed", {
      ...logContext,
      durationMs: Math.max(0, milliseconds() - startedAt),
      ...result,
    });
    return result;
  } catch (error) {
    logger.emit("review.failed", {
      ...logContext,
      durationMs: Math.max(0, milliseconds() - startedAt),
      errorKind: errorKind(error),
    });
    try {
      await step.do("mark-review-terminal", stateStep, () =>
        Promise.resolve(services.ledger.markTerminal(run.id, now())),
      );
    } catch (terminalError) {
      logger.emit("review.terminalization_failed", {
        ...logContext,
        errorKind: errorKind(terminalError),
      });
    }
    if (repositoryStarted) {
      try {
        await step.do("cleanup-failed-repository", repositoryStep, () =>
          services.executor.cleanup(job.runId),
        );
      } catch (cleanupError) {
        logger.emit("review.cleanup_failed", {
          ...logContext,
          errorKind: errorKind(cleanupError),
        });
      }
    }
    throw error;
  }
}

export async function markReviewTerminal(
  env: Cloudflare.Env,
  job: ReviewJob,
  now = () => new Date().toISOString(),
) {
  const ledger = env.REVIEW_LEDGERS.getByName(
    prKeyFor(job),
  ) as unknown as WorkflowLedger;
  await ledger.markTerminal(job.runId as RunId, now());
}

export async function executeReviewJob(
  env: Cloudflare.Env,
  job: ReviewJob,
  runtime: ReviewRuntime = {},
) {
  const logger = runtime.logger ?? consoleLogger;
  const milliseconds = runtime.milliseconds ?? Date.now;
  const startedAt = milliseconds();
  const logContext = {
    pullRequestNumber: job.envelope.pullRequest.number,
    repositoryId: job.envelope.repository.id,
    runId: job.runId,
  };
  logger.emit("review.started", logContext);
  const services = createReviewServices(env, job, runtime, logger, logContext);
  let prepared = false;
  const repository = {
    loadContext: async () => {
      prepared = true;
      await services.prepareRepository();
      return services.loadContext();
    },
  };
  const useCase = new ExecuteReview({
    clock: { now: runtime.now ?? (() => new Date().toISOString()) },
    ledger: services.ledger,
    model: services.model,
    publisher: services.publisher,
    pullRequest: {
      currentHeadSha: services.readCurrentHead,
    },
    repository,
  });
  try {
    const result = await useCase.execute(job, job.envelope.deliveryId);
    logger.emit("review.completed", {
      ...logContext,
      durationMs: Math.max(0, milliseconds() - startedAt),
      findingsPublished: result.findingsPublished,
      outcome: result.outcome,
    });
    return result;
  } catch (error) {
    logger.emit("review.failed", {
      ...logContext,
      durationMs: Math.max(0, milliseconds() - startedAt),
      errorKind: errorKind(error),
    });
    throw error;
  } finally {
    if (prepared) await services.executor.cleanup(job.runId);
  }
}
