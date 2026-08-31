import type { ModelReviewer } from "@holon/application";
import {
  ModelProviderRequestError,
  RepositoryToolBudgetExceededError,
  type ModelUsage,
} from "@holon/model";
import { describe, expect, it, vi } from "vitest";

import {
  createEvaluationModelReviewer,
  createLiveModelSubject,
  createSelfContainedEvaluationTools,
  evalSubjectOutputSchema,
  EvaluationSubjectError,
} from "../src/index.js";
import { createEvalCase, createPassingOutput } from "./fixtures.js";

const config = {
  accountId: "a".repeat(32),
  apiToken: "token-not-logged",
  evaluationRunId: "run-1",
  gatewayId: "holon",
  model: "dynamic/pr-review",
  sourceRevision: "a".repeat(40),
} as const;

function failingReviewer(error: unknown): ModelReviewer {
  return {
    async review() {
      throw error;
    },
  };
}

describe("createLiveModelSubject", () => {
  it("returns model output with bounded usage telemetry", async () => {
    const evalCase = createEvalCase();
    const output = evalSubjectOutputSchema.parse(createPassingOutput());
    const usage: ModelUsage = {
      attempt: "investigation",
      finishReason: "stop",
      inputTokens: 100,
      outputTokens: 20,
      toolCallCount: 0,
      totalTokens: 120,
    };
    const now = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(25);
    const subject = createLiveModelSubject(config, {
      createReviewer: (_caseId, onUsage) => ({
        review: () => {
          onUsage(usage);
          return Promise.resolve({
            output: output.output,
            promptTruncated: false,
          });
        },
      }),
      now,
    });

    await expect(
      subject({ caseId: evalCase.id, ...evalCase.input }),
    ).resolves.toMatchObject({
      partial: false,
      telemetry: { attempts: [usage], durationMs: 15 },
    });
  });

  it.each([
    [new ModelProviderRequestError(true, 503), "provider_transient"],
    [new ModelProviderRequestError(false, 401), "provider_permanent"],
    [new RepositoryToolBudgetExceededError(1), "tool_budget"],
    [
      Object.assign(new Error("permanent"), { name: "ModelPermanentError" }),
      "provider_permanent",
    ],
    [
      Object.assign(new Error("budget"), {
        name: "RepositoryToolBudgetExceededError",
      }),
      "tool_budget",
    ],
    [Object.assign(new Error("invalid"), { name: "ZodError" }), "model_output"],
    [new Error("arbitrary provider content"), "unknown"],
  ] as const)("maps model failures to a safe reason", async (error, reason) => {
    const evalCase = createEvalCase();
    const subject = createLiveModelSubject(config, {
      createReviewer: () => failingReviewer(error),
    });

    await expect(
      subject({ caseId: evalCase.id, ...evalCase.input }),
    ).rejects.toEqual(new EvaluationSubjectError(reason));
  });

  it("constructs the production reviewer and exposes no fixture repository tools", async () => {
    const reviewer = createEvaluationModelReviewer(
      config,
      "case-1",
      () => undefined,
    );
    expect(reviewer).toHaveProperty("review");
    await expect(
      createSelfContainedEvaluationTools().run({
        arguments: { path: "src/index.ts", startLine: 1 },
        name: "read_file",
      }),
    ).resolves.toEqual({
      content:
        '{"reason":"self_contained_evaluation_case","status":"unavailable"}',
      truncated: false,
    });
  });

  it("rejects malformed live configuration before making a provider call", () => {
    expect(() =>
      createLiveModelSubject({ ...config, accountId: "not-an-account-id" }),
    ).toThrow(/account ID is invalid/u);
    expect(() =>
      createLiveModelSubject({ ...config, model: "provider/model" }),
    ).toThrow(/dynamic route format/u);
    expect(() =>
      createLiveModelSubject({ ...config, gatewayId: "invalid gateway" }),
    ).toThrow(/gateway ID is invalid/u);
    expect(() => createLiveModelSubject({ ...config, apiToken: "" })).toThrow(
      /API token is invalid/u,
    );
    expect(() =>
      createLiveModelSubject({ ...config, evaluationRunId: "invalid run" }),
    ).toThrow(/metadata is invalid/u);
  });
});
