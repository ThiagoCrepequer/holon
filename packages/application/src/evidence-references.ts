import {
  canonicalEvidenceEntrySchema,
  modelReviewOutputSchema,
  type CanonicalEvidenceEntry,
  type ModelReviewTransport,
} from "@holon/contracts";

export interface EvidenceReferenceRejection {
  readonly candidateKind: "finding" | "resolution";
  readonly findingIndex: number;
  readonly evidenceIndex?: number;
  readonly reason:
    | "unknown_anchor_reference"
    | "unknown_evidence_reference"
    | "anchor_not_in_evidence";
}

/** Resolve only the exact catalog supplied to this finalization; never guess a match. */
export function resolveReviewEvidenceReferences(
  transport: ModelReviewTransport,
  catalog: readonly CanonicalEvidenceEntry[],
) {
  const entries = new Map<string, CanonicalEvidenceEntry>();
  for (const raw of catalog) {
    const entry = canonicalEvidenceEntrySchema.parse(raw);
    if (entries.has(entry.id))
      throw new TypeError("Duplicate canonical evidence ID");
    entries.set(entry.id, entry);
  }
  const rejections: EvidenceReferenceRejection[] = [];
  const resolve = (
    candidate:
      | ModelReviewTransport["findings"][number]
      | NonNullable<ModelReviewTransport["resolutions"]>[number],
    candidateKind: EvidenceReferenceRejection["candidateKind"],
    findingIndex: number,
  ) => {
    const reject = (
      reason: EvidenceReferenceRejection["reason"],
      evidenceIndex?: number,
    ) => {
      rejections.push({
        candidateKind,
        findingIndex,
        reason,
        ...(evidenceIndex === undefined ? {} : { evidenceIndex }),
      });
      return undefined;
    };
    const anchor = entries.get(candidate.location.anchorId);
    if (!anchor) return reject("unknown_anchor_reference");
    const evidence = [];
    for (const [evidenceIndex, reference] of candidate.evidence.entries()) {
      const entry = entries.get(reference.id);
      if (!entry) return reject("unknown_evidence_reference", evidenceIndex);
      evidence.push({
        path: entry.path,
        startLine: entry.startLine,
        endLine: entry.endLine,
        excerpt: entry.excerpt,
        reason: reference.reason,
      });
    }
    if (!candidate.evidence.some((reference) => reference.id === anchor.id))
      return reject("anchor_not_in_evidence");
    return {
      confidence: candidate.confidence,
      diagnostic: candidate.diagnostic,
      evidence,
      location: {
        path: anchor.path,
        startLine: anchor.startLine,
        line: anchor.endLine,
        side: "RIGHT" as const,
      },
    };
  };
  const findings = transport.findings.flatMap((candidate, index) => {
    const resolved = resolve(candidate, "finding", index);
    return resolved
      ? [
          {
            ...resolved,
            severity: candidate.severity,
            ...(candidate.suggestion === null
              ? {}
              : { suggestion: candidate.suggestion }),
          },
        ]
      : [];
  });
  const resolutions = transport.resolutions?.flatMap((candidate, index) => {
    const resolved = resolve(candidate, "resolution", index);
    return resolved
      ? [{ ...resolved, fingerprint: candidate.fingerprint }]
      : [];
  });
  const outputLimitations = [
    ...new Set([
      ...(transport.outputLimitations ?? []),
      ...(rejections.length ? ["evidence_reference_invalid" as const] : []),
    ]),
  ];
  const output = modelReviewOutputSchema.parse({
    findings,
    ...(resolutions === undefined ? {} : { resolutions }),
    summary: transport.summary,
    ...(transport.isDegraded === undefined
      ? {}
      : { isDegraded: transport.isDegraded }),
    ...(outputLimitations.length
      ? { isDegraded: true, outputLimitations }
      : {}),
  });
  return { output, rejections };
}
