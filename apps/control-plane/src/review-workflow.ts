import { projectCompatibility } from "@holon/application";
import { RepositoryConfigurationError } from "@holon/application";
import {
  createReviewRun,
  planInlinePublications,
  determineCheckRunConclusion,
  formatCheckRunOutput,
  renderFinding,
} from "@holon/application";
import type { RunConfigurationRef } from "@holon/contracts";
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
import { reviewMessage, type ReviewLanguage } from "@holon/domain";
import {
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
  consoleErrorReporter,
  reportError,
  withErrorReporting,
} from "@holon/observability";
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
  configurationScopePolicy,
  resolveRunConfiguration,
} from "./run-configuration-resolver.js";
import { configurationStep } from "./workflow-policy.js";
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

const repositoryConfigurationFailureMessages: Readonly<
  Record<string, import("@holon/domain").ReviewMessageCode>
> = {
  conflicting_sources: "configurationConflict",
  invalid_yaml: "configurationYaml",
  invalid_configuration: "configurationSchema",
  invalid_file: "configurationFile",
  access_denied: "configurationAccess",
  snapshot_unavailable: "configurationSnapshot",
  too_large: "configurationSize",
  budget_exceeded: "configurationBudget",
  snapshot_mismatch: "configurationIntegrity",
  snapshot_corrupt: "configurationIntegrity",
  snapshot_conflict: "configurationIntegrity",
  missing_project_root: "configurationRoot",
  missing_reference: "configurationReference",
  excluded_reference: "configurationReference",
  invalid_compatibility: "configurationCompatibility",
};
function repositoryConfigurationFailureMessage(
  error: unknown,
  language: import("@holon/domain").ReviewLanguage,
): string {
  const code =
    error instanceof RepositoryConfigurationError
      ? error.code
      : error instanceof Error &&
          error.message.startsWith("HOLON_REPOSITORY_CONFIG:")
        ? error.message.slice("HOLON_REPOSITORY_CONFIG:".length)
        : undefined;
  return reviewMessage(
    language,
    (code === undefined
      ? undefined
      : repositoryConfigurationFailureMessages[code]) ?? "configurationUnknown",
  );
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
  } catch (error) {
    reportError(consoleErrorReporter, "workflow.step_record_failed", error, {
      component: "control-plane",
      operation: "workflow.step_start",
      runId,
      stepName,
      attempt,
    });
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
  } catch (error) {
    reportError(consoleErrorReporter, "workflow.step_record_failed", error, {
      component: "control-plane",
      operation: "workflow.step_complete",
      runId,
      stepName,
      attempt,
    });
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
  } catch (error) {
    reportError(consoleErrorReporter, "workflow.step_record_failed", error, {
      component: "control-plane",
      operation: "workflow.step_failure",
      runId,
      stepName,
      attempt,
    });
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
    reportError(
      consoleErrorReporter,
      "workflow.admin_projection_failed",
      projectionError,
      {
        component: "control-plane",
        operation: "workflow.admin_projection",
        runId: payloadInput.runId,
      },
    );
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
    return await withErrorReporting(
      "workflow.run_failed",
      consoleErrorReporter,
      {
        component: "control-plane",
        operation: "workflow.run",
        workflowInstanceId: event.instanceId,
      },
      async () => await executeReviewWorkflow(this.env, event, step),
    );
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
  let configuration: RunConfigurationRef | undefined;
  let outputLanguage: ReviewLanguage = "en";
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
    } catch (error) {
      reportError(consoleErrorReporter, "workflow.step_timing_failed", error, {
        component: "control-plane",
        operation: "telemetry.step",
        runId: run.id,
        stepName,
        attempt,
      });
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
          reportError(consoleErrorReporter, "workflow.step_failed", error, {
            component: "control-plane",
            operation: "workflow.step",
            runId: run.id,
            workflowInstanceId,
            repositoryId: job.envelope.repository.id,
            pullRequestNumber: job.envelope.pullRequest.number,
            stepName,
            attempt,
            phase,
          });
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
          summary: reviewMessage(outputLanguage, "superseded"),
          title: reviewMessage(outputLanguage, "supersededTitle"),
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
      .catch((error: unknown) => {
        reportError(
          consoleErrorReporter,
          "workflow.telemetry_persist_failed",
          error,
          {
            component: "control-plane",
            operation: "workflow.save_obsolete_telemetry",
            runId: run.id,
          },
        );
      });
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

  const ensureCheckRunStarted = async (): Promise<number | undefined> =>
    await runInstrumentedStep(
      "start-check-run",
      "admission",
      publicationStep,
      async () => {
        let checkRunId = await services.ledger.checkRunId(run.id);
        if (checkRunId !== undefined) return checkRunId;

        const github = await services.createMutationContext();
        if (github.publisher.findCheckRunByExternalId !== undefined) {
          const existingId = await github.publisher.findCheckRunByExternalId(
            run.id,
          );
          if (existingId !== undefined) {
            await services.ledger.recordCheckRunId(run.id, existingId);
            return existingId;
          }
        }

        if (github.publisher.createCheckRun !== undefined) {
          checkRunId = await github.publisher.createCheckRun({
            externalId: run.id,
            headSha: job.envelope.pullRequest.headSha,
            name: "Holon Review",
            output: {
              summary: reviewMessage(outputLanguage, "inProgress"),
              title: reviewMessage(outputLanguage, "inProgressTitle"),
            },
            startedAt: now(),
            status: "in_progress",
          });
          await services.ledger.recordCheckRunId(run.id, checkRunId);
          return checkRunId;
        }
        return undefined;
      },
      () => ({
        headSha: job.envelope.pullRequest.headSha,
        runId: run.id,
      }),
      (checkRunId) => ({ checkRunId: checkRunId ?? null }),
      {
        rollback: async ({ output: checkRunId }) => {
          if (typeof checkRunId !== "number") return;
          const currentRunState = await services.ledger.runState(run.id);
          if (currentRunState !== "obsolete") return;
          const github = await services.createMutationContext();
          if (github.publisher.updateCheckRun === undefined) return;
          await github.publisher.updateCheckRun({
            checkRunId,
            completedAt: now(),
            conclusion: "cancelled",
            output: {
              summary: reviewMessage(outputLanguage, "superseded"),
              title: reviewMessage(outputLanguage, "supersededTitle"),
            },
            status: "completed",
          });
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
        let checkRunId = await services.ledger.checkRunId(run.id);
        const github = await services.createMutationContext();
        if (
          checkRunId === undefined &&
          github.publisher.findCheckRunByExternalId !== undefined
        ) {
          checkRunId = await github.publisher.findCheckRunByExternalId(run.id);
        }
        if (
          checkRunId !== undefined &&
          github.publisher.updateCheckRun !== undefined
        ) {
          if (requireCurrentRefs && !(await refsAreCurrent(github))) {
            return false;
          }
          await github.publisher.updateCheckRun({
            checkRunId,
            completedAt: now(),
            conclusion,
            output,
            status: "completed",
          });
        }
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

    repositoryStarted = true;
    configuration = await runInstrumentedStep(
      "resolve-repository-config",
      "admission",
      configurationStep,
      async () => {
        try {
          return await resolveRunConfiguration(
            job,
            services.ledger,
            async () => {
              const session = await services.createSession();
              return session.configurationReader(
                job.envelope.repository.owner,
                job.envelope.repository.name,
                job.envelope.pullRequest.baseSha,
              );
            },
            emit,
          );
        } catch (error) {
          if (error instanceof RepositoryConfigurationError)
            emit("configuration.rejected", {
              code: error.code,
              location: error.location,
            });
          if (
            error instanceof RepositoryConfigurationError &&
            error.code !== "transient_failure"
          )
            throw new NonRetryableError(
              `HOLON_REPOSITORY_CONFIG:${error.code}`,
            );
          throw error;
        }
      },
      () => ({ baseSha: job.envelope.pullRequest.baseSha }),
      (reference) => ({ configDigest: reference.configDigest }),
    );
    const configurationRef = configuration;
    const preferences = await runInstrumentedStep(
      "load-repository-scope",
      "admission",
      stateStep,
      async () => {
        const snapshot =
          await services.ledger.loadRunConfiguration(configurationRef);
        return {
          policy: configurationScopePolicy(snapshot),
          language: snapshot.config.output.language,
        };
      },
      () => ({ configDigest: configurationRef.configDigest }),
      (value) => ({
        scopeDigest: value.policy.effectivePolicyDigest,
        language: value.language,
      }),
    );
    effectivePolicy = preferences.policy;
    outputLanguage = preferences.language;
    await ensureCheckRunStarted();

    repositoryStarted = true;
    await runInstrumentedStep(
      "prepare-repository",
      "preparation",
      repositoryStep,
      async () => {
        await services.registerCredentialScope();
        const policy = configurationScopePolicy(
          await services.ledger.loadRunConfiguration(configurationRef),
        );
        const prepared = await services.prepareRepository(1, policy);
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
        const configuredIdentification = {
          ...identification,
          configuredCompatibility: projectCompatibility(
            await services.ledger.loadRunConfiguration(configurationRef),
            identification,
          ),
        };
        services.useProjectIdentification?.(configuredIdentification);
        if (services.ledger.saveProjectIdentification)
          await runInstrumentedStep(
            "record-project-identification",
            "preparation",
            stateStep,
            async () =>
              services.ledger.saveProjectIdentification!(
                job.runId,
                configuredIdentification,
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
      configuration: configurationRef,
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

    const inlinePlan = await runInstrumentedStep(
      "plan-inline-publications",
      "publication",
      stateStep,
      async () => {
        const snapshot =
          await services.ledger.loadRunConfiguration(configurationRef);
        const detail = await services.ledger.loadReviewAnalysis(run.id);
        return planInlinePublications(
          detail.activeFindings,
          snapshot.config.output.maxInlineComments,
        );
      },
    );
    const selectedInlineFindings = new Set(inlinePlan.inlineFingerprints);
    for (const [index, finding] of output.activeFindings.entries()) {
      if (!selectedInlineFindings.has(finding.fingerprint)) continue;

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
              renderFinding(effectiveFinding, detail.output.language),
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
              refreshed.output.language,
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
        const snapshot =
          await services.ledger.loadRunConfiguration(configurationRef);
        let summaryText = currentReview.summary;
        try {
          const ciEvidence = await services.ledger.loadCiEvidence(
            prKey,
            job.envelope.pullRequest.headSha,
          );
          if (ciEvidence !== undefined) {
            summaryText = appendCiEvidenceToSummary(
              summaryText,
              ciEvidence.markdownByLanguage[snapshot.config.output.language],
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
        const snapshot =
          await services.ledger.loadRunConfiguration(configurationRef);
        await services.ledger.recordReviewDecision(run.id, {
          output: snapshot.config.output,
          verdictPolicy: {
            mediumSeverityThreshold:
              snapshot.config.verdictStrictness === "block_all_confident_medium"
                ? 1
                : 2,
          },
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
      .catch((error: unknown) => {
        reportError(
          consoleErrorReporter,
          "workflow.telemetry_persist_failed",
          error,
          {
            component: "control-plane",
            operation: "workflow.save_run_telemetry",
            runId: run.id,
          },
        );
      });
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
    const isConfigurationError =
      error instanceof RepositoryConfigurationError ||
      (error instanceof Error &&
        error.message.startsWith("HOLON_REPOSITORY_CONFIG:"));

    const configurationErrorMessage = repositoryConfigurationFailureMessage(
      error,
      outputLanguage,
    );

    if (runClaimed) {
      await ensureCheckRunStarted();
      await updateCheckRunCompleted("fail-check-run", "failure", {
        summary: isConfigurationError
          ? reviewMessage(outputLanguage, "configurationInvalid", {
              reason: configurationErrorMessage,
            })
          : reviewMessage(outputLanguage, "failed"),
        title: isConfigurationError
          ? reviewMessage(outputLanguage, "configurationInvalidTitle")
          : reviewMessage(outputLanguage, "failedTitle"),
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
      .catch((telemetryError: unknown) => {
        reportError(
          consoleErrorReporter,
          "workflow.telemetry_persist_failed",
          telemetryError,
          {
            component: "control-plane",
            operation: "workflow.save_failed_telemetry",
            runId: run.id,
          },
        );
      });
    void services.telemetry?.emitRunTelemetry(failedTelemetry);

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
          const noticeBody = isConfigurationError
            ? `${reviewMessage(outputLanguage, "configurationInvalid", { reason: configurationErrorMessage })}\n\n${reviewMessage(outputLanguage, "configurationFix")}`
            : reviewMessage(outputLanguage, "failureNotice");
          await publishFailureNoticeAuthorized(
            github.publisher,
            run.id,
            () => authorizeMutation(github, "failure"),
            noticeBody,
          );
        },
        () => ({ isConfigurationError }),
        () => ({ published: true }),
      ).catch((publicationError: unknown) => {
        emit("review.failure_notice_failed", {
          errorKind: errorKind(publicationError),
        });
      });
    }

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
