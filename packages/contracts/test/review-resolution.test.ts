import { expect, it } from "vitest";

import { modelReviewTransportSchema } from "../src/review-output.js";

it("preserves bounded, explicit correction evidence through model transport", () => {
  const resolution = {
    fingerprint: `fp:${"a".repeat(64)}`,
    confidence: 0.98,
    diagnostic: "The new guard returns before dereferencing a null user.",
    location: { anchorId: `ev:${"a".repeat(64)}` },
    evidence: [
      {
        id: `ev:${"a".repeat(64)}`,
        reason: "The guard handles the null case.",
      },
    ],
  };
  expect(
    modelReviewTransportSchema.parse({
      findings: [],
      resolutions: [resolution],
      summary: "Verified the correction.",
    }).resolutions,
  ).toEqual([resolution]);
});
