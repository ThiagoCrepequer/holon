import { modelReviewOutputSchema } from "@holon/contracts";
import { MockLanguageModelV3 } from "ai/test";
import { expect, it, vi } from "vitest";
const provider = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: () => provider.model,
}));
import { TwoPhaseReviewGenerator } from "../src/ai-sdk.js";
import { createFinalizationEvidenceCatalog } from "../src/host-context.js";
const output = { findings: [], summary: "Analysis complete" };
const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 10, text: 10, reasoning: 0 },
  },
  warnings: [],
});
const request = {
  instructions: "Review",
  prompt: "private patch",
  evidenceCandidates: [],
};
function generator(model: MockLanguageModelV3) {
  provider.model.mockReturnValue(model);
  return new TwoPhaseReviewGenerator(
    {
      accountId: "account",
      apiToken: "secret",
      gatewayId: "gateway",
      model: "dynamic/review",
    },
    { run: async () => ({ content: "", truncated: false }) },
  );
}
const referenceCandidates = [1, 2, 3].map((line) => ({
  path: "src/retry.ts",
  startLine: line,
  endLine: line,
  excerpt: `const attempt${line} = ${line};`,
}));

it("uses real SDK structured output to hydrate all three evidence entries from the host", async () => {
  const catalog = await createFinalizationEvidenceCatalog(
    referenceCandidates,
    "Checked retry",
  );
  const referenceFinding = {
    confidence: 0.95,
    diagnostic: "The retry limit includes one extra attempt.",
    severity: "high",
    suggestion: null,
    location: { anchorId: catalog[0]!.id },
    evidence: catalog.map(({ id }) => ({
      id,
      reason: "Supports the retry diagnosis",
    })),
  };
  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () =>
      textResult(
        call++ === 0
          ? "Checked retry without quoting any source"
          : JSON.stringify({
              findings: [referenceFinding],
              summary: "Checked retry",
            }),
      ),
  });
  const result = modelReviewOutputSchema.parse(
    await generator(model).generate({
      ...request,
      evidenceCandidates: referenceCandidates,
    }),
  );
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]?.evidence.map(({ excerpt }) => excerpt)).toEqual(
    referenceCandidates.map(({ excerpt }) => excerpt),
  );
  expect(result.isDegraded).not.toBe(true);
  expect(call).toBe(2);
});

it("recovers rejected free-text evidence through the same catalog and reference contract", async () => {
  const catalog = await createFinalizationEvidenceCatalog(
    referenceCandidates,
    "Checked retry",
  );
  const finding = {
    confidence: 0.95,
    diagnostic: "The retry limit includes one extra attempt.",
    severity: "high",
    suggestion: null,
    location: { anchorId: catalog[0]!.id },
    evidence: [{ id: catalog[0]!.id, reason: "Supports the retry diagnosis" }],
  };
  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      const index = call++;
      return textResult(
        index === 0
          ? "Checked retry"
          : JSON.stringify({
              findings: [
                index === 1
                  ? {
                      ...finding,
                      evidence: [
                        { ...finding.evidence[0], excerpt: "invented source" },
                      ],
                    }
                  : finding,
              ],
              summary: "Checked retry",
            }),
      );
    },
  });
  const result = modelReviewOutputSchema.parse(
    await generator(model).generate({
      ...request,
      evidenceCandidates: referenceCandidates,
    }),
  );
  expect(result.findings[0]?.evidence[0]?.excerpt).toBe(
    referenceCandidates[0]!.excerpt,
  );
  expect(call).toBe(3);
});

it("marks a bounded catalog omission incomplete even when the model returns no findings", async () => {
  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () =>
      textResult(call++ === 0 ? "Checked retry" : JSON.stringify(output)),
  });
  const result = modelReviewOutputSchema.parse(
    await generator(model).generate({
      ...request,
      evidenceCandidates: Array.from({ length: 33 }, (_, index) => ({
        ...referenceCandidates[0]!,
        startLine: index + 1,
        endLine: index + 1,
      })),
    }),
  );
  expect(result.isDegraded).toBe(true);
  expect(result.outputLimitations).toContain("evidence_catalog_omitted");
});

it("retains valid candidates and reports unknown references without source or observer failure escaping", async () => {
  const catalog = await createFinalizationEvidenceCatalog(
    referenceCandidates,
    "Checked retry",
  );
  const finding = {
    confidence: 0.95,
    diagnostic: "The retry limit includes one extra attempt.",
    severity: "high",
    suggestion: null,
    location: { anchorId: catalog[0]!.id },
    evidence: [{ id: catalog[0]!.id, reason: "Supports the retry diagnosis" }],
  };
  let call = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () =>
      textResult(
        call++ === 0
          ? "Checked retry"
          : JSON.stringify({
              findings: [
                finding,
                {
                  ...finding,
                  evidence: [
                    ...finding.evidence,
                    { id: `ev:${"f".repeat(64)}`, reason: "Unknown" },
                  ],
                },
              ],
              summary: "Checked retry",
            }),
      ),
  });
  provider.model.mockReturnValue(model);
  const observer = vi.fn(() => {
    throw new Error("observer unavailable");
  });
  const reviewer = new TwoPhaseReviewGenerator(
    {
      accountId: "account",
      apiToken: "secret",
      gatewayId: "gateway",
      model: "dynamic/review",
    },
    { run: async () => ({ content: "", truncated: false }) },
    undefined,
    undefined,
    observer,
  );
  const result = modelReviewOutputSchema.parse(
    await reviewer.generate({
      ...request,
      evidenceCandidates: referenceCandidates,
    }),
  );
  expect(result.findings).toHaveLength(1);
  expect(result.outputLimitations).toContain("evidence_reference_invalid");
  expect(observer).toHaveBeenCalledWith({
    candidateKind: "finding",
    findingIndex: 1,
    evidenceIndex: 1,
    reason: "unknown_evidence_reference",
  });
});
