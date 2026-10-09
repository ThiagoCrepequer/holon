import type { ModelReviewOutput } from "@holon/contracts";

interface LiveReviewCase {
  readonly family: string;
  readonly positive: boolean;
  readonly findingLine?: number;
}

const diagnosticRubrics: Readonly<
  Record<string, readonly (readonly string[])[]>
> = {
  "aliased-consumer": [
    ["null"],
    ["payload", "produce", "consumer", "caller", "value.id"],
    ["dereferenc", "property", "access", "typeerror", "crash", "throw"],
  ],
  "null-consumer": [
    ["null"],
    ["produce", "value.id", "consumer", "caller"],
    ["dereferenc", "property", "access", "typeerror", "crash", "throw"],
  ],
  "literal-contract": [
    ["delimiter", "space", "separator"],
    ["join", "wire", "consumer", "caller"],
    [
      "two spaces",
      "double",
      "extra space",
      "wire_format",
      "wire format",
      "a  b",
    ],
  ],
  "cycle-index": [
    ["next", "index"],
    ["wrap", "modulo", "%", "size", "length"],
    [
      "undefined",
      "out of bound",
      "out-of-bound",
      "invalid_cycle_index",
      "crash",
      "throw",
      "beyond",
      "overflow",
    ],
  ],
  "caller-mutation": [
    ["sort", "normaliz"],
    ["original", "input", "caller", "values"],
    ["mutat", "in-place", "in place", "reorder", "modif"],
  ],
  "payload-field": [
    ["value", "field", "property"],
    ["payload", "total", "consumer", "caller"],
    [
      "undefined",
      "nan",
      "non-finite",
      "nonfinite",
      "not finite",
      "invalid_amount",
    ],
  ],
  "inclusive-boundary": [
    ["<", "exclusive", "exclud", "strict", "less than"],
    ["10", "maximum", "equal", "boundary", "limit"],
    ["reject", "fail", "throw", "boundary_rejected"],
  ],
};

/** Lexical rubrics reject unrelated diagnoses; they do not establish semantic equivalence. */
export function gradeLiveReview(
  fixture: LiveReviewCase,
  final: ModelReviewOutput | undefined,
  rejectedCandidates: number,
  failure: string | null,
): { readonly passed: boolean; readonly failures: readonly string[] } {
  const failures: string[] = [];
  if (failure !== null) failures.push("execution_failed");
  if (final === undefined) failures.push("output_missing");
  if (rejectedCandidates > 0) failures.push("evidence_rejected");
  if (final?.isDegraded || final?.outputLimitations?.length)
    failures.push("incomplete_review");
  const rubric = Object.hasOwn(diagnosticRubrics, fixture.family)
    ? diagnosticRubrics[fixture.family]
    : undefined;
  if (!rubric) failures.push("unknown_case_family");
  if (final) {
    if (fixture.positive) {
      if (final.findings.length !== 1) failures.push("finding_count_mismatch");
      const finding = final.findings[0];
      if (finding) {
        if (
          finding.location.path !== "src/producer.ts" ||
          finding.location.line !== (fixture.findingLine ?? 2) ||
          finding.location.side !== "RIGHT"
        )
          failures.push("location_mismatch");
        if (finding.severity !== "medium" && finding.severity !== "high")
          failures.push("severity_mismatch");
        if (finding.confidence < 0.8) failures.push("confidence_below_minimum");
        const diagnostic = finding.diagnostic.normalize("NFKC").toLowerCase();
        if (
          rubric &&
          !rubric.every((group) =>
            group.some((term) => diagnostic.includes(term)),
          )
        )
          failures.push("diagnostic_mismatch");
      }
    } else if (final.findings.length !== 0) failures.push("unexpected_finding");
  }
  return { passed: failures.length === 0, failures };
}
