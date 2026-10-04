import {
  causalVerificationSchema,
  modelReviewTransportSchema,
} from "@holon/contracts";
import { Output } from "ai";
import { describe, expect, it } from "vitest";

describe("SDK review schema integration", () => {
  it("exports the causal verifier as a strict provider object schema with no finding fields", async () => {
    const format = await Output.object({ schema: causalVerificationSchema })
      .responseFormat;
    expect(format).toMatchObject({
      type: "json",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["assessments", "summary"],
      },
    });
    expect(JSON.stringify(format)).not.toContain('"findings"');
  });
  it("exports a provider object schema and preserves normalization metadata", async () => {
    const output = Output.object({ schema: modelReviewTransportSchema });
    const format = await output.responseFormat;
    expect(format).toMatchObject({ type: "json", schema: { type: "object" } });
    const parsed = await output.parseCompleteOutput(
      { text: JSON.stringify({ findings: [], summary: "s".repeat(11_000) }) },
      {
        response: { id: "test", modelId: "test", timestamp: new Date() },
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          inputTokenDetails: {
            noCacheTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
          outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
        },
        finishReason: "stop",
      },
    );
    expect(parsed.outputLimitations).toContain("summary_truncated");
  });
});
