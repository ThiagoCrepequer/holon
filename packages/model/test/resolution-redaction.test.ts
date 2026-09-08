import { expect, it } from "vitest";

import { redactModelReviewOutput } from "../src/redaction.js";

it("redacts resolution diagnostics and evidence without losing identity or confidence", () => {
  const secret = `ghp_${"a".repeat(30)}`;
  const fingerprint = `fp:${"f".repeat(64)}` as const;
  const output = redactModelReviewOutput({
    findings: [],
    summary: "Review complete",
    resolutions: [
      {
        fingerprint,
        confidence: 0.95,
        diagnostic: `Removed credential ${secret}`,
        location: { path: "src/config.ts", line: 1, side: "RIGHT" },
        evidence: [
          {
            path: "src/config.ts",
            startLine: 1,
            excerpt: `const token = "${secret}"`,
            reason: `Replaces ${secret}`,
          },
        ],
      },
    ],
  });
  expect(JSON.stringify(output)).not.toContain(secret);
  expect(output.resolutions?.[0]).toMatchObject({
    fingerprint,
    confidence: 0.95,
    diagnostic: "Removed credential [REDACTED_SECRET]",
    evidence: [
      {
        excerpt: 'const token = "[REDACTED_SECRET]"',
        reason: "Replaces [REDACTED_SECRET]",
      },
    ],
  });
});
