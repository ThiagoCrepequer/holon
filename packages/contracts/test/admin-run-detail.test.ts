import { describe, expect, it } from "vitest";

import {
  adminCiSummarySchema,
  adminFindingSummarySchema,
  adminReadRequestSchema,
  adminRunDetailSchema,
  truncateUtf8Bytes,
  type AdminRunDetail,
} from "../src/index.js";

const sha = "c".repeat(40);
const prKey = "github:10:pr:3" as const;
const runId = `${prKey}:head:${sha}:base:${"b".repeat(40)}` as const;

describe("admin run detail contracts", () => {
  it("validates full admin run detail DTO", () => {
    const detail: AdminRunDetail = {
      cleanupTask: null,
      historicalRunFindings: null,
      stepExecutions: [],
      currentFindings: [
        {
          diagnostic: "Potential SQL injection in query builder parameter.",
          filePath: "src/db/query.ts",
          fingerprint: `fp:${"1".repeat(64)}`,
          line: 42,
          severity: "high",
          status: "persistent",
          updatedAt: "2026-09-04T12:00:00.000Z",
        },
      ],
      configuration: null,
      findingsPerspective: "current_pr_state",
      run: {
        runState: "completed",
        cost: {
          currency: "USD",
          estimatedCostMicroUsd: 20000,
          estimatedCostUsd: 0.02,
          pricingModel: "openrouter/anthropic/claude-3.5-sonnet",
        },
        headSha: sha,
        isDegraded: false,
        prKey,
        runId,
        scopeStatus: "complete",
        shardsCount: 1,
        stepTimings: [
          {
            attempt: 1,
            durationMs: 1200,
            status: "success",
            stepName: "analyze-review",
          },
        ],
        terminalState: "completed",
        tokens: {
          inputTokens: 2500,
          outputTokens: 400,
          reasoningTokens: 0,
          totalTokens: 2900,
        },
        toolCallsCount: 2,
        verdict: "REQUEST_CHANGES",
      },
      projectIdentification: null,
      structuredCi: {
        durationMs: 45000,
        failed: 0,
        passed: 120,
        skipped: 2,
        status: "available",
        total: 122,
        workflowName: "CI Test Suite",
      },
    };

    expect(
      adminRunDetailSchema.safeParse({ ...detail, schemaVersion: 1 }).success,
    ).toBe(false);
    const parsed = adminRunDetailSchema.parse(detail);
    expect(parsed).toEqual(detail);
  });

  it("validates run detail with null structuredCi, verdict and scopeStatus", () => {
    const detail: AdminRunDetail = {
      cleanupTask: null,
      historicalRunFindings: null,
      stepExecutions: [],
      currentFindings: [],
      configuration: null,
      findingsPerspective: "current_pr_state",
      run: {
        runState: "completed",
        cost: {
          currency: "USD",
          estimatedCostMicroUsd: 0,
          estimatedCostUsd: 0,
          pricingModel: "none",
        },
        headSha: sha,
        isDegraded: true,
        prKey,
        runId,
        scopeStatus: null,
        shardsCount: 0,
        stepTimings: [],
        terminalState: "failed_terminal",
        tokens: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
        toolCallsCount: 0,
        verdict: null,
      },
      projectIdentification: null,
      structuredCi: null,
    };

    const parsed = adminRunDetailSchema.parse(detail);
    expect(parsed.structuredCi).toBeNull();
    expect(parsed.run.scopeStatus).toBeNull();
    expect(parsed.run.verdict).toBeNull();
  });

  it("validates finding summary schema directly", () => {
    const finding = {
      diagnostic: "Potential SQL injection in query builder parameter.",
      filePath: "src/db/query.ts",
      fingerprint: `fp:${"1".repeat(64)}`,
      line: 42,
      severity: "high",
      status: "persistent",
      updatedAt: "2026-09-04T12:00:00.000Z",
    };
    expect(adminFindingSummarySchema.parse(finding)).toEqual(finding);
  });

  it("validates structured CI summary schema directly", () => {
    const ci = {
      durationMs: 45000,
      failed: 0,
      passed: 120,
      skipped: 2,
      status: "available",
      total: 122,
      workflowName: "CI Test Suite",
    };
    expect(adminCiSummarySchema.parse(ci)).toEqual(ci);
  });

  it("validates read request schema", () => {
    const valid = { runId };
    expect(adminReadRequestSchema.parse(valid)).toEqual(valid);

    expect(() => adminReadRequestSchema.parse({ runId: "invalid" })).toThrow();
  });
});

describe("truncateUtf8Bytes", () => {
  it("leaves string under max bytes unchanged", () => {
    expect(truncateUtf8Bytes("hello world", 20)).toBe("hello world");
  });

  it("truncates ascii text with ellipsis when exceeding max bytes", () => {
    const truncated = truncateUtf8Bytes("hello world! this is long text", 15);
    expect(new TextEncoder().encode(truncated).length).toBeLessThanOrEqual(15);
    expect(truncated.endsWith("…")).toBe(true);
  });

  it("never cuts multibyte UTF-8 characters across boundary", () => {
    // 'café' has 'é' as 2 bytes (c:1, a:1, f:1, é:2 = 5 bytes).
    // ellipsis '…' is 3 bytes in UTF-8.
    const input = "café delícia";
    const truncated = truncateUtf8Bytes(input, 8); // 8 bytes: max 5 bytes for content + 3 for '…'
    expect(new TextEncoder().encode(truncated).length).toBeLessThanOrEqual(8);
    expect(truncated.endsWith("…")).toBe(true);
    // Should be valid UTF-8 string without replacement chars
    expect(truncated).not.toContain("\uFFFD");
  });

  it("handles emojis without splitting surrogate pairs", () => {
    const input = "test 🚀 rocket 🔥 fire";
    const truncated = truncateUtf8Bytes(input, 12);
    expect(new TextEncoder().encode(truncated).length).toBeLessThanOrEqual(12);
    expect(truncated.endsWith("…")).toBe(true);
    // ensure no broken surrogate
    expect(Array.from(truncated).join("")).toBe(truncated);
  });
});
