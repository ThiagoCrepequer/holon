/** UTF-16 character limits, shared by transport, persistence and publication. */
export const reviewTextLimits = {
  diagnostic: 2_000,
  excerpt: 1_200,
  reason: 600,
  suggestion: 3_000,
  summary: 10_000,
  publicationSummary: 16_000,
  findings: 8,
  evidence: 4,
} as const;

/** Preserve valid Unicode and reserve room for an explicit truncation marker. */
export function limitReviewText(
  value: string,
  maximum: number,
  marker = "…",
): string {
  if (value.length <= maximum) return value;
  let end = maximum - marker.length;
  if (end > 0 && /[\uD800-\uDBFF]/u.test(value[end - 1]!)) end -= 1;
  return value.slice(0, end) + marker;
}

export const reviewOutputLimitationCodes = [
  "diagnostic_truncated",
  "excerpt_truncated",
  "reason_truncated",
  "suggestion_truncated",
  "summary_truncated",
  "findings_omitted",
  "evidence_omitted",
  "input_context_omitted",
  "generation_length",
  "investigation_incomplete",
  "finalization_failed",
  "tool_budget_exhausted",
  "evidence_rejected",
] as const;

export function reviewOutputLimitations(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  const value = raw as Record<string, unknown>;
  const codes = new Set<string>();
  const inspect = (
    object: Record<string, unknown>,
    keys: readonly (keyof typeof reviewTextLimits)[],
  ) => {
    for (const key of keys) {
      const field = object[key];
      if (
        typeof field === "string" &&
        (key === "excerpt" ? field.length : field.trim().length) >
          reviewTextLimits[key]
      )
        codes.add(`${key}_truncated`);
    }
  };
  inspect(value, ["summary"]);
  if (Array.isArray(value.findings)) {
    if (value.findings.length > reviewTextLimits.findings)
      codes.add("findings_omitted");
    for (const finding of value.findings.slice(0, reviewTextLimits.findings)) {
      if (typeof finding !== "object" || finding === null) continue;
      inspect(finding, ["diagnostic", "suggestion"]);
      if (Array.isArray(finding.evidence)) {
        if (finding.evidence.length > reviewTextLimits.evidence)
          codes.add("evidence_omitted");
        for (const evidence of finding.evidence.slice(
          0,
          reviewTextLimits.evidence,
        )) {
          if (typeof evidence === "object" && evidence !== null)
            inspect(evidence, ["excerpt", "reason"]);
        }
      }
    }
  }
  return [...codes];
}
