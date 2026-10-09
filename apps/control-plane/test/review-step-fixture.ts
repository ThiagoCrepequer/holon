import type { ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import type { ReviewAgent } from "../src/review/review-agent.js";

export function reviewStepFixture(
  stepNumber = 0,
  messages: ModelMessage[] = [],
): Parameters<ReviewAgent["beforeStep"]>[0] {
  return {
    stepNumber,
    messages,
    steps: [],
    model: new MockLanguageModelV4(),
    instructions: undefined,
    initialInstructions: undefined,
    initialMessages: messages.filter((message) => message.role === "user"),
    responseMessages: [],
    toolsContext: {},
    runtimeContext: {},
  };
}
