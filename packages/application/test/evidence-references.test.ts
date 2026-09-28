import { modelReviewTransportSchema } from "@holon/contracts";
import { expect, it } from "vitest";

import { resolveReviewEvidenceReferences } from "../src/evidence-references.js";
import { verifyFindingsWithCanonicalEvidence } from "../src/evidence.js";

const id = `ev:${"a".repeat(64)}`;
const catalog = [
  {
    id,
    path: "src/retry.ts",
    startLine: 12,
    endLine: 12,
    excerpt: "return completedAttempts <= maxAttempts;",
  },
];
const finding = {
  confidence: 0.95,
  diagnostic:
    "The inclusive comparison permits one attempt beyond the configured limit.",
  severity: "high",
  suggestion: null,
  location: { anchorId: id },
  evidence: [{ id, reason: "The comparison allows equality." }],
};
const transport = (findings = [finding]) =>
  modelReviewTransportSchema.parse({
    findings,
    summary: "Verified the retry boundary.",
  });

it("materializes exact source and inline coordinates exclusively from the host catalog", () => {
  const { output, rejections } = resolveReviewEvidenceReferences(
    transport(),
    catalog,
  );
  expect(rejections).toEqual([]);
  expect(output.findings[0]).toMatchObject({
    location: { path: "src/retry.ts", line: 12, side: "RIGHT" },
    evidence: [
      {
        path: "src/retry.ts",
        startLine: 12,
        endLine: 12,
        excerpt: catalog[0]!.excerpt,
      },
    ],
  });
  expect(
    verifyFindingsWithCanonicalEvidence(output.findings, {
      files: [
        {
          path: "src/retry.ts",
          mode: "structural",
          patch:
            "@@ -12 +12 @@\n-return completedAttempts < maxAttempts;\n+return completedAttempts <= maxAttempts;",
        },
      ],
      changedLines: [{ path: "src/retry.ts", line: 12, side: "RIGHT" }],
      truncated: false,
    }).findings,
  ).toHaveLength(1);
});

it("rejects the whole invalid candidate, preserves valid findings, and cannot approve silently", () => {
  const invalid = {
    ...finding,
    evidence: [
      ...finding.evidence,
      { id: `ev:${"b".repeat(64)}`, reason: "Invented reference" },
    ],
  };
  const { output, rejections } = resolveReviewEvidenceReferences(
    transport([finding, invalid]),
    catalog,
  );
  expect(output.findings).toHaveLength(1);
  expect(output.isDegraded).toBe(true);
  expect(output.outputLimitations).toContain("evidence_reference_invalid");
  expect(rejections).toEqual([
    {
      candidateKind: "finding",
      findingIndex: 1,
      evidenceIndex: 1,
      reason: "unknown_evidence_reference",
    },
  ]);
  expect(JSON.stringify(rejections)).not.toContain("src/retry.ts");
});

it("does not let supplied coordinates or a rewritten quote override the host", () => {
  const raw = {
    ...finding,
    location: { anchorId: id, path: "other.ts", line: 999 },
    evidence: [
      {
        id,
        reason: "Comparison",
        excerpt: "return true;",
        path: "other.ts",
        startLine: 999,
      },
    ],
  };
  expect(() => transport([raw])).toThrow();
});

it.each(["unknown_anchor_reference", "anchor_not_in_evidence"] as const)(
  "rejects %s for locations without guessing an anchor",
  (reason) => {
    const otherId = `ev:${"b".repeat(64)}`;
    const extra =
      reason === "anchor_not_in_evidence"
        ? [{ ...catalog[0]!, id: otherId }]
        : [];
    const { output, rejections } = resolveReviewEvidenceReferences(
      transport([{ ...finding, location: { anchorId: otherId } }]),
      [...catalog, ...extra],
    );
    expect(output.findings).toEqual([]);
    expect(output.isDegraded).toBe(true);
    expect(rejections[0]?.reason).toBe(reason);
  },
);

it("resolves correction references without trusting model coordinates and flags invalid resolutions", () => {
  const resolution = {
    confidence: finding.confidence,
    diagnostic: finding.diagnostic,
    evidence: finding.evidence,
    location: finding.location,
    fingerprint: `fp:${"c".repeat(64)}`,
  };
  const result = resolveReviewEvidenceReferences(
    modelReviewTransportSchema.parse({
      findings: [],
      resolutions: [
        resolution,
        {
          ...resolution,
          evidence: [{ id: `ev:${"d".repeat(64)}`, reason: "Unknown" }],
        },
      ],
      summary: "Correction checked",
    }),
    catalog,
  );
  expect(result.output.resolutions).toHaveLength(1);
  expect(result.output.resolutions?.[0]).toMatchObject({
    fingerprint: resolution.fingerprint,
    evidence: [{ excerpt: catalog[0]!.excerpt }],
  });
  expect(result.rejections[0]).toMatchObject({
    candidateKind: "resolution",
    findingIndex: 1,
    evidenceIndex: 0,
  });
  expect(result.output.isDegraded).toBe(true);
});

it("treats invalid host catalogs as host errors rather than partial model failures", () => {
  expect(() =>
    resolveReviewEvidenceReferences(transport(), [...catalog, ...catalog]),
  ).toThrow("Duplicate canonical evidence ID");
  expect(() =>
    resolveReviewEvidenceReferences(transport(), [
      { ...catalog[0]!, endLine: 1 },
    ]),
  ).toThrow();
});

it("preserves model limitations through repeated SDK normalization and host resolution", () => {
  const parsed = modelReviewTransportSchema.parse({
    findings: [finding],
    summary: "s".repeat(11_000),
  });
  const { output } = resolveReviewEvidenceReferences(
    modelReviewTransportSchema.parse(parsed),
    catalog,
  );
  expect(output.outputLimitations).toEqual(["summary_truncated"]);
  expect(output.isDegraded).toBe(true);
});
