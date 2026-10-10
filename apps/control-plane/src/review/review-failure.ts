import {
  ThinkPromptError,
  ThinkPromptTimeoutError,
  ThinkPromptValidationError,
} from "@cloudflare/think/workflows";
import { z } from "zod";

const reviewFailureReasons = [
  "model_budget_exhausted",
  "model_shard_budget_exhausted",
  "model_output_missing",
  "model_schema_invalid",
  "agent_deadline_exceeded",
  "evidence_collection_failed",
  "model_tool_protocol_invalid",
] as const;
export type ReviewFailureReason = (typeof reviewFailureReasons)[number];
export const reviewFailureReasonSchema = z.enum(reviewFailureReasons);

/** Think 0.20.0 has a typed prompt error but no typed missing-final-tool error. */
export function thinkPromptFailure(
  error: unknown,
): ReviewFailureReason | undefined {
  if (error instanceof ThinkPromptTimeoutError)
    return "agent_deadline_exceeded";
  if (
    error instanceof ThinkPromptValidationError ||
    (error instanceof Error && error.name === "ZodError")
  )
    return "model_schema_invalid";
  if (
    error instanceof ThinkPromptError &&
    error.message ===
      "Model ended the turn without calling the think_final_answer tool"
  )
    return "model_output_missing";
  return undefined;
}
