import { expect, it } from "vitest";

import { verifyFindingsWithCanonicalEvidence } from "../src/evidence.js";
const context = {
  changedLines: [{ path: "a.ts", line: 100, side: "RIGHT" as const }],
  files: [
    {
      path: "a.ts",
      mode: "structural" as const,
      patch: "@@ -99,2 +99,2 @@\n context\n-old()\n+bug()",
    },
  ],
  truncated: false,
};
const finding = {
  confidence: 0.95,
  severity: "high" as const,
  diagnostic: "This change bypasses a required authorization guard.",
  evidence: [
    {
      path: "a.ts",
      startLine: 100,
      excerpt: "bug()",
      reason: "Unconditional call",
    },
  ],
  location: { path: "a.ts", line: 100, side: "RIGHT" as const, startLine: 1 },
};
it("rejects a range starting outside the canonical hunk", () => {
  expect(
    verifyFindingsWithCanonicalEvidence([finding], context).findings,
  ).toHaveLength(0);
});
it("accepts an in-hunk context start and changed anchor", () => {
  expect(
    verifyFindingsWithCanonicalEvidence(
      [{ ...finding, location: { ...finding.location, startLine: 99 } }],
      context,
    ).findings,
  ).toHaveLength(1);
});
