import { describe, expect, it, vi } from "vitest";

import {
  createThinkWorkflowSubject,
  EvaluationSubjectError,
} from "../src/index.js";
import { createEvalCase, createPassingOutput } from "./fixtures.js";

const sourceRevision = "a".repeat(40);
const config = {
  accountId: "a".repeat(32),
  apiToken: "evaluation-token-long-enough",
  baseUrl: "https://evaluation.example.test/",
  evaluationRunId: "run-1",
  gatewayId: "holon",
  model: "dynamic/pr-review",
  pollIntervalMs: 100,
  sourceRevision,
  timeoutMs: 1_000,
} as const;
const started = {
  agentName: `eval-${"b".repeat(64)}`,
  sourceRevision,
  workflowId: "workflow-1",
};

describe("Think Workflow evaluation subject", () => {
  it("sends only controlled identifiers and returns a validated result", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(started))
      .mockResolvedValueOnce(
        Response.json({ result: createPassingOutput(), status: "complete" }),
      );
    const evaluationCase = createEvalCase();
    const subject = createThinkWorkflowSubject(config, fetchImplementation);

    await expect(
      subject({ caseId: evaluationCase.id, ...evaluationCase.input }),
    ).resolves.toEqual(createPassingOutput());
    const startRequest = fetchImplementation.mock.calls[0]?.[1];
    const requestBody = startRequest?.body;
    expect(typeof requestBody).toBe("string");
    if (typeof requestBody !== "string") throw new TypeError("missing body");
    expect(JSON.parse(requestBody)).toEqual({
      accountId: "a".repeat(32),
      caseId: evaluationCase.id,
      evaluationRunId: "run-1",
      gatewayId: "holon",
      modelReference: "dynamic/pr-review",
      sourceRevision,
    });
    expect(requestBody).not.toContain("return null");
    expect(startRequest?.headers).toMatchObject({
      authorization: "Bearer evaluation-token-long-enough",
    });
  });

  it("fails closed on deployment drift and safe remote failures", async () => {
    const evaluationCase = createEvalCase();
    const driftedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ ...started, sourceRevision: "b".repeat(40) }),
      );
    await expect(
      createThinkWorkflowSubject(
        config,
        driftedFetch,
      )({
        caseId: evaluationCase.id,
        ...evaluationCase.input,
      }),
    ).rejects.toEqual(new EvaluationSubjectError("provider_permanent"));

    const failedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(started))
      .mockResolvedValueOnce(
        Response.json({ reason: "model_output", status: "errored" }),
      );
    await expect(
      createThinkWorkflowSubject(
        config,
        failedFetch,
      )({
        caseId: evaluationCase.id,
        ...evaluationCase.input,
      }),
    ).rejects.toEqual(new EvaluationSubjectError("model_output"));
  });

  it("accepts only credential-free HTTPS endpoints and bounded metadata", () => {
    expect(() =>
      createThinkWorkflowSubject({
        ...config,
        baseUrl: "http://evaluation.example.test",
      }),
    ).toThrow(/credential-free HTTPS/u);
    expect(() =>
      createThinkWorkflowSubject({ ...config, apiToken: "short" }),
    ).toThrow(/token is invalid/u);
    expect(() =>
      createThinkWorkflowSubject({ ...config, evaluationRunId: "bad run" }),
    ).toThrow(/metadata is invalid/u);
    expect(() =>
      createThinkWorkflowSubject({ ...config, accountId: "not-an-account" }),
    ).toThrow(/account ID is invalid/u);
    expect(() =>
      createThinkWorkflowSubject({ ...config, gatewayId: "bad gateway" }),
    ).toThrow(/gateway ID is invalid/u);
    expect(() =>
      createThinkWorkflowSubject({ ...config, model: "direct/model" }),
    ).toThrow(/model reference is invalid/u);
  });
});
