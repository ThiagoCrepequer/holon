import {
  createReviewRun,
  determineCheckRunConclusion,
  formatCheckRunOutput,
  renderFinding,
} from "@holon/application";
import {
  buildAdminProjectionEvent,
  buildReviewAnalysisCheckpoint,
  reviewAnalysisCheckpointSchema,
  runClaimResultSchema,
  reviewJobSchema,
  type AdminRunProjectionPayload,
  type CheckRunConclusion,
  type CheckRunOutput,
  type RepositoryPolicy,
  type ReviewJob,
  type ReviewPhaseReached,
  type RunTelemetry,
  type StepPhase,
  type StepTiming,
} from "@holon/contracts";
import {
  RepositoryPolicyConflictError,
  RepositoryPolicySchemaError,
  RepositoryPolicyScopeError,
  RepositoryPolicySecurityError,
  RepositoryPolicySyntaxError,
  appendCiEvidenceToSummary,
  calculateInferenceCost,
  classifyFindingPublication,
  createFindingId,
  createPrKey,
  evaluateRunSlo,
  type RunState,
  type RunId,
} from "@holon/domain";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import {
  isReviewMutationNotAuthorizedError,
  publishAuthorized,
  publishResolutionAuthorized,
  publishFailureNoticeAuthorized,
} from "./authorized-publication.js";
import { consoleLogger, errorKind } from "./observability.js";
import { resolveRepositoryPolicy } from "./repository-policy-resolver.js";
import { analyzeReview } from "./review-analysis.js";
import { loadReviewWithCurrentFeedback } from "./review-feedback-refresh.js";
import {
  createReviewServices,
  type GitHubMutationContext,
  type ReviewRuntime,
  type ReviewServices,
  type WorkflowLedger,
} from "./review-services.js";
import {
  causalVersionForJob,
  durationFrom,
  eventId,
  modelStep,
  publicationStep,
  repositoryStep,
  stateStep,
} from "./workflow-policy.js";
import { terminateWorkflowIfActive } from "./workflow-superseding.js";

export type { ReviewRuntime } from "./review-services.js";
export { parseAppId } from "./credential-broker.js";

const repositoryPolicyFailureMessages: Readonly<Record<string, string>> = {
  RepositoryPolicyConflictError:
    "Use somente um arquivo de política: .github/holon.yml ou .holon.yml.",
  RepositoryPolicySchemaError:
    "A política não corresponde ao schema estrito da versão 1.",
  RepositoryPolicyScopeError:
    "A política contém uma exclusão de escopo proibida.",
  RepositoryPolicySecurityError:
    "O arquivo de política falhou nas validações de segurança.",
  RepositoryPolicySyntaxError:
    "O YAML da política contém sintaxe ou construções não suportadas.",
};

function repositoryPolicyFailureMessage(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const kind = error.message.startsWith("HOLON_REPOSITORY_POLICY:")
    ? error.message.slice("HOLON_REPOSITORY_POLICY:".length)
    : error.name;
  return repositoryPolicyFailureMessages[kind];
}

function buildProjectionTimestamps(
  rawEventTimestamp: Date,
  workflowStartedAt: string,
  terminalAt: string,
  analysisStartedAt: string | null,
) {
  const webhookReceivedMs = rawEventTimestamp.getTime();
  let workflowStartedMs = Date.parse(workflowStartedAt);
  if (workflowStartedMs < webhookReceivedMs) {
    workflowStartedMs = webhookReceivedMs;
  }
  let terminalMs = Date.parse(terminalAt);
  if (terminalMs < workflowStartedMs) {
    terminalMs = workflowStartedMs;
  }
  let analysisStartedAtIso: string | null = null;
  if (analysisStartedAt !== null) {
    let analysisMs = Date.parse(analysisStartedAt);
    if (analysisMs < workflowStartedMs) analysisMs = workflowStartedMs;
    if (analysisMs > terminalMs) analysisMs = terminalMs;
    analysisStartedAtIso = new Date(analysisMs).toISOString();
  }

  return {
    analysisStartedAt: analysisStartedAtIso,
    terminalAt: new Date(terminalMs).toISOString(),
    webhookReceivedAt: new Date(webhookReceivedMs).toISOString(),
    workflowStartedAt: new Date(workflowStartedMs).toISOString(),
  };
}

async function safeRecordStepStart(
  ledger: WorkflowLedger,
  runId: string,
  stepName: string,
  phase: StepPhase,
  attempt: number,
  startedAt: string,
  sanitizedInput?: Record<string, unknown> | null,
  stepOrder?: number | null,
): Promise<void> {
  try {
    await ledger.recordStepAttemptStart?.(
      runId,
      stepName,
      phase,
      attempt,
      startedAt,
      sanitizedInput,
      null,
      stepOrder,
    );
  } catch {
    // Non-blocking telemetry
  }
}

async function safeRecordStepComplete(
  ledger: WorkflowLedger,
  runId: string,
  stepName: string,
  attempt: number,
  endedAt: string,
  durationMs: number,
  sanitizedOutput?: Record<string, unknown> | null,
): Promise<void> {
  try {
    await ledger.recordStepAttemptComplete?.(
      runId,
      stepName,
      attempt,
      endedAt,
      durationMs,
      sanitizedOutput,
    );
  } catch {
    // Non-blocking telemetry
  }
}

async function safeRecordStepFailure(
  ledger: WorkflowLedger,
  runId: string,
  stepName: string,
  attempt: number,
  endedAt: string,
  durationMs: number,
  errorCode: string,
): Promise<void> {
  try {
    await ledger.recordStepAttemptFailure?.(
      runId,
      stepName,
      attempt,
      endedAt,
      durationMs,
      errorCode,
    );
  } catch {
    // Non-blocking telemetry
  }
}

async function emitAndRecordProjection(
  step: WorkflowStep,
  services: ReviewServices,
  payloadInput: AdminRunProjectionPayload,
  emit: (
    event: string,
    fields?: Readonly<Record<string, boolean | number | string | undefined>>,
    suffix?: number | string,
  ) => void,
  prefix: string,
): Promise<void> {
  const projectionQueue = services.adminProjectionQueue;
  if (projectionQueue === undefined) {
    return;
  }

  try {
    const event = await step.do(
      `${prefix}-build-admin-projection`,
      stateStep,
      async () => {
        return await buildAdminProjectionEvent(payloadInput);
      },
    );

    await step.do(
      `${prefix}-record-admin-projection-task`,
      stateStep,
      async () => {
        await services.ledger.recordProjectionTask(event);
      },
    );

    await step.do(`${prefix}-publish-admin-projection`, stateStep, async () => {
      try {
        await projectionQueue.send(event);
        await services.ledger.markProjectionTaskCompleted(payloadInput.runId);
      } catch (sendError) {
        await services.ledger.scheduleProjectionRetry(
          payloadInput.runId,
          errorKind(sendError),
        );
        throw sendError;
      }
    });
  } catch (projectionError) {
    emit("admin.projection_failed", {
      errorKind: errorKind(projectionError),
    });
  }
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

export async function executeReviewWorkflow(
  env: Cloudflare.Env,
  rawEvent: Readonly<WorkflowEvent<ReviewJob>>,
  step: WorkflowStep,
  runtime: ReviewRuntime = {},
) {
  const job = reviewJobSchema.parse(rawEvent.payload);
  const workflowInstanceId = rawEvent.instanceId;
  const logger = runtime.logger ?? consoleLogger;
  const now = runtime.now ?? (() => new Date().toISOString());
  const logContext = {
    pullRequestNumber: job.envelope.pullRequest.number,
    repositoryId: job.envelope.repository.id,
    runId: job.runId,
    workflowInstanceId,
  };
  const emit = (
    event: string,
    fields: Readonly<
      Record<string, boolean | number | string | undefined>
    > = {},
    suffix?: number | string,
  ) =>
    logger.emit(event, {
      eventId: eventId(workflowInstanceId, event, suffix),
      ...logContext,
      ...fields,
    });
  const services = createReviewServices(env, job, runtime, logger, {
    eventId: eventId(workflowInstanceId, "model.usage"),
    ...logContext,
  });
  const run = createReviewRun(job);
  const prKey = createPrKey({
    provider: "github",
    pullRequestNumber: job.envelope.pullRequest.number,
    repositoryId: job.envelope.repository.id,
  });
  let repositoryStarted = false;
  let runClaimed = false;
  let effectivePolicy: RepositoryPolicy | undefined;
  let reviewPhaseReached: ReviewPhaseReached = "admitted";
  let analysisStartedAtIso: string | null = null;

  const workflowStartedAt = await step.do(
    "workflow-start-time",
    stateStep,
    async () => now(),
  );
  const stepTimings: StepTiming[] = [];
  const recordStepTiming = (
    stepName: string,
    durationMs: number,
    status: "success" | "failure",
    attempt = 1,
  ) => {
    const timing: StepTiming = { attempt, durationMs, status, stepName };
    stepTimings.push(timing);
    try {
      void services.telemetry?.emitStepTiming(timing);
    } catch {
      // ignore
    }
  };

  const runInstrumentedStep = async <T>(
    stepName: string,
    phase: StepPhase,
    config: Parameters<WorkflowStep["do"]>[1],
    fn: (ctx: Parameters<Parameters<WorkflowStep["do"]>[2]>[0]) => Promise<T>,
    sanitizeInput?: () =>
      | Promise<Record<string, unknown> | null>
      | Record<string, unknown>
      | null,
    sanitizeOutput?: (output: T) => Record<string, unknown> | null,
    rollbackOptions?: Parameters<WorkflowStep["do"]>[3],
  ): Promise<T> => {
    type StepContext = Parameters<Parameters<WorkflowStep["do"]>[2]>[0];
    const stepInvoker = step as unknown as {
      do(
        name: string,
        config: Parameters<WorkflowStep["do"]>[1],
        callback: (ctx: StepContext) => Promise<T>,
        rollbackOptions?: Parameters<WorkflowStep["do"]>[3],
      ): Promise<T>;
    };
    return await stepInvoker.do(
      stepName,
      config,
      async (ctx) => {
        const attempt = (ctx as { attempt?: number } | undefined)?.attempt ?? 1;
        const stepCount =
          (ctx as { step?: { count?: number } } | undefined)?.step?.count ?? 0;
        const attemptStartDate = new Date();
        const attemptStartedAtIso = attemptStartDate.toISOString();
        const inputPayload = sanitizeInput ? await sanitizeInput() : null;
        await safeRecordStepStart(
          services.ledger,
          run.id,
          stepName,
          phase,
          attempt,
          attemptStartedAtIso,
          inputPayload,
          stepCount,
        );
        try {
          const result = await fn(ctx);
          const attemptEndedAtIso = now();
          const durationMs = durationFrom(attemptStartDate, attemptEndedAtIso);
          const outputPayload = sanitizeOutput ? sanitizeOutput(result) : null;
          await safeRecordStepComplete(
            services.ledger,
            run.id,
            stepName,
            attempt,
            attemptEndedAtIso,
            durationMs,
            outputPayload,
          );
          recordStepTiming(stepName, durationMs, "success", attempt);
          return result;
        } catch (error) {
          const attemptEndedAtIso = now();
          const durationMs = durationFrom(attemptStartDate, attemptEndedAtIso);
          const safeCode = errorKind(error);
          await safeRecordStepFailure(
            services.ledger,
            run.id,
            stepName,
            attempt,
            attemptEndedAtIso,
            durationMs,
            safeCode,
          );
          recordStepTiming(stepName, durationMs, "failure", attempt);
          throw error;
        }
      },
      rollbackOptions,
    );
  };

  const moveTo = async (
    stepName: string,
    expected: RunState,
    next: RunState,
    cleanup: boolean,
  ): Promise<string> =>
    await runInstrumentedStep(
      stepName,
      cleanup ? "cleanup" : "publication",
      stateStep,
      async () => {
        const occurredAt = now();
        if (cleanup) {
          await services.ledger.transitionAndRequestCleanup(
            run.id,
            expected,
            next,
            occurredAt,
            `${workflowInstanceId}:${stepName}`,
          );
          return occurredAt;
        }
        const current = await services.ledger.runState(run.id);
        if (current === next) return occurredAt;
        if (current !== expected) {
          throw new Error(
            `Review run cannot execute ${stepName} from ${current ?? "missing"}`,
          );
        }
        await services.ledger.transition(
          run.id,
          expected,
          next,
          occurredAt,
          `${workflowInstanceId}:${stepName}`,
        );
        return occurredAt;
      },
    );

  const refsAreCurrent = async (
    github: GitHubMutationContext,
  ): Promise<boolean> => {
    const refs = await github.readCurrentRefs();
    return !(
      refs.headSha !== job.envelope.pullRequest.headSha ||
      refs.baseSha !== job.envelope.pullRequest.baseSha
    );
  };

  const authorizeMutation = async (
    github: GitHubMutationContext,
    purpose: "failure" | "review",
  ): Promise<boolean> => {
    if (!(await refsAreCurrent(github))) return false;
    return await services.ledger.authorizeMutation(run.id, purpose);
  };

  const completeObsolete = async (
    expected: "publishing" | "running",
    stepName: string,
    cleanup: boolean,
  ) => {
    if (repositoryStarted) {
      await updateCheckRunCompleted(
        "cancel-check-run",
        "cancelled",
        {
          summary:
            "A newer commit or updated base was detected on this pull request. This review run was superseded.",
          title: "Holon Review Superseded",
        },
        false,
      );
    }
    const occurredAt = await moveTo(stepName, expected, "obsolete", cleanup);
    const obsoleteAt = occurredAt;
    const obsoleteDurationMs = durationFrom(rawEvent.timestamp, obsoleteAt);
    const queueWaitMs = durationFrom(rawEvent.timestamp, workflowStartedAt);
    const usage = await step.do(
      "obsolete-snapshot-accounting",
      stateStep,
      async () => services.ledger.loadAnalysisAccounting(run.id),
    );
    const tokenAccounting = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
    };
    const cost = calculateInferenceCost("unknown", tokenAccounting);
    const obsoleteTelemetry: RunTelemetry = {
      cost,
      createdAt: obsoleteAt,
      durationMs: obsoleteDurationMs,
      headSha: job.envelope.pullRequest.headSha,
      isDegraded: false,
      prKey,
      queueWaitMs,
      runId: run.id,
      scopeStatus: null,
      shardsCount: 0,
      stepTimings: usage.stepTimings,
      terminalState: "obsolete",
      tokens: tokenAccounting,
      toolCallsCount: usage.toolCallsCount,
    };
    await step
      .do("save-obsolete-telemetry", stateStep, async () => {
        await services.ledger.saveRunTelemetry(obsoleteTelemetry);
      })
      .catch(() => {});
    void services.telemetry?.emitRunTelemetry(obsoleteTelemetry);

    const timestamps = buildProjectionTimestamps(
      rawEvent.timestamp,
      workflowStartedAt,
      occurredAt,
      analysisStartedAtIso,
    );
    const projectionPayload: AdminRunProjectionPayload = {
      headSha: job.envelope.pullRequest.headSha,
      prKey,
      projectedFrom: "workflow",
      projectionRequestedAt: now(),
      pullRequestNumber: job.envelope.pullRequest.number,
      repository: {
        id: job.envelope.repository.id,
        name: job.envelope.repository.name,
        owner: job.envelope.repository.owner,
      },
      reviewPhaseReached,
      runId: run.id,
      scopeStatus: null,
      telemetry: {
        estimatedCostMicroUsd: cost.estimatedCostMicroUsd,
        executionDurationMs: obsoleteDurationMs,
        inputTokens: tokenAccounting.inputTokens,
        isDegraded: false,
        outputTokens: tokenAccounting.outputTokens,
        pricingModel: cost.pricingModel,
        reasoningTokens: null,
        reviewAdmissionQueueWaitMs: queueWaitMs,
        shardsCount: 0,
        toolCallsCount: usage.toolCallsCount,
      },
      terminalState: "obsolete",
      timestamps,
      verdict: null,
    };

    await emitAndRecordProjection(
      step,
      services,
      projectionPayload,
      emit,
      "obsolete",
    );

    const result = { findingsPublished: 0, outcome: "obsolete" } as const;
    emit("review.completed", {
      durationMs: durationFrom(rawEvent.timestamp, occurredAt),
      ...result,
    });
    return result;
  };

  const checkTarget = {
    baseSha: job.envelope.pullRequest.baseSha,
    installationId: job.envelope.installationId,
    repositoryId: job.envelope.repository.id,
    owner: job.envelope.repository.owner,
    repo: job.envelope.repository.name,
    pullNumber: job.envelope.pullRequest.number,
  };
  const ensureCheckRunStarted = async (): Promise<number | undefined> =>
    await runInstrumentedStep(
      "start-check-run",
      "admission",
      publicationStep,
      async () => {
        await services.ledger.scheduleCheckRun(run.id, {
          ...checkTarget,
          input: {
            externalId: run.id,
            headSha: job.envelope.pullRequest.headSha,
            status: "in_progress",
            startedAt: now(),
            output: {
              title: "Holon Review in progress",
              summary: "Holon is reviewing this pull request.",
            },
          },
        });
        return await services.reconcileCheckRun(run.id);
      },
      () => ({
        headSha: job.envelope.pullRequest.headSha,
        runId: run.id,
      }),
      (checkRunId) => ({ checkRunId: checkRunId ?? null }),
      {
        rollback: async () => {
          if ((await services.ledger.runState(run.id)) !== "obsolete") return;
          await services.ledger.scheduleCheckRun(run.id, {
            ...checkTarget,
            input: {
              externalId: run.id,
              headSha: job.envelope.pullRequest.headSha,
              status: "completed",
              conclusion: "cancelled",
              completedAt: now(),
              output: {
                title: "Holon Review Superseded",
                summary:
                  "A newer pull request snapshot superseded this review.",
              },
            },
          });
          await services.reconcileCheckRun(run.id);
        },
        rollbackConfig: {
          retries: {
            backoff: "exponential",
            delay: "5 seconds",
            limit: 4,
          },
          timeout: "2 minutes",
        },
      },
    ).catch((checkRunError: unknown) => {
      emit("check_run.start_failed", {
        errorKind: errorKind(checkRunError),
      });
      return undefined;
    });

  const updateCheckRunCompleted = async (
    stepName: string,
    conclusion: CheckRunConclusion,
    output: CheckRunOutput,
    requireCurrentRefs = true,
  ): Promise<boolean> =>
    await runInstrumentedStep(
      stepName,
      "publication",
      publicationStep,
      async () => {
        await services.ledger.scheduleCheckRun(run.id, {
          ...checkTarget,
          input: {
            externalId: run.id,
            headSha: job.envelope.pullRequest.headSha,
            status: "completed",
            conclusion,
            completedAt: now(),
            output,
          },
        });
        if (
          requireCurrentRefs &&
          !(await refsAreCurrent(await services.createMutationContext()))
        )
          return false;
        await services.reconcileCheckRun(run.id);
        return true;
      },
      () => ({
        conclusion,
        title: output.title,
      }),
      (authorized) => ({ authorized }),
    ).catch((checkRunError: unknown) => {
      emit("check_run.update_failed", {
        errorKind: errorKind(checkRunError),
        stepName,
      });
      return true;
    });

  try {
    const claim = await runInstrumentedStep(
      "claim-run",
      "admission",
      stateStep,
      async () => {
        const result = runClaimResultSchema.parse(
          await services.ledger.claimRun(run, workflowInstanceId),
        );
        emit("review.started", {
          eventTimestamp: rawEvent.timestamp.toISOString(),
        });
        return result;
      },
      () => ({
        attempt: run.attempt,
        baseSha: job.envelope.pullRequest.baseSha,
        causalVersion: causalVersionForJob(job),
        headSha: job.envelope.pullRequest.headSha,
        prKey: run.prKey,
        runId: run.id,
      }),
      (res) => ({
        outcome: res.outcome,
        supersededCount: res.supersededWorkflows.length,
      }),
    );
    if (claim.outcome === "duplicate") {
      return { findingsPublished: 0, outcome: "duplicate" } as const;
    }
    runClaimed = true;
    reviewPhaseReached = "admitted";

    for (const [index, superseded] of claim.supersededWorkflows.entries()) {
      await step
        .do(
          `terminate-superseded-workflow-${index + 1}`,
          stateStep,
          async () => {
            const outcome = await terminateWorkflowIfActive(
              services.workflow,
              superseded.workflowInstanceId,
            );
            await services.ledger.completeWorkflowSupersession(
              superseded.runId as RunId,
              now(),
            );
            emit(
              "workflow.superseded",
              {
                outcome,
                supersededRunId: superseded.runId,
              },
              index + 1,
            );
          },
        )
        .catch((terminationError: unknown) => {
          // Active termination reduces wasted inference, but stale-head and
          // publication authorization remain the correctness boundary. The
          // Durable Object alarm retains and retries the pending obligation.
          emit(
            "workflow.supersession_deferred",
            {
              errorKind: errorKind(terminationError),
              supersededRunId: superseded.runId,
            },
            index + 1,
          );
        });
    }

    await runInstrumentedStep(
      "start-run",
      "admission",
      stateStep,
      async () => {
        const current = await services.ledger.runState(run.id);
        if (current !== "running" && current !== "publishing") {
          if (current !== "queued" && current !== "failed_retryable") {
            throw new Error(
              `Review run cannot start from ${current ?? "missing"}`,
            );
          }
          await services.ledger.transition(
            run.id,
            current,
            "running",
            now(),
            `${workflowInstanceId}:start-run:${current}`,
          );
        }
      },
      () => ({ runId: run.id }),
      () => ({ state: "running" }),
    );

    const initialRefsAreCurrent = await runInstrumentedStep(
      "revalidate-initial-refs",
      "admission",
      publicationStep,
      async () => {
        const isLatest = await services.ledger.isLatestRun(run.id);
        if (!isLatest) return false;
        const refs = await services.readCurrentRefs();
        return (
          refs.headSha === job.envelope.pullRequest.headSha &&
          refs.baseSha === job.envelope.pullRequest.baseSha
        );
      },
      () => ({
        baseSha: job.envelope.pullRequest.baseSha,
        headSha: job.envelope.pullRequest.headSha,
      }),
      (isCurrent) => ({ initialRefsAreCurrent: isCurrent }),
    );
    if (!initialRefsAreCurrent) {
      return await completeObsolete(
        "running",
        "mark-obsolete-before-preparation",
        false,
      );
    }

    await ensureCheckRunStarted();

    effectivePolicy = await runInstrumentedStep(
      "resolve-repository-policy",
      "admission",
      repositoryStep,
      async () => {
        try {
          const session = await services.createSession();
          return await resolveRepositoryPolicy(
            session,
            job.envelope.repository.owner,
            job.envelope.repository.name,
            job.envelope.pullRequest.baseSha,
          );
        } catch (policyError) {
          if (
            policyError instanceof RepositoryPolicyConflictError ||
            policyError instanceof RepositoryPolicySyntaxError ||
            policyError instanceof RepositoryPolicySchemaError ||
            policyError instanceof RepositoryPolicyScopeError ||
            policyError instanceof RepositoryPolicySecurityError
          ) {
            throw new NonRetryableError(
              `HOLON_REPOSITORY_POLICY:${policyError.name}`,
            );
          }
          throw policyError;
        }
      },
      () => ({
        baseSha: job.envelope.pullRequest.baseSha,
        repoName: job.envelope.repository.name,
        repoOwner: job.envelope.repository.owner,
      }),
      (policy) => ({ policySource: policy.source }),
    );

    repositoryStarted = true;
    await runInstrumentedStep(
      "prepare-repository",
      "preparation",
      repositoryStep,
      async () => {
        await services.registerCredentialScope();
        const prepared = await services.prepareRepository(1, effectivePolicy);
        emit("repository.prepared", {
          changedLineCount: prepared.changedLineCount,
          contextBytes: prepared.contextBytes,
          fileCount: prepared.fileCount,
          truncated: prepared.truncated,
        });
        return prepared;
      },
      () => ({
        baseSha: job.envelope.pullRequest.baseSha,
        headSha: job.envelope.pullRequest.headSha,
        repoName: job.envelope.repository.name,
        repoOwner: job.envelope.repository.owner,
      }),
      (prepared) => ({
        changedLineCount: prepared.changedLineCount,
        contextBytes: prepared.contextBytes,
        fileCount: prepared.fileCount,
        truncated: prepared.truncated,
      }),
    );
    reviewPhaseReached = "repository_prepared";

    if (services.identifyProjects && effectivePolicy) {
      const identificationPolicy = effectivePolicy;
      const identificationStarted = await runInstrumentedStep(
        "start-project-identification",
        "preparation",
        stateStep,
        async () => Date.now(),
        () => null,
        (started) => ({ startedAt: started }),
      );
      const discovered = await runInstrumentedStep(
        "discover-project-metadata",
        "preparation",
        repositoryStep,
        async () =>
          services.identifyProjects!(
            identificationPolicy,
            undefined,
            true,
            identificationStarted + 120000,
          ),
        () => ({ hasPolicy: true }),
        (disc) => ({ projectsCount: disc?.projects?.length ?? 0 }),
      );
      if (discovered) {
        const identification = {
          ...discovered,
          projects: [] as typeof discovered.projects,
          usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 },
        };
        for (const [index, project] of discovered.projects.entries()) {
          const identifyProject = async () => {
            if (Date.now() >= identificationStarted + 120000)
              return {
                ...discovered,
                projects: [
                  {
                    ...project,
                    status: "partial" as const,
                    limitations: [
                      ...project.limitations,
                      "identification-deadline",
                    ],
                  },
                ],
                usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 },
              };
            return services.identifyProjects!(
              identificationPolicy,
              { ...discovered, projects: [project] },
              false,
              identificationStarted + 120000,
            );
          };
          let result = await runInstrumentedStep(
            `identify-project-${index}`,
            "preparation",
            modelStep,
            identifyProject,
            () => ({
              projectPath: project.root,
              projectType: project.ecosystem,
            }),
            (res) => ({ status: res?.status }),
          );
          for (
            let waiting = 0;
            waiting < 3 &&
            result?.projects.some((p) =>
              p.limitations.includes("identification-pending"),
            );
            waiting++
          ) {
            const mayWait = await step.do(
              `continue-project-identification-${index}-${waiting}`,
              stateStep,
              async () => Date.now() - identificationStarted < 90000,
            );
            if (!mayWait) break;
            await step.sleep(
              `wait-project-identification-${index}-${waiting}`,
              "30 seconds",
            );
            result = await runInstrumentedStep(
              `retry-project-identification-${index}-${waiting}`,
              "preparation",
              modelStep,
              identifyProject,
              () => ({
                projectPath: project.root,
                projectType: project.ecosystem,
                waiting,
              }),
              (res) => ({ status: res?.status }),
            );
          }
          identification.projects.push(
            ...(result?.projects ?? [
              {
                ...project,
                status: "partial" as const,
                limitations: [
                  ...project.limitations,
                  "identification-unavailable",
                ],
              },
            ]),
          );
          identification.usage.inputTokens += result?.usage?.inputTokens ?? 0;
          identification.usage.outputTokens += result?.usage?.outputTokens ?? 0;
          identification.usage.modelCalls += result?.usage?.modelCalls ?? 0;
        }
        if (
          identification.projects.some(
            (project) => project.status !== "complete",
          )
        )
          identification.status = "partial";
        services.useProjectIdentification?.(identification);
        if (services.ledger.saveProjectIdentification)
          await runInstrumentedStep(
            "record-project-identification",
            "preparation",
            stateStep,
            async () =>
              services.ledger.saveProjectIdentification!(
                job.runId,
                identification,
              ),
            () => ({
              projectsCount: identification.projects.length,
              status: identification.status,
            }),
            () => ({ recorded: true }),
          );
      }
    }

    analysisStartedAtIso = await step.do(
      "analysis-start-time",
      stateStep,
      async () => now(),
    );
    reviewPhaseReached = "analysis_started";
    let output = await analyzeReview(job, services, emit, effectivePolicy, {
      runStep: (name, phase, callback) =>
        runInstrumentedStep(
          name,
          phase,
          name === "plan-review" ? repositoryStep : modelStep,
          callback,
          () => ({
            modelRoute: services.modelRoute ?? "unknown",
            toolsBudget: services.toolsBudget ?? null,
          }),
          (result) => {
            if (name !== "analyze-review") return null;
            const checkpoint = reviewAnalysisCheckpointSchema.parse(result);
            return {
              findingsCount: checkpoint.activeFindings.length,
              promptTruncated:
                checkpoint.promptTruncated || checkpoint.contextTruncated,
              summary: checkpoint.summary.slice(0, 500),
              historicalFindings: checkpoint.activeFindings.map((finding) => ({
                diagnostic: finding.diagnostic,
                filePath: finding.location.path,
                fingerprint: finding.fingerprint,
                line: finding.location.line,
                severity: finding.severity,
                status: finding.status,
                updatedAt: now(),
              })),
            };
          },
        ),
      finish: (result) => services.ledger.saveReviewAnalysis(run.id, result),
    });
    reviewPhaseReached = "analyzed";

    await moveTo("begin-publication", "running", "publishing", false);
    reviewPhaseReached = "publishing";
    const currentBeforePublication = await runInstrumentedStep(
      "revalidate-current-refs",
      "publication",
      publicationStep,
      async () => {
        const isLatest = await services.ledger.isLatestRun(run.id);
        if (!isLatest) return false;
        const refs = await services.readCurrentRefs();
        return (
          refs.headSha === job.envelope.pullRequest.headSha &&
          refs.baseSha === job.envelope.pullRequest.baseSha
        );
      },
      () => ({
        baseSha: job.envelope.pullRequest.baseSha,
        headSha: job.envelope.pullRequest.headSha,
      }),
      (isCurrent) => ({ currentBeforePublication: isCurrent }),
    );
    if (!currentBeforePublication) {
      return await completeObsolete(
        "publishing",
        "mark-obsolete-and-schedule-cleanup",
        true,
      );
    }

    let findingsPublished = 0;
    const publishedCommentIds = new Map<string, number>();

    for (const [index, finding] of output.activeFindings.entries()) {
      if (finding.confidence < 0.8 || finding.severity === "low") continue;

      // Suppress duplicate inline comments for persistent findings
      if (
        finding.status === "persistent" &&
        finding.previousCommentId !== undefined
      ) {
        continue;
      }

      const result = await runInstrumentedStep(
        `publish-inline-${index + 1}`,
        "publication",
        publicationStep,
        async () => {
          const github = await services.createMutationContext();
          try {
            const detail = await loadReviewWithCurrentFeedback(
              services.ledger,
              run.id,
              prKey,
            );
            const effectiveFinding = detail.activeFindings.find(
              (candidate) => candidate.fingerprint === finding.fingerprint,
            );
            if (
              effectiveFinding === undefined ||
              classifyFindingPublication(effectiveFinding) !== "inline"
            )
              return { authorized: true, published: false } as const;
            const findingId = await createFindingId(run.id, {
              diagnostic: effectiveFinding.diagnostic,
              endLine: effectiveFinding.location.line,
              path: effectiveFinding.location.path,
              startLine:
                effectiveFinding.location.startLine ??
                effectiveFinding.location.line,
            });
            let commentId: number | undefined;
            const published = await publishAuthorized(
              services.ledger,
              github.publisher,
              run.id,
              findingId,
              "inline",
              renderFinding(effectiveFinding),
              {
                line: effectiveFinding.location.line,
                path: effectiveFinding.location.path,
                side: "RIGHT",
                ...(effectiveFinding.location.startLine !== undefined
                  ? { startLine: effectiveFinding.location.startLine }
                  : {}),
              },
              () => authorizeMutation(github, "review"),
              (id) => {
                commentId = id;
              },
            );
            return { authorized: true, commentId, published } as const;
          } catch (error) {
            if (isReviewMutationNotAuthorizedError(error)) {
              return { authorized: false, published: false } as const;
            }
            throw error;
          }
        },
        () => ({
          findingPath: finding.location.path,
          line: finding.location.line,
          severity: finding.severity,
        }),
        (res) => ({
          authorized: res.authorized,
          commentId: res.commentId,
          published: res.published,
        }),
      );
      if (!result.authorized) {
        return await completeObsolete(
          "publishing",
          "mark-obsolete-during-publication",
          true,
        );
      }
      if (result.commentId !== undefined) {
        publishedCommentIds.set(finding.fingerprint, result.commentId);
      }
      if (result.published) findingsPublished += 1;
    }

    // Notify resolutions on original comment threads
    for (let index = 0; index < output.resolvedFindingsCount; index += 1) {
      const resolutionAuthorized = await runInstrumentedStep(
        `notify-resolved-${index + 1}`,
        "publication",
        publicationStep,
        async () => {
          const github = await services.createMutationContext();
          const original = (await services.ledger.loadReviewAnalysis(run.id))
            .resolvedFindings[index];
          const refreshed = await loadReviewWithCurrentFeedback(
            services.ledger,
            run.id,
            prKey,
          );
          const resolved = refreshed.resolvedFindings.find(
            (finding) => finding.fingerprint === original?.fingerprint,
          );
          if (resolved?.githubCommentId === undefined) return true;
          try {
            await publishResolutionAuthorized(
              services.ledger,
              github.publisher,
              run.id,
              resolved,
              job.envelope.pullRequest.headSha,
              () => authorizeMutation(github, "review"),
            );
            return true;
          } catch (error) {
            if (isReviewMutationNotAuthorizedError(error)) return false;
            throw error;
          }
        },
        () => ({ resolutionIndex: index }),
        (authorized) => ({ authorized }),
      );
      if (!resolutionAuthorized) {
        return await completeObsolete(
          "publishing",
          "mark-obsolete-before-resolution-reply",
          true,
        );
      }
    }

    const summaryResult = await runInstrumentedStep(
      "publish-summary",
      "publication",
      publicationStep,
      async () => {
        const github = await services.createMutationContext();
        const currentReview = await loadReviewWithCurrentFeedback(
          services.ledger,
          run.id,
          prKey,
        );
        let summaryText = currentReview.summary;
        try {
          const ciEvidence = await services.ledger.loadCiEvidence(
            prKey,
            job.envelope.pullRequest.headSha,
          );
          if (ciEvidence?.markdown) {
            summaryText = appendCiEvidenceToSummary(
              summaryText,
              ciEvidence.markdown,
            );
          }
        } catch (error) {
          emit("ci_evidence_load_failed", {
            errorKind: errorKind(error),
            prKey,
          });
        }
        try {
          const published = await publishAuthorized(
            services.ledger,
            github.publisher,
            run.id,
            "summary",
            "summary",
            summaryText,
            { event: currentReview.verdict },
            () => authorizeMutation(github, "review"),
          );
          return {
            authorized: true,
            published,
            checkpoint: buildReviewAnalysisCheckpoint(currentReview),
          } as const;
        } catch (error) {
          if (isReviewMutationNotAuthorizedError(error)) {
            return { authorized: false, published: false } as const;
          }
          throw error;
        }
      },
      () => ({
        activeFindingsCount: output.activeFindings.length,
        resolvedFindingsCount: output.resolvedFindingsCount,
        verdict: output.verdict,
      }),
      (res) => ({
        authorized: res.authorized,
        published: res.published,
      }),
    );
    if (!summaryResult.authorized) {
      return await completeObsolete(
        "publishing",
        "mark-obsolete-before-summary",
        true,
      );
    }

    output = summaryResult.checkpoint;

    // Persist tracked findings in ledger
    await runInstrumentedStep(
      "save-pr-findings",
      "publication",
      publicationStep,
      async () => {
        const detail = await services.ledger.loadReviewAnalysis(run.id);
        await services.ledger.savePrFindings(
          prKey,
          detail.updatedTrackedFindings.map((finding) => ({
            ...finding,
            githubCommentId:
              publishedCommentIds.get(finding.fingerprint) ??
              finding.githubCommentId,
          })),
          run.id,
        );
      },
      () => ({
        prKey,
        trackedFindingsCount: publishedCommentIds.size,
      }),
      () => ({ saved: true }),
    );
    const { checkRunConclusion, checkRunOutput, checkpoint } =
      await runInstrumentedStep(
        "format-check-run-output",
        "publication",
        stateStep,
        async () => {
          const detail = await loadReviewWithCurrentFeedback(
            services.ledger,
            run.id,
            prKey,
          );
          const isPartial =
            detail.scopeStatus === "partial_by_policy" ||
            detail.scopeStatus === "partial_by_failure";
          const conclusion = determineCheckRunConclusion(
            detail.findings,
            isPartial,
            detail.verdict,
          );
          const formattedOutput = formatCheckRunOutput({
            durationMs: durationFrom(rawEvent.timestamp, now()),
            effectivePolicyDigest: detail.effectivePolicyDigest,
            findings: detail.findings,
            partial: isPartial,
            policySource: detail.policySource,
            reconciliation: detail.reconciliation,
            scopeStatus: detail.scopeStatus,
            shardsAnalyzed: detail.shardsAnalyzed,
            structuralImpact: detail.structuralImpact,
            sourceDigest: detail.sourceDigest,
            summary: detail.summary,
            totalShards: detail.totalShards,
            verdict: detail.verdict,
            waiversCount: detail.waiversCount,
          });
          return {
            checkRunConclusion: conclusion,
            checkRunOutput: formattedOutput,
            checkpoint: buildReviewAnalysisCheckpoint(detail),
          };
        },
      );
    output = checkpoint;
    await runInstrumentedStep(
      "record-review-decision",
      "publication",
      stateStep,
      async () => {
        await services.ledger.recordReviewDecision(run.id, {
          headSha: job.envelope.pullRequest.headSha,
          isDegraded: output.isDegraded === true,
          scopeStatus: output.scopeStatus,
          shardsAnalyzed: output.shardsAnalyzed,
          totalShards: output.totalShards,
        });
      },
      () => ({
        headSha: job.envelope.pullRequest.headSha,
        isDegraded: output.isDegraded === true,
        scopeStatus: output.scopeStatus,
      }),
      () => ({ recorded: true }),
    );

    const checkRunAuthorized = await updateCheckRunCompleted(
      "complete-check-run",
      checkRunConclusion,
      checkRunOutput,
    );
    if (!checkRunAuthorized) {
      return await completeObsolete(
        "publishing",
        "mark-obsolete-before-terminal-check-run",
        true,
      );
    }

    const finishedAt = now();
    const totalDurationMs = durationFrom(rawEvent.timestamp, finishedAt);
    const queueWaitMs = durationFrom(rawEvent.timestamp, workflowStartedAt);
    const usage = await step.do(
      "completed-snapshot-accounting",
      stateStep,
      async () => services.ledger.loadAnalysisAccounting(run.id),
    );
    const tokenAccounting = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
    };
    const cost = calculateInferenceCost(
      services.modelRoute || "deepseek-chat",
      tokenAccounting,
    );
    const runTelemetry: RunTelemetry = {
      cost,
      createdAt: finishedAt,
      durationMs: totalDurationMs,
      ...(output.effectivePolicyDigest === undefined
        ? {}
        : { effectivePolicyDigest: output.effectivePolicyDigest }),
      headSha: job.envelope.pullRequest.headSha,
      isDegraded: output.isDegraded === true,
      ...(output.policySource === undefined
        ? {}
        : { policySource: output.policySource }),
      prKey,
      queueWaitMs,
      runId: run.id,
      scopeStatus: output.scopeStatus,
      shardsCount: output.totalShards,
      stepTimings: usage.stepTimings,
      ...(output.sourceDigest === undefined
        ? {}
        : { sourceDigest: output.sourceDigest }),
      terminalState: "completed",
      tokens: tokenAccounting,
      toolCallsCount: usage.toolCallsCount,
      verdict: output.verdict,
    };

    const slo = evaluateRunSlo(runTelemetry);
    if (!slo.compliant) {
      emit("slo.breached", {
        runId: run.id,
        violations: slo.violations.join("; "),
      });
    }

    await step
      .do("save-run-telemetry", stateStep, async () => {
        await services.ledger.saveRunTelemetry(runTelemetry);
      })
      .catch(() => {});
    void services.telemetry?.emitRunTelemetry(runTelemetry);

    const completedAt = await moveTo(
      "complete-run-and-schedule-cleanup",
      "publishing",
      "completed",
      true,
    );

    const timestamps = buildProjectionTimestamps(
      rawEvent.timestamp,
      workflowStartedAt,
      completedAt,
      analysisStartedAtIso,
    );
    const completedProjectionPayload: AdminRunProjectionPayload = {
      headSha: job.envelope.pullRequest.headSha,
      prKey,
      projectedFrom: "workflow",
      projectionRequestedAt: now(),
      pullRequestNumber: job.envelope.pullRequest.number,
      repository: {
        id: job.envelope.repository.id,
        name: job.envelope.repository.name,
        owner: job.envelope.repository.owner,
      },
      reviewPhaseReached: "publishing",
      runId: run.id,
      scopeStatus: output.scopeStatus,
      telemetry: {
        estimatedCostMicroUsd: cost.estimatedCostMicroUsd,
        executionDurationMs: totalDurationMs,
        inputTokens: tokenAccounting.inputTokens,
        isDegraded: output.isDegraded === true,
        outputTokens: tokenAccounting.outputTokens,
        pricingModel: cost.pricingModel,
        reasoningTokens: null,
        reviewAdmissionQueueWaitMs: queueWaitMs,
        shardsCount: output.totalShards,
        toolCallsCount: usage.toolCallsCount,
      },
      terminalState: "completed",
      timestamps,
      verdict: output.verdict ?? null,
    };

    await emitAndRecordProjection(
      step,
      services,
      completedProjectionPayload,
      emit,
      "completed",
    );

    const result = { findingsPublished, outcome: "completed" } as const;
    emit("review.completed", {
      durationMs: durationFrom(rawEvent.timestamp, completedAt),
      ...result,
    });
    return result;
  } catch (error) {
    const isPolicyError =
      error instanceof RepositoryPolicyConflictError ||
      error instanceof RepositoryPolicySyntaxError ||
      error instanceof RepositoryPolicySchemaError ||
      error instanceof RepositoryPolicyScopeError ||
      error instanceof RepositoryPolicySecurityError ||
      (error instanceof Error &&
        (error.message.startsWith("HOLON_REPOSITORY_POLICY:") ||
          error.name.startsWith("RepositoryPolicy")));

    const policyErrorMessage = repositoryPolicyFailureMessage(error);

    const terminal = await runInstrumentedStep(
      "mark-review-terminal-and-schedule-cleanup",
      "cleanup",
      stateStep,
      async () => {
        const occurredAt = now();
        const changed = await services.ledger.markTerminalAndRequestCleanup(
          run.id,
          occurredAt,
          repositoryStarted,
        );
        return { changed, occurredAt };
      },
      () => ({ repositoryStarted }),
      (res) => ({ changed: res.changed, occurredAt: res.occurredAt }),
    ).catch((terminalError: unknown) => {
      emit("review.terminalization_failed", {
        errorKind: errorKind(terminalError),
      });
      return undefined;
    });

    emit("review.failed", {
      durationMs:
        terminal === undefined
          ? 0
          : durationFrom(rawEvent.timestamp, terminal.occurredAt),
      errorKind: errorKind(error),
    });
    if (runClaimed && terminal?.changed === true) {
      await runInstrumentedStep(
        "publish-failure-notice",
        "publication",
        publicationStep,
        async () => {
          const github = await services.createMutationContext();
          const noticeBody = isPolicyError
            ? `Holon encontrou um erro na política configurada para o repositório (.github/holon.yml ou .holon.yml) e interrompeu a revisão:\n\n> ${policyErrorMessage ?? "Erro de configuração"}\n\nCorrija o arquivo de configuração no branch base para retomar as revisões automáticas.`
            : undefined;
          await publishFailureNoticeAuthorized(
            github.publisher,
            run.id,
            () => authorizeMutation(github, "failure"),
            noticeBody,
          );
        },
        () => ({ isPolicyError }),
        () => ({ published: true }),
      ).catch((publicationError: unknown) => {
        emit("review.failure_notice_failed", {
          errorKind: errorKind(publicationError),
        });
      });
    }

    if (runClaimed) {
      await updateCheckRunCompleted("fail-check-run", "failure", {
        summary: isPolicyError
          ? `A política configurada para o repositório (.github/holon.yml ou .holon.yml) é inválida:\n\n> ${policyErrorMessage ?? "Erro de configuração"}`
          : "Holon encountered a system failure and could not complete the automated review. Scheduled for cleanup.",
        title: isPolicyError
          ? "Política de repositório inválida"
          : "Holon Review Failed",
      });
    }

    const failedAt = now();
    const failedDurationMs = durationFrom(rawEvent.timestamp, failedAt);
    const queueWaitMs = durationFrom(rawEvent.timestamp, workflowStartedAt);
    const usage = await step.do(
      "failed-snapshot-accounting",
      stateStep,
      async () => services.ledger.loadAnalysisAccounting(run.id),
    );
    const tokenAccounting = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.inputTokens + usage.outputTokens,
    };
    const cost = calculateInferenceCost("unknown", tokenAccounting);
    const failedTelemetry: RunTelemetry = {
      cost,
      createdAt: failedAt,
      durationMs: failedDurationMs,
      ...(effectivePolicy === undefined
        ? {}
        : {
            effectivePolicyDigest: effectivePolicy.effectivePolicyDigest,
            policySource: effectivePolicy.source,
            ...(effectivePolicy.sourceDigest === null
              ? {}
              : { sourceDigest: effectivePolicy.sourceDigest }),
          }),
      headSha: job.envelope.pullRequest.headSha,
      isDegraded: true,
      prKey,
      queueWaitMs,
      runId: run.id,
      scopeStatus: "partial_by_failure",
      shardsCount: 1,
      stepTimings: usage.stepTimings,
      terminalState: "failed_terminal",
      tokens: tokenAccounting,
      toolCallsCount: usage.toolCallsCount,
    };
    await step
      .do("save-failed-telemetry", stateStep, async () => {
        await services.ledger.saveRunTelemetry(failedTelemetry);
      })
      .catch(() => {});
    void services.telemetry?.emitRunTelemetry(failedTelemetry);

    if (terminal?.changed === true) {
      const timestamps = buildProjectionTimestamps(
        rawEvent.timestamp,
        workflowStartedAt,
        terminal.occurredAt,
        analysisStartedAtIso,
      );
      const failedProjectionPayload: AdminRunProjectionPayload = {
        headSha: job.envelope.pullRequest.headSha,
        prKey,
        projectedFrom: "workflow",
        projectionRequestedAt: now(),
        pullRequestNumber: job.envelope.pullRequest.number,
        repository: {
          id: job.envelope.repository.id,
          name: job.envelope.repository.name,
          owner: job.envelope.repository.owner,
        },
        reviewPhaseReached,
        runId: run.id,
        scopeStatus: "partial_by_failure",
        telemetry: {
          estimatedCostMicroUsd: cost.estimatedCostMicroUsd,
          executionDurationMs: failedDurationMs,
          inputTokens: tokenAccounting.inputTokens,
          isDegraded: true,
          outputTokens: tokenAccounting.outputTokens,
          pricingModel: cost.pricingModel,
          reasoningTokens: null,
          reviewAdmissionQueueWaitMs: queueWaitMs,
          shardsCount: 1,
          toolCallsCount: usage.toolCallsCount,
        },
        terminalState: "failed_terminal",
        timestamps,
        verdict: null,
      };

      await emitAndRecordProjection(
        step,
        services,
        failedProjectionPayload,
        emit,
        "failed",
      );
    }

    throw error;
  }
}
