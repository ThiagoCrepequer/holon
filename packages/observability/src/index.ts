import {
  diagnosticMessages,
  diagnosticReason,
  nativeErrorCode,
} from "./diagnostics.js";
export * from "./diagnostics.js";
/**
 * Error logs contain only explicit operational identifiers and typed error metadata.
 * Never pass exception messages, stacks, request bodies or arbitrary objects to logs.
 */
export interface ErrorContext {
  readonly component?: string | undefined;
  readonly operation?: string | undefined;
  readonly runId?: string | undefined;
  readonly prKey?: string | undefined;
  readonly workflowInstanceId?: string | undefined;
  readonly stepName?: string | undefined;
  readonly repositoryId?: number | undefined;
  readonly pullRequestNumber?: number | undefined;
  readonly installationId?: number | undefined;
  readonly messageId?: string | undefined;
  readonly deliveryId?: string | undefined;
  readonly batchSize?: number | undefined;
  readonly messageIndex?: number | undefined;
  readonly attempt?: number | undefined;
  readonly disposition?:
    | "ack"
    | "retry"
    | "quarantine"
    | "recovered"
    | undefined;
  readonly phase?: string | undefined;
}

export interface ErrorReporter {
  report(event: string, error: unknown, context?: ErrorContext): void;
}

export interface SafeErrorDetails {
  readonly errorReason?: string;
  readonly errorMessage?: string;
  readonly originCode?: string;
  readonly githubRequestId?: string;
  readonly errorName: string;
  readonly errorCode?: string;
  readonly errorPhase?: string;
  readonly statusCode?: number;
  readonly retryable?: boolean;
  readonly causeName?: string;
  readonly causeCode?: string;
  readonly causeStatusCode?: number;
  readonly causeRetryable?: boolean;
}

const textFields = [
  "component",
  "operation",
  "runId",
  "prKey",
  "workflowInstanceId",
  "stepName",
  "messageId",
  "deliveryId",
  "disposition",
  "phase",
] as const;
const numberFields = [
  "repositoryId",
  "pullRequestNumber",
  "installationId",
  "batchSize",
  "messageIndex",
  "attempt",
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function identifier(value: unknown, maxLength = 160): string | undefined {
  return typeof value === "string" &&
    value.length <= maxLength &&
    /^[A-Za-z0-9][A-Za-z0-9:._/-]*$/u.test(value)
    ? value
    : undefined;
}

function errorName(value: unknown): string {
  const name = identifier(value, 64);
  return name && /^[A-Za-z][A-Za-z0-9]*$/u.test(name) ? name : "UnknownError";
}

function statusCode(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : undefined;
}

function errorCode(value: unknown): string | undefined {
  return identifier(value, 80);
}

function oneError(error: unknown) {
  const value = record(error);
  if (!value) return { name: "UnknownError" };
  const status = statusCode(value.statusCode) ?? statusCode(value.status);
  const code =
    errorCode(value.code) ??
    (typeof value.message === "string" &&
    /^HOLON_[A-Z0-9_]+(?::[A-Za-z0-9_-]+){0,4}$/u.test(value.message)
      ? value.message
      : undefined);
  return {
    name: errorName(value.name),
    ...(code === undefined ? {} : { code }),
    ...(identifier(value.phase, 64) === undefined
      ? {}
      : { phase: identifier(value.phase, 64) }),
    ...(status === undefined ? {} : { status }),
    ...(typeof value.retryable === "boolean"
      ? { retryable: value.retryable }
      : {}),
  };
}

export function safeErrorDetails(error: unknown): SafeErrorDetails {
  const current = oneError(error);
  const nested =
    record(error)?.cause === undefined
      ? undefined
      : oneError(record(error)?.cause);
  const safeOrigin = identifier(record(error)?.originName, 64);
  const reason = diagnosticReason(record(error)?.reason);
  const originCode = nativeErrorCode(record(error)?.originCode);
  const requestId = record(error)?.githubRequestId;
  return {
    ...(reason
      ? { errorReason: reason, errorMessage: diagnosticMessages[reason] }
      : {}),
    ...(originCode ? { originCode } : {}),
    ...(typeof requestId === "string" && /^[A-Fa-f0-9:]{8,80}$/u.test(requestId)
      ? { githubRequestId: requestId }
      : {}),
    errorName: current.name,
    ...(current.code === undefined ? {} : { errorCode: current.code }),
    ...(!("phase" in current) || current.phase === undefined
      ? {}
      : { errorPhase: current.phase }),
    ...(current.status === undefined ? {} : { statusCode: current.status }),
    ...(current.retryable === undefined
      ? {}
      : { retryable: current.retryable }),
    ...(nested === undefined && safeOrigin === undefined
      ? {}
      : {
          causeName: safeOrigin ?? nested?.name ?? "UnknownError",
          ...(nested?.code === undefined ? {} : { causeCode: nested.code }),
          ...(nested?.status === undefined
            ? {}
            : { causeStatusCode: nested.status }),
          ...(nested?.retryable === undefined
            ? {}
            : { causeRetryable: nested.retryable }),
        }),
  };
}

function safeContext(context: ErrorContext): Record<string, string | number> {
  const source = record(context) ?? {};
  const result: Record<string, string | number> = {};
  for (const key of textFields) {
    const value = identifier(source[key]);
    if (value !== undefined) result[key] = value;
  }
  for (const key of numberFields) {
    const value = source[key];
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      result[key] = value;
    }
  }
  return result;
}

export const consoleErrorReporter: ErrorReporter = {
  report(event, error, context = {}) {
    const safeEvent = identifier(event, 100) ?? "diagnostics.invalid_event";
    console.error({
      severity: "error",
      event: safeEvent,
      errorId: crypto.randomUUID(),
      ...safeContext(context),
      ...safeErrorDetails(error),
    });
  },
};

/** Logging must never replace the original failure or change retry semantics. */
export function reportError(
  reporter: ErrorReporter,
  event: string,
  error: unknown,
  context: ErrorContext = {},
): void {
  try {
    reporter.report(event, error, context);
  } catch {
    // The caller retains its original failure and delivery decision.
  }
}

/** Use at an invocation or asynchronous boundary, not around every internal function. */
export async function withErrorReporting<T>(
  event: string,
  reporter: ErrorReporter,
  context: ErrorContext,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    reportError(reporter, event, error, context);
    throw error;
  }
}

export function withErrorReportingSync<T>(
  event: string,
  reporter: ErrorReporter,
  context: ErrorContext,
  operation: () => T,
): T {
  try {
    return operation();
  } catch (error) {
    reportError(reporter, event, error, context);
    throw error;
  }
}
