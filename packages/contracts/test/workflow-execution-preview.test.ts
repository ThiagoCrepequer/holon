import { describe, expect, it } from "vitest";

import {
  adminRunDetailSchema,
  claimRunSanitizedInputSchema,
  claimRunSanitizedOutputSchema,
  prepareRepositorySanitizedInputSchema,
  prepareRepositorySanitizedOutputSchema,
  analyzeReviewSanitizedInputSchema,
  analyzeReviewSanitizedOutputSchema,
  publishInlineSanitizedInputSchema,
  publishInlineSanitizedOutputSchema,
  publishSummarySanitizedInputSchema,
  publishSummarySanitizedOutputSchema,
  completeRunSanitizedInputSchema,
  completeRunSanitizedOutputSchema,
  sanitizePayloadRecord,
  stepAttemptTelemetrySchema,
  stepExecutionNodeSchema,
  type AdminRunDetail,
} from "../src/index.js";

const sha = "a".repeat(40);
const prKey = "github:42:pr:7" as const;
const runId = `${prKey}:head:${sha}` as const;

describe("workflow-execution-preview contracts", () => {
  it("validates stepAttemptTelemetrySchema", () => {
    const attempt = {
      attempt: 1,
      durationMs: 450,
      endedAt: "2026-09-04T12:00:01.000Z",
      errorCode: null,
      startedAt: "2026-09-04T12:00:00.000Z",
      status: "completed" as const,
      waitBeforeRetryMs: null,
    };
    expect(stepAttemptTelemetrySchema.parse(attempt)).toEqual(attempt);
  });

  it("validates stepExecutionNodeSchema with multiple attempts", () => {
    const node = {
      attempts: [
        {
          attempt: 1,
          durationMs: 300,
          endedAt: "2026-09-04T12:00:00.300Z",
          errorCode: "SandboxRateLimitError",
          startedAt: "2026-09-04T12:00:00.000Z",
          status: "failed" as const,
          waitBeforeRetryMs: 1000,
        },
        {
          attempt: 2,
          durationMs: 1200,
          endedAt: "2026-09-04T12:00:02.500Z",
          errorCode: null,
          startedAt: "2026-09-04T12:00:01.300Z",
          status: "completed" as const,
          waitBeforeRetryMs: null,
        },
      ],
      attemptsCount: 2,
      errorCode: null,
      firstStartedAt: "2026-09-04T12:00:00.000Z",
      lastEndedAt: "2026-09-04T12:00:02.500Z",
      phase: "analysis" as const,
      sanitizedInput: { modelRoute: "deepseek-chat", toolsBudget: 10 },
      sanitizedOutput: { findingsCount: 1, promptTruncated: false },
      status: "completed" as const,
      stepName: "analyze-review",
      totalDurationMs: 1500,
    };
    expect(stepExecutionNodeSchema.parse(node)).toEqual(node);
  });

  it("validates per-step sanitized input and output schemas", () => {
    const claimInput = {
      attempt: 1,
      baseSha: "b".repeat(40),
      causalVersion: "2026-09-04T12:00:00.000Z",
      headSha: sha,
      prKey,
      runId,
    };
    expect(claimRunSanitizedInputSchema.parse(claimInput)).toEqual(claimInput);
    expect(
      claimRunSanitizedOutputSchema.parse({
        outcome: "claimed",
        supersededCount: 0,
      }),
    ).toEqual({
      outcome: "claimed",
      supersededCount: 0,
    });

    const prepInput = {
      baseSha: "b".repeat(40),
      headSha: sha,
      repoName: "holon",
      repoOwner: "acme",
    };
    expect(prepareRepositorySanitizedInputSchema.parse(prepInput)).toEqual(
      prepInput,
    );
    expect(
      prepareRepositorySanitizedOutputSchema.parse({
        changedLineCount: 80,
        contextBytes: 15000,
        fileCount: 4,
        structuralFilesCount: 3,
        textualFilesCount: 1,
        truncated: false,
      }),
    ).toBeDefined();

    const analyzeInput = {
      estimatedTokens: 3000,
      modelRoute: "deepseek-chat",
      structuralFilesCount: 3,
      textualFilesCount: 1,
      toolsBudget: 10,
    };
    expect(analyzeReviewSanitizedInputSchema.parse(analyzeInput)).toEqual(
      analyzeInput,
    );
    expect(
      analyzeReviewSanitizedOutputSchema.parse({
        findingsCount: 1,
        findingsExcerptList: [
          {
            line: 42,
            path: "src/auth.ts",
            rule: "no-raw-secrets",
            severity: "high",
          },
        ],
        promptTruncated: false,
        summary: "One security defect found.",
      }),
    ).toBeDefined();

    expect(
      publishInlineSanitizedInputSchema.parse({
        line: 42,
        marker: "holon-finding-1",
        path: "src/auth.ts",
        side: "RIGHT",
      }),
    ).toBeDefined();
    expect(
      publishInlineSanitizedOutputSchema.parse({
        authorized: true,
        githubCommentId: 10849,
        published: true,
      }),
    ).toBeDefined();

    expect(
      publishSummarySanitizedInputSchema.parse({
        marker: "holon-summary",
        verdict: "REQUEST_CHANGES",
      }),
    ).toBeDefined();
    expect(
      publishSummarySanitizedOutputSchema.parse({
        authorized: true,
        githubCommentId: 10850,
        published: true,
      }),
    ).toBeDefined();

    expect(
      completeRunSanitizedInputSchema.parse({
        nextState: "completed",
        runId,
      }),
    ).toBeDefined();
    expect(
      completeRunSanitizedOutputSchema.parse({
        cleanupTaskScheduled: true,
        state: "completed",
      }),
    ).toBeDefined();
  });

  it("sanitizePayloadRecord enforces forbidden keys and size limit", () => {
    expect(sanitizePayloadRecord(null)).toBeNull();
    expect(sanitizePayloadRecord(undefined)).toBeNull();
    expect(sanitizePayloadRecord([1, 2, 3])).toBeNull();

    const safeObj = { filesAnalyzed: 4, linesChanged: 100 };
    expect(sanitizePayloadRecord(safeObj)).toEqual(safeObj);

    // Rejects authorization / auth / token / secret / diff / prompt
    expect(() =>
      sanitizePayloadRecord({ Authorization: "Bearer token" }),
    ).toThrow("forbidden");
    expect(() =>
      sanitizePayloadRecord({ nested: { rawPrompt: "You are an AI..." } }),
    ).toThrow("forbidden");
    expect(() =>
      sanitizePayloadRecord({ gitDiff: "--- a/file\n+++ b/file" }),
    ).toThrow("forbidden");
    expect(() => sanitizePayloadRecord({ private_key: "MIIE..." })).toThrow(
      "forbidden",
    );

    // Rejects payloads exceeding limit
    const hugeObj = { data: "x".repeat(20000) };
    expect(() => sanitizePayloadRecord(hugeObj, 1000)).toThrow("exceeds");

    // Handles circular references gracefully without stack overflow
    const circularObj: Record<string, unknown> = {
      action: "test",
      count: 5,
    };
    circularObj.self = circularObj;
    const sanitizedCircular = sanitizePayloadRecord(circularObj);
    expect(sanitizedCircular).not.toBeNull();
    expect(sanitizedCircular?.action).toBe("test");
    expect(sanitizedCircular?.self).toBe("[Circular]");
  });

  it("validates adminRunDetailSchema with in-progress run", () => {
    const runningDetail: AdminRunDetail = {
      cleanupTask: null,
      currentFindings: [],
      findingsPerspective: "current_pr_state",
      historicalRunFindings: [],
      projectIdentification: null,
      run: {
        cost: null,
        headSha: sha,
        isDegraded: false,
        prKey,
        runId,
        runState: "running",
        scopeStatus: null,
        shardsCount: 1,
        stepTimings: [],
        terminalState: null,
        tokens: null,
        toolCallsCount: 0,
        verdict: null,
      },
      stepExecutions: [
        {
          attempts: [
            {
              attempt: 1,
              durationMs: 18,
              endedAt: "2026-09-04T12:00:00.018Z",
              errorCode: null,
              startedAt: "2026-09-04T12:00:00.000Z",
              status: "completed",
              waitBeforeRetryMs: null,
            },
          ],
          attemptsCount: 1,
          errorCode: null,
          firstStartedAt: "2026-09-04T12:00:00.000Z",
          lastEndedAt: "2026-09-04T12:00:00.018Z",
          phase: "admission",
          sanitizedInput: { runId },
          sanitizedOutput: { outcome: "claimed" },
          status: "completed",
          stepName: "claim-run",
          totalDurationMs: 18,
        },
      ],
      structuredCi: null,
    };

    const parsed = adminRunDetailSchema.parse(runningDetail);
    expect(parsed.run.runState).toBe("running");
    expect(parsed.run.terminalState).toBeNull();
    expect(parsed.stepExecutions).toHaveLength(1);
    expect(parsed.run.runState).toBe("running");
    expect(
      adminRunDetailSchema.parse({
        ...runningDetail,
        historicalRunFindings: null,
      }).historicalRunFindings,
    ).toBeNull();
  });

  it("validates adminRunDetailSchema with completed run and cleanup task", () => {
    const completedDetail: AdminRunDetail = {
      cleanupTask: {
        attempts: 1,
        completedAt: "2026-09-04T12:00:10.000Z",
        nextAttemptAt: null,
        requestedAt: "2026-09-04T12:00:08.000Z",
        state: "completed",
      },
      currentFindings: [],
      findingsPerspective: "both",
      historicalRunFindings: [],
      projectIdentification: null,
      run: {
        cost: {
          currency: "USD",
          estimatedCostMicroUsd: 1200,
          estimatedCostUsd: 0.0012,
          pricingModel: "deepseek-chat",
        },
        headSha: sha,
        isDegraded: false,
        prKey,
        runId,
        runState: "completed",
        scopeStatus: "complete",
        shardsCount: 1,
        stepTimings: [],
        terminalState: "completed",
        tokens: {
          inputTokens: 1000,
          outputTokens: 200,
          reasoningTokens: 0,
          totalTokens: 1200,
        },
        toolCallsCount: 1,
        verdict: "APPROVE",
      },
      stepExecutions: [],
      structuredCi: null,
    };

    const parsed = adminRunDetailSchema.parse(completedDetail);
    expect(parsed.cleanupTask?.state).toBe("completed");
    expect(parsed.run.runState).toBe("completed");
  });
});
