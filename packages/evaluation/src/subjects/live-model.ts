import type { ModelReviewer } from "@holon/application";
import {
  AiSdkReviewGenerator,
  GatewayModelReviewer,
  ModelProviderRequestError,
  RepositoryToolBudgetExceededError,
  TerminalToolReviewGenerator,
  createBoundedRepositoryToolRunner,
  nonRetryableModelFailureCode,
  parseGatewayModelReference,
  type CloudflareGatewayModelConfig,
  type ModelUsage,
  type RepositoryToolRunner,
} from "@holon/model";

import { evalSubjectOutputSchema } from "../contracts.js";
import { EvaluationSubjectError, type EvaluationSubject } from "../runner.js";

export interface LiveModelSubjectConfig extends Omit<
  CloudflareGatewayModelConfig,
  "metadata"
> {
  readonly evaluationRunId: string;
  readonly harness?:
    | "structured-output"
    | "structured-output-portable"
    | "terminal-tool";
  readonly sourceRevision: string;
}

export interface LiveModelSubjectDependencies {
  readonly createReviewer?: (
    caseId: string,
    onUsage: (usage: ModelUsage) => void,
  ) => ModelReviewer;
  readonly now?: () => number;
}

const metadataPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function validateLiveModelConfig(config: LiveModelSubjectConfig): void {
  if (!/^[a-f0-9]{32}$/u.test(config.accountId)) {
    throw new TypeError("live evaluation account ID is invalid");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(config.gatewayId)) {
    throw new TypeError("live evaluation gateway ID is invalid");
  }
  if (config.apiToken.length === 0 || config.apiToken.length > 4_096) {
    throw new TypeError("live evaluation API token is invalid");
  }
  if (
    !metadataPattern.test(config.evaluationRunId) ||
    !metadataPattern.test(config.sourceRevision)
  ) {
    throw new TypeError("live evaluation metadata is invalid");
  }
  parseGatewayModelReference(config.model);
}

export function createSelfContainedEvaluationTools(): RepositoryToolRunner {
  return {
    run: () =>
      Promise.resolve({
        content: JSON.stringify({
          reason: "self_contained_evaluation_case",
          status: "unavailable",
        }),
        truncated: false,
      }),
  };
}

export function createEvaluationModelReviewer(
  config: LiveModelSubjectConfig,
  caseId: string,
  onUsage: (usage: ModelUsage) => void,
): ModelReviewer {
  validateLiveModelConfig(config);
  const generatorConfig = {
    accountId: config.accountId,
    apiToken: config.apiToken,
    gatewayId: config.gatewayId,
    metadata: {
      case_id: caseId,
      evaluation_run_id: config.evaluationRunId,
      source_revision: config.sourceRevision,
      stage: "evaluation",
      harness: config.harness ?? "structured-output",
    },
    model: config.model,
  };
  const tools = createBoundedRepositoryToolRunner(
    createSelfContainedEvaluationTools(),
    12,
  );
  return new GatewayModelReviewer(
    config.harness === "terminal-tool"
      ? new TerminalToolReviewGenerator(generatorConfig, tools, onUsage)
      : new AiSdkReviewGenerator(
          generatorConfig,
          tools,
          onUsage,
          config.harness === "structured-output-portable"
            ? "portable"
            : "domain",
        ),
  );
}

function subjectFailure(error: unknown): EvaluationSubjectError {
  if (error instanceof ModelProviderRequestError) {
    return new EvaluationSubjectError(
      error.isRetryable ? "provider_transient" : "provider_permanent",
    );
  }
  if (error instanceof RepositoryToolBudgetExceededError) {
    return new EvaluationSubjectError("tool_budget");
  }
  const failureCode = nonRetryableModelFailureCode(error);
  if (failureCode === "provider_permanent") {
    return new EvaluationSubjectError("provider_permanent");
  }
  if (failureCode === "tool_budget_exhausted") {
    return new EvaluationSubjectError("tool_budget");
  }
  if (failureCode !== undefined) {
    return new EvaluationSubjectError("model_output");
  }
  return new EvaluationSubjectError("unknown");
}

export function createLiveModelSubject(
  config: LiveModelSubjectConfig,
  dependencies: LiveModelSubjectDependencies = {},
): EvaluationSubject {
  validateLiveModelConfig(config);
  return async ({ caseId, context, job }) => {
    const attempts: ModelUsage[] = [];
    const now =
      dependencies.now ?? (() => Math.round(globalThis.performance.now()));
    const startedAt = now();
    const reviewer =
      dependencies.createReviewer?.(caseId, (usage) => attempts.push(usage)) ??
      createEvaluationModelReviewer(config, caseId, (usage) =>
        attempts.push(usage),
      );
    try {
      const result = await reviewer.review(job, context);
      return evalSubjectOutputSchema.parse({
        output: result.output,
        partial: context.truncated || result.promptTruncated,
        telemetry: {
          attempts,
          durationMs: now() - startedAt,
        },
      });
    } catch (error) {
      throw subjectFailure(error);
    }
  };
}
