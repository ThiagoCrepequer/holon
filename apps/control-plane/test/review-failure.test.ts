import {
  ThinkPromptError,
  ThinkPromptTimeoutError,
  ThinkPromptValidationError,
} from "@cloudflare/think/workflows";
import { expect, it } from "vitest";

import { thinkPromptFailure } from "../src/review/review-failure.js";

it("distinguishes the Think protocol, validation and timeout failures", () => {
  expect(
    thinkPromptFailure(
      new ThinkPromptError(
        "Model ended the turn without calling the think_final_answer tool",
        "submission",
        "error",
      ),
    ),
  ).toBe("model_output_missing");
  expect(
    thinkPromptFailure(
      new ThinkPromptTimeoutError("submission", new Error("timeout")),
    ),
  ).toBe("agent_deadline_exceeded");
  expect(
    thinkPromptFailure(
      new ThinkPromptValidationError("submission", new Error("invalid")),
    ),
  ).toBe("model_schema_invalid");
});

it("does not promote arbitrary model or workflow messages into known causes", () => {
  expect(
    thinkPromptFailure(
      new ThinkPromptError("private provider payload", "submission", "error"),
    ),
  ).toBeUndefined();
  expect(
    thinkPromptFailure(
      new Error(
        "Model ended the turn without calling the think_final_answer tool",
      ),
    ),
  ).toBeUndefined();
});
