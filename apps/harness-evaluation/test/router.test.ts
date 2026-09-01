import { describe, expect, it, vi } from "vitest";

import { createHarnessEvaluationHandler } from "../src/router.js";

const token = "test-evaluation-token-long-enough";
const sourceRevision = "a".repeat(40);
const environment = {
  AI_GATEWAY_ACCOUNT_ID: "a".repeat(32),
  AI_GATEWAY_ID: "holon",
  AI_MODEL_ID: "dynamic/pr-review",
  SOURCE_REVISION: sourceRevision,
  THINK_EVALUATION_API_TOKEN: token,
};
const validResult = {
  output: { findings: [], summary: "No supported regression was found." },
  partial: false,
};

function request(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://evaluation.example.test${path}`, {
    ...init,
    headers,
  });
}

describe("harness evaluation router", () => {
  it("authenticates before resolving an agent", async () => {
    const resolve = vi.fn();
    const handler = createHarnessEvaluationHandler(environment, resolve);

    const response = await handler(
      new Request("https://evaluation.example.test/runs"),
    );

    expect(response.status).toBe(401);
    expect(resolve).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("starts only embedded cases at the deployed source revision", async () => {
    const startReview = vi.fn((_input, workflowId: string) =>
      Promise.resolve(workflowId),
    );
    const resolve = vi.fn(() =>
      Promise.resolve({
        reviewStatus: vi.fn(),
        startReview,
      }),
    );
    const handler = createHarnessEvaluationHandler(environment, resolve);
    const body = JSON.stringify({
      accountId: "a".repeat(32),
      caseId: "correctness.confidence-threshold-regression",
      evaluationRunId: "run-1",
      gatewayId: "holon",
      modelReference: "dynamic/pr-review",
      sourceRevision,
    });

    const response = await handler(request("/runs", { body, method: "POST" }));
    const result = (await response.json()) as Record<string, string>;

    expect(response.status).toBe(200);
    expect(result.agentName).toMatch(/^eval-[a-f0-9]{64}$/u);
    expect(result.workflowId).toBe(
      `review-${result.agentName?.slice("eval-".length)}`,
    );
    expect(startReview).toHaveBeenCalledWith(
      JSON.parse(body),
      result.workflowId,
    );

    for (const invalidBody of [
      { ...JSON.parse(body), modelReference: "dynamic/other-route" },
      { ...JSON.parse(body), caseId: "unknown.case" },
      { ...JSON.parse(body), sourceRevision: "b".repeat(40) },
    ]) {
      const rejected = await handler(
        request("/runs", {
          body: JSON.stringify(invalidBody),
          method: "POST",
        }),
      );
      expect(rejected.status).toBe(409);
    }
  });

  it("returns validated status only for a matching deterministic identity", async () => {
    const reviewStatus = vi.fn(() =>
      Promise.resolve({ result: validResult, status: "complete" as const }),
    );
    const handler = createHarnessEvaluationHandler(environment, async () => ({
      reviewStatus,
      startReview: vi.fn(),
    }));
    const hash = "b".repeat(64);

    const response = await handler(
      request(`/runs/eval-${hash}/review-${hash}`),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: validResult,
      status: "complete",
    });
    expect(reviewStatus).toHaveBeenCalledWith(`review-${hash}`);

    const mismatched = await handler(
      request(`/runs/eval-${hash}/review-${"c".repeat(64)}`),
    );
    expect(mismatched.status).toBe(404);
  });

  it("bounds and validates request bodies without reflecting parser errors", async () => {
    const handler = createHarnessEvaluationHandler(environment, vi.fn());
    const malformed = await handler(
      request("/runs", { body: "{", method: "POST" }),
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({
      error: "invalid_run_request",
    });

    const oversized = await handler(
      request("/runs", {
        body: JSON.stringify({ value: "x".repeat(4_096) }),
        method: "POST",
      }),
    );
    expect(oversized.status).toBe(400);
  });

  it("classifies agent startup failures as unavailable infrastructure", async () => {
    const handler = createHarnessEvaluationHandler(environment, async () => ({
      reviewStatus: vi.fn(),
      startReview: vi.fn(() => Promise.reject(new Error("private failure"))),
    }));

    const response = await handler(
      request("/runs", {
        body: JSON.stringify({
          accountId: "a".repeat(32),
          caseId: "correctness.confidence-threshold-regression",
          evaluationRunId: "run-1",
          gatewayId: "holon",
          modelReference: "dynamic/pr-review",
          sourceRevision,
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "run_unavailable",
    });
  });
});
