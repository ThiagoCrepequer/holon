import { EvaluationSubjectError, type EvaluationSubject } from "../runner.js";
import {
  thinkEvaluationStartResponseSchema,
  thinkEvaluationStatusResponseSchema,
} from "../think-protocol.js";

export interface ThinkWorkflowSubjectConfig {
  readonly apiToken: string;
  readonly baseUrl: string;
  readonly evaluationRunId: string;
  readonly pollIntervalMs?: number;
  readonly sourceRevision: string;
  readonly timeoutMs?: number;
}

const metadataPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

function validatedBaseUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new TypeError(
      "Think evaluation URL must be a credential-free HTTPS URL",
    );
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function validateConfig(config: ThinkWorkflowSubjectConfig): URL {
  if (config.apiToken.length < 16 || config.apiToken.length > 4_096) {
    throw new TypeError("Think evaluation API token is invalid");
  }
  if (
    !metadataPattern.test(config.evaluationRunId) ||
    !metadataPattern.test(config.sourceRevision)
  ) {
    throw new TypeError("Think evaluation metadata is invalid");
  }
  const pollIntervalMs = config.pollIntervalMs ?? 1_000;
  const timeoutMs = config.timeoutMs ?? 180_000;
  if (
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 100 ||
    pollIntervalMs > 10_000 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < pollIntervalMs ||
    timeoutMs > 600_000
  ) {
    throw new TypeError("Think evaluation polling configuration is invalid");
  }
  return validatedBaseUrl(config.baseUrl);
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new EvaluationSubjectError(
      response.status >= 500 ? "provider_transient" : "provider_permanent",
    );
  }
  return await response.json();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createThinkWorkflowSubject(
  config: ThinkWorkflowSubjectConfig,
  fetchImplementation: typeof fetch = fetch,
): EvaluationSubject {
  const baseUrl = validateConfig(config);
  const headers = {
    authorization: `Bearer ${config.apiToken}`,
    "content-type": "application/json",
  };
  const pollIntervalMs = config.pollIntervalMs ?? 1_000;
  const timeoutMs = config.timeoutMs ?? 180_000;
  return async ({ caseId }) => {
    const startResponse = await fetchImplementation(new URL("runs", baseUrl), {
      body: JSON.stringify({
        caseId,
        evaluationRunId: config.evaluationRunId,
        sourceRevision: config.sourceRevision,
      }),
      headers,
      method: "POST",
    });
    const started = thinkEvaluationStartResponseSchema.parse(
      await readJson(startResponse),
    );
    if (started.sourceRevision !== config.sourceRevision) {
      throw new EvaluationSubjectError("provider_permanent");
    }
    const statusUrl = new URL(
      `runs/${encodeURIComponent(started.agentName)}/${encodeURIComponent(started.workflowId)}`,
      baseUrl,
    );
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await fetchImplementation(statusUrl, {
        headers: { authorization: headers.authorization },
      });
      const status = thinkEvaluationStatusResponseSchema.parse(
        await readJson(response),
      );
      if (status.status === "complete") return status.result;
      if (status.status === "errored") {
        throw new EvaluationSubjectError(status.reason);
      }
      await delay(pollIntervalMs);
    }
    throw new EvaluationSubjectError("provider_transient");
  };
}
