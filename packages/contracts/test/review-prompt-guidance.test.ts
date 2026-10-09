import { expect, it } from "vitest";
import { z } from "zod";

import { modelReviewPromptSchema } from "../src/review-output.js";

it("exposes confirmed defects before observations and preserves the canonical anchor rule in the actual tool schema", () => {
  const schema = z.toJSONSchema(modelReviewPromptSchema);
  expect(Object.keys(schema.properties!)[0]).toBe("findings");
  const findings = schema.properties?.findings;
  const investigations = schema.properties?.investigations;
  if (typeof findings !== "object" || typeof investigations !== "object")
    throw new Error("Missing object schemas for review arrays");
  expect(findings.description).toContain("confirmed defects");
  expect(investigations.description).toContain("never replaces a finding");
  const finding = modelReviewPromptSchema.shape.findings.element;
  expect(finding.shape.location.shape.path.description).toContain(
    "changed producer",
  );
  expect(finding.shape.evidence.description).toContain("canonical patch");
});
