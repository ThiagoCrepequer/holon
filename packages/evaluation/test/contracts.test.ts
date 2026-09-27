import { describe, expect, it } from "vitest";

import { evalCaseSchema, evalRunConfigurationSchema } from "../src/index.js";
import { createEvalCase, evaluationConfiguration } from "./fixtures.js";

describe("evalRunConfigurationSchema", () => {
  it("requires a model reference only for live-model evaluations", () => {
    expect(() =>
      evalRunConfigurationSchema.parse({
        ...evaluationConfiguration,
        mode: "live-model",
      }),
    ).toThrow(/must identify a model reference/u);
    expect(() =>
      evalRunConfigurationSchema.parse({
        ...evaluationConfiguration,
        modelReference: "dynamic/pr-review",
      }),
    ).toThrow(/must identify a model reference/u);
    expect(
      evalRunConfigurationSchema.parse({
        ...evaluationConfiguration,
        mode: "live-model",
        modelReference: "dynamic/pr-review",
      }),
    ).toMatchObject({ mode: "live-model" });
  });
});

describe("evalCaseSchema", () => {
  it("accepts a reviewed synthetic case", () => {
    expect(evalCaseSchema.parse(createEvalCase()).id).toBe(createEvalCase().id);
  });

  it("requires license and HTTPS provenance for public cases", () => {
    const evalCase = createEvalCase();
    expect(() =>
      evalCaseSchema.parse({
        ...evalCase,
        source: {
          kind: "public",
          license: "MIT",
          reviewedAt: "2026-08-31",
          url: "http://example.com/case",
        },
      }),
    ).toThrow();
    expect(() =>
      evalCaseSchema.parse({
        ...evalCase,
        source: {
          kind: "public",
          reviewedAt: "2026-08-31",
          url: "https://example.com/case",
        },
      }),
    ).toThrow();
  });

  it("rejects credentials embedded in public provenance URLs", () => {
    const evalCase = createEvalCase();
    expect(() =>
      evalCaseSchema.parse({
        ...evalCase,
        source: {
          kind: "public",
          license: "MIT",
          reviewedAt: "2026-08-31",
          url: "https://user:password@example.com/case",
        },
      }),
    ).toThrow(/must not contain credentials/u);
  });

  it("rejects duplicate expected finding identifiers", () => {
    const evalCase = createEvalCase();
    expect(() =>
      evalCaseSchema.parse({
        ...evalCase,
        expected: {
          ...evalCase.expected,
          findings: [
            evalCase.expected.findings[0],
            evalCase.expected.findings[0],
          ],
        },
      }),
    ).toThrow(/finding ids must be unique/u);
  });

  it("caps expectations at the current publication contract", () => {
    const evalCase = createEvalCase();
    const finding = evalCase.expected.findings[0];
    if (finding === undefined)
      throw new TypeError("fixture finding is required");

    expect(() =>
      evalCaseSchema.parse({
        ...evalCase,
        expected: {
          ...evalCase.expected,
          findings: [
            finding,
            { ...finding, id: "second" },
            { ...finding, id: "third" },
            { ...finding, id: "fourth" },
          ],
        },
      }),
    ).toThrow();
  });

  it("rejects an expected finding outside the canonical changed lines", () => {
    const evalCase = createEvalCase();
    expect(() =>
      evalCaseSchema.parse({
        ...evalCase,
        expected: {
          ...evalCase.expected,
          findings: [
            {
              ...evalCase.expected.findings[0],
              location: {
                line: 11,
                path: "src/index.ts",
                side: "RIGHT",
              },
            },
          ],
        },
      }),
    ).toThrow(/target a changed line/u);
  });

  it("rejects case-insensitive duplicate diagnostic terms", () => {
    const evalCase = createEvalCase();
    expect(() =>
      evalCaseSchema.parse({
        ...evalCase,
        expected: {
          ...evalCase.expected,
          requiredSummaryTerms: ["Finding", "finding"],
        },
      }),
    ).toThrow(/terms must be unique/u);
  });

  it.each(["headSha", "baseSha"] as const)(
    "rejects a run identity for a different %s",
    (field) => {
      const evalCase = createEvalCase();
      expect(() =>
        evalCaseSchema.parse({
          ...evalCase,
          input: {
            ...evalCase.input,
            job: {
              ...evalCase.input.job,
              envelope: {
                ...evalCase.input.job.envelope,
                pullRequest: {
                  ...evalCase.input.job.envelope.pullRequest,
                  [field]: "c".repeat(40),
                },
              },
            },
          },
        }),
      ).toThrow(/runId does not match the webhook coordinates/u);
    },
  );
});
