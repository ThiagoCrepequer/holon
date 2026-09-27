import { expect, it } from "vitest";

import { verifyFindingsWithCanonicalEvidence } from "../src/evidence.js";

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
it("returns accepted candidates unchanged and no rejection", () => {
  const result = verifyFindingsWithCanonicalEvidence([candidate], context);
  expect(result.findings).toEqual([candidate]);
  expect(result.findings[0]).toBe(candidate);
  expect(result.rejections).toEqual([]);
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
