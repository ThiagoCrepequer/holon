import {
  ThinkPromptAbortedError,
  ThinkPromptError,
  ThinkPromptSkippedError,
  ThinkPromptTimeoutError,
  ThinkPromptValidationError,
} from "@cloudflare/think/workflows";
import { describe, expect, it, vi } from "vitest";

import {
  harnessWorkflowResultSchema,
  runHarnessEvaluationWorkflow,
} from "../src/workflow.js";

describe("Think evaluation workflow", () => {
  it("builds the controlled prompt and normalizes terminal-tool transport", async () => {
    const prompt = vi.fn((_name: string, _options: unknown) =>
      Promise.resolve({
        findings: [],
        summary: "No supported regression was found.",
      }),
    );

    await expect(
      runHarnessEvaluationWorkflow(
        "no-finding.harmless-documentation-instruction",
        { prompt } as never,
      ),
    ).resolves.toEqual({
      kind: "complete",
      result: {
        output: {
          findings: [],
          summary: "No supported regression was found.",
        },
        partial: false,
      },
    });
    const options = prompt.mock.calls[0]?.[1] as {
      readonly prompt: string;
      readonly timeout: string;
    };
    expect(options.prompt).toContain("<untrusted_patch>");
    expect(options.prompt).toContain("README.md");
    expect(options.timeout).toBe("3 minutes");
  });

  it("preserves partial context and maps typed prompt failures safely", async () => {
    const successful = vi.fn(() =>
      Promise.resolve({
        findings: [],
        summary: "The bounded context was reviewed.",
      }),
    );
    await expect(
      runHarnessEvaluationWorkflow("budget.explicit-partial-review", {
        prompt: successful,
      } as never),
    ).resolves.toMatchObject({ kind: "complete", result: { partial: true } });

    for (const [error, reason] of [
      [
        new ThinkPromptValidationError("submission", new Error("invalid")),
        "model_output_invalid",
      ],
      [
        new ThinkPromptTimeoutError("submission", new Error("timeout")),
        "execution_timeout",
      ],
      [new ThinkPromptAbortedError("submission"), "execution_aborted"],
      [new ThinkPromptSkippedError("submission"), "execution_skipped"],
      [
        new ThinkPromptError("private terminal failure", "submission", "error"),
        "execution_error",
      ],
      [new Error("private provider payload"), "unknown"],
    ] as const) {
      const result = await runHarnessEvaluationWorkflow(
        "no-finding.harmless-documentation-instruction",
        { prompt: vi.fn(() => Promise.reject(error)) } as never,
      );
      expect(result).toEqual({ kind: "error", reason });
      expect(JSON.stringify(result)).not.toContain("private provider payload");
    }
  });

  it("rejects unknown cases and malformed durable results", async () => {
    await expect(
      runHarnessEvaluationWorkflow("unknown.case", {
        prompt: vi.fn(),
      } as never),
    ).resolves.toEqual({ kind: "error", reason: "unknown" });
    expect(
      harnessWorkflowResultSchema.safeParse({
        kind: "error",
        reason: "provider message",
      }).success,
    ).toBe(false);
  });
});
