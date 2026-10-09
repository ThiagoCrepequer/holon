import {
  modelReviewPromptSchema,
  parseModelReviewTransport,
  causalVerificationSchema,
} from "@holon/contracts";
import { z } from "zod";

const allowedFields = new Set([
  "findings",
  "resolutions",
  "investigations",
  "isDegraded",
  "summary",
  "outputLimitations",
  "confidence",
  "diagnostic",
  "evidence",
  "location",
  "severity",
  "suggestion",
  "endLine",
  "excerpt",
  "path",
  "reason",
  "startLine",
  "line",
  "side",
  "fingerprint",
  "claim",
  "confidence",
  "evidenceRefs",
  "subject",
  "kind",
  "files",
  "symbols",
  "observation",
  "rationale",
  "verification",
  "assessments",
  "candidateIndex",
  "basis",
  "evidenceReceiptIds",
  "id",
  "outcome",
]);
const issuePaths = (error: z.ZodError) =>
  error.issues
    .slice(0, 20)
    .map(
      (issue) =>
        `${issue.code}:${issue.path.map((part) => (typeof part === "number" ? part : allowedFields.has(String(part)) ? part : "other")).join(".")}`,
    );

function issueValueKinds(error: z.ZodError, raw: unknown): string[] {
  return error.issues.slice(0, 20).flatMap((issue) => {
    if (
      !issue.path.every(
        (part) => typeof part === "number" || allowedFields.has(String(part)),
      )
    )
      return [];
    let value: unknown = raw;
    for (const part of issue.path) {
      value =
        typeof value === "object" && value !== null
          ? Reflect.get(value, part)
          : undefined;
    }
    const kind =
      value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    return [`${issue.path.join(".")}:${kind}`];
  });
}

/** Diagnostic metadata only: never return raw tool arguments, values or error messages. */
export function finalValidationMetadata(
  argumentsText: string,
  phase = "investigation",
) {
  let raw: unknown;
  try {
    raw = JSON.parse(argumentsText);
  } catch {
    return { jsonInvalid: true };
  }
  const prompt =
    phase === "causal_verification"
      ? causalVerificationSchema.safeParse(raw)
      : modelReviewPromptSchema.safeParse(raw);
  let transportIssues: string[] = [];
  try {
    if (phase !== "causal_verification") parseModelReviewTransport(raw);
  } catch (error) {
    transportIssues =
      error instanceof z.ZodError ? issuePaths(error) : ["validation_failed"];
  }
  return {
    jsonInvalid: false,
    promptIssues: prompt.success ? [] : issuePaths(prompt.error),
    transportIssues,
    promptValueKinds: prompt.success ? [] : issueValueKinds(prompt.error, raw),
  };
}
