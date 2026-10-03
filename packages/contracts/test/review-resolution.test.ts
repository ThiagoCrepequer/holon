import { expect, it } from "vitest";

import { parseModelReviewTransport } from "../src/review-output.js";

it("preserves bounded, explicit correction evidence through model transport", () => {
  const resolution = {
    fingerprint: `fp:${"a".repeat(64)}`,
    confidence: 0.98,
    diagnostic: "The new guard returns before dereferencing a null user.",
    location: { path: "src/user.ts", line: 12, side: "RIGHT" },
    evidence: [
      {
        path: "src/user.ts",
        startLine: 12,
        excerpt: "if (!user) return null;",
        reason: "The guard handles the null case.",
      },
    ],
  };
  expect(
    parseModelReviewTransport({
      findings: [],
      resolutions: [resolution],
      summary: "Verified the correction.",
    }).resolutions,
  ).toEqual([resolution]);
});

it("normalizes Think's required nullable resolution fields before domain validation", () => {
  const resolution = {
    fingerprint: `fp:${"a".repeat(64)}`,
    confidence: 0.98,
    diagnostic: "The new guard returns before dereferencing a null user.",
    location: { path: "src/user.ts", line: 12, side: "RIGHT", startLine: null },
    evidence: [
      {
        path: "src/user.ts",
        startLine: 12,
        endLine: null,
        excerpt: "if (!user) return null;",
        reason: "The guard handles the null case.",
      },
    ],
  };
  expect(
    parseModelReviewTransport({
      findings: [],
      resolutions: [resolution],
      summary: "Verified the correction.",
    }).resolutions,
  ).toEqual([
    {
      ...resolution,
      location: { path: "src/user.ts", line: 12, side: "RIGHT" },
      evidence: [
        {
          path: "src/user.ts",
          startLine: 12,
          excerpt: "if (!user) return null;",
          reason: "The guard handles the null case.",
        },
      ],
    },
  ]);
});
