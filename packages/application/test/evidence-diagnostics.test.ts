import { expect, it } from "vitest";

import { verifyFindingsWithCanonicalEvidence } from "../src/evidence.js";
import { createCanonicalEvidenceVerifier } from "../src/evidence.js";
import { prepareCausalCandidates } from "../src/evidence.js";

const context = {
  changedLines: [{ path: "private.ts", line: 2, side: "RIGHT" as const }],
  files: [
    {
      path: "private.ts",
      mode: "textual" as const,
      patch: "@@ -1,2 +1,2 @@\n context\n-old()\n+secretCode()",
    },
  ],
  truncated: false,
};

it("projects exact changed head excerpts without duplicates, conflicts or absent hunk lines", () => {
  const verifier = createCanonicalEvidenceVerifier({
    ...context,
    changedLines: [
      { path: "private.ts", line: 2, side: "RIGHT" },
      { path: "private.ts", line: 2, side: "RIGHT" },
      { path: "private.ts", line: 5, side: "RIGHT" },
      { path: "missing.ts", line: 1, side: "RIGHT" },
    ],
    files: [
      ...context.files,
      {
        path: "private.ts",
        mode: "textual",
        patch: "@@ -5 +5 @@\n-old()\n+one()",
      },
      {
        path: "private.ts",
        mode: "textual",
        patch: "@@ -5 +5 @@\n-old()\n+two()",
      },
    ],
  });
  expect(verifier.changedLineExcerpts()).toEqual([
    { path: "private.ts", startLine: 2, endLine: 2, excerpt: "secretCode()" },
  ]);
  const first = verifier.changedLineExcerpts();
  expect(verifier.changedLineExcerpts()).not.toBe(first);
});
const candidate = {
  confidence: 0.95,
  severity: "high" as const,
  diagnostic: "PRIVATE diagnostic describing a serious regression.",
  location: { path: "private.ts", line: 2, side: "RIGHT" as const },
  evidence: [
    {
      path: "private.ts",
      startLine: 2,
      excerpt: "secretCode()",
      reason: "PRIVATE reason",
    },
  ],
};
it("preserves evidence rejection when the remaining candidates enter causal verification", () => {
  const draft = {
    findings: [
      candidate,
      {
        ...candidate,
        evidence: [{ ...candidate.evidence[0]!, excerpt: "inventedCode()" }],
      },
    ],
    summary: "Two candidates.",
    isDegraded: false,
  };
  const result = prepareCausalCandidates(draft, context);
  expect(result.candidates.findings).toEqual([candidate]);
  expect(result.rejections).toHaveLength(1);
  expect(result.candidates.isDegraded).toBe(true);
  expect(result.candidates.outputLimitations).toContain("evidence_rejected");
});
it("returns accepted candidates unchanged and no rejection", () => {
  const result = verifyFindingsWithCanonicalEvidence([candidate], context);
  expect(result.findings).toEqual([candidate]);
  expect(result.findings[0]).toBe(candidate);
  expect(result.rejections).toEqual([]);
});
it("rejects conflicting fragment content regardless of order", () => {
  const first = context.files[0]!;
  const conflict = {
    ...first,
    patch: first.patch.replace("secretCode()", "otherCode()"),
  };
  for (const files of [
    [first, conflict],
    [conflict, first],
  ]) {
    expect(
      verifyFindingsWithCanonicalEvidence([candidate], { ...context, files })
        .rejections,
    ).toEqual([{ findingIndex: 0, reason: "canonical_content_conflict" }]);
  }
});
it.each([
  "const x = 'a  b';",
  "const x = /a  b/;",
  "  if allowed:\n    write()",
])("preserves literal and indentation semantics: %s", (excerpt) => {
  const content = excerpt
    .replace("a  b", "a b")
    .replace("    write", "  write");
  const files = [
    {
      ...context.files[0]!,
      patch: `@@ -2,0 +2,${content.split("\n").length} @@\n${content
        .split("\n")
        .map((line) => "+" + line)
        .join("\n")}`,
    },
  ];
  expect(
    verifyFindingsWithCanonicalEvidence(
      [
        {
          ...candidate,
          evidence: [
            {
              ...candidate.evidence[0]!,
              excerpt,
              endLine: 2 + content.split("\n").length - 1,
            },
          ],
        },
      ],
      { ...context, files },
    ).rejections[0]?.reason,
  ).toBe("evidence_excerpt_mismatch");
});
it("reuses an isolated index even if the caller later mutates its input", () => {
  const input = structuredClone(context);
  const verifier = createCanonicalEvidenceVerifier(input);
  input.files[0]!.patch = "@@ -2,0 +2 @@\n+mutated()";
  expect(verifier.verify([candidate]).findings).toEqual([candidate]);
});
it.each([
  [
    "location_file_missing",
    { location: { ...candidate.location, path: "missing.ts" } },
  ],
  ["location_outside_hunk", { location: { ...candidate.location, line: 99 } }],
  ["location_not_added", { location: { ...candidate.location, line: 1 } }],
  [
    "evidence_file_missing",
    { evidence: [{ ...candidate.evidence[0]!, path: "missing.ts" }] },
  ],
  [
    "evidence_range_too_large",
    { evidence: [{ ...candidate.evidence[0]!, endLine: 504 }] },
  ],
  [
    "evidence_range_missing",
    { evidence: [{ ...candidate.evidence[0]!, startLine: 3 }] },
  ],
  [
    "evidence_excerpt_empty",
    { evidence: [{ ...candidate.evidence[0]!, excerpt: " " }] },
  ],
  [
    "evidence_excerpt_mismatch",
    {
      evidence: [
        { ...candidate.evidence[0]!, excerpt: "PRIVATE invented code" },
      ],
    },
  ],
  ["finding_contract_invalid", { diagnostic: "short" }],
])("reports %s without retaining private content", (reason, override) => {
  const result = verifyFindingsWithCanonicalEvidence(
    [candidate, { ...candidate, ...override }],
    context,
  );
  expect(result.findings).toEqual([candidate]);
  expect(result.rejections).toEqual([
    expect.objectContaining({ findingIndex: 1, reason }),
  ]);
  expect(JSON.stringify(result.rejections)).not.toMatch(
    /PRIVATE|private.ts|secretCode|missing.ts/u,
  );
});
it("points to the first rejected evidence and preserves other findings", () => {
  const result = verifyFindingsWithCanonicalEvidence(
    [
      {
        ...candidate,
        evidence: [
          ...candidate.evidence,
          { ...candidate.evidence[0]!, excerpt: "bad" },
        ],
      },
      candidate,
    ],
    context,
  );
  expect(result.rejections).toEqual([
    { findingIndex: 0, evidenceIndex: 1, reason: "evidence_excerpt_mismatch" },
  ]);
  expect(result.findings).toEqual([candidate]);
});

it("accepts a contiguous anchor spanning fragment boundaries and rejects a missing coordinate", () => {
  const files = [
    { ...context.files[0]!, patch: "@@ -1,0 +1 @@\n+first()" },
    { ...context.files[0]!, patch: "@@ -2,0 +2 @@\n+second()" },
  ];
  const spanning = {
    ...candidate,
    location: { ...candidate.location, startLine: 1 },
    evidence: [
      {
        ...candidate.evidence[0]!,
        startLine: 1,
        endLine: 2,
        excerpt: "first()\nsecond()",
      },
    ],
  };
  expect(
    verifyFindingsWithCanonicalEvidence([spanning], { ...context, files })
      .findings,
  ).toEqual([spanning]);
  expect(
    verifyFindingsWithCanonicalEvidence([spanning], {
      ...context,
      files: files.slice(1),
    }).rejections,
  ).toEqual([{ findingIndex: 0, reason: "location_outside_hunk" }]);
});
