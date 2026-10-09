import { expect, it } from "vitest";

import {
  reviewProofReuseDecision,
  type ReviewProofDependencies,
} from "../src/index.js";
const proof: ReviewProofDependencies = {
  installationId: 99,
  repositoryId: 42,
  memoryDigest: "memory",
  feedbackDigest: "feedback",
  baseSha: "b".repeat(40),
  configurationDigest: "config",
  promptDigest: "prompt",
  modelReference: "model",
  capabilityDigest: "JS/TS",
  graphComplete: true,
  completeReview: true,
  dependencies: { "producer.ts": "same", "consumer.ts": "old" },
};
it("invalidates an unchanged producer's proof when its consumer changes", () => {
  expect(
    reviewProofReuseDecision(proof, {
      ...proof,
      dependencies: { ...proof.dependencies, "consumer.ts": "changed" },
    }),
  ).toEqual({ reusable: false, reason: "dependency_content" });
  expect(reviewProofReuseDecision(proof, { ...proof })).toEqual({
    reusable: true,
    reason: "complete_dependency_match",
  });
});
it.each([
  "installationId",
  "repositoryId",
  "memoryDigest",
  "feedbackDigest",
  "baseSha",
  "configurationDigest",
  "promptDigest",
  "modelReference",
  "capabilityDigest",
] as const)("invalidates changed %s", (key) => {
  expect(
    reviewProofReuseDecision(proof, {
      ...proof,
      [key]:
        key === "repositoryId" || key === "installationId" ? 43 : "changed",
    }).reusable,
  ).toBe(false);
});
it("requires complete coverage and the exact dependency closure", () => {
  expect(
    reviewProofReuseDecision(proof, { ...proof, graphComplete: false })
      .reusable,
  ).toBe(false);
  expect(
    reviewProofReuseDecision(proof, { ...proof, completeReview: false })
      .reusable,
  ).toBe(false);
  expect(
    reviewProofReuseDecision(proof, {
      ...proof,
      dependencies: { "producer.ts": "same" },
    }).reusable,
  ).toBe(false);
  expect(
    reviewProofReuseDecision(
      { ...proof, dependencies: {} },
      { ...proof, dependencies: {} },
    ).reusable,
  ).toBe(false);
});
