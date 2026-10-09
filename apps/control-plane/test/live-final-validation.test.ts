import { expect, it } from "vitest";

import { finalValidationMetadata } from "../evaluation/live-final-validation.js";

it("reports validation fields without retaining model values or arbitrary error text", () => {
  const metadata = finalValidationMetadata(
    JSON.stringify({
      findings: [
        { diagnostic: "PRIVATE_VALUE", location: { path: "PRIVATE_PATH" } },
      ],
      summary: "PRIVATE_SUMMARY",
    }),
  );
  expect(metadata).toMatchObject({ jsonInvalid: false });
  expect(JSON.stringify(metadata)).toContain("findings.0");
  expect(JSON.stringify(metadata)).not.toContain("PRIVATE");
  expect(finalValidationMetadata("PRIVATE_INVALID_JSON")).toEqual({
    jsonInvalid: true,
  });
});

it("reports only value kinds at allowed schema paths", () => {
  const metadata = finalValidationMetadata(
    JSON.stringify({
      findings: [{ suggestion: { token: "PRIVATE_TOKEN" } }],
    }),
  );
  expect(metadata.promptValueKinds).toContain("findings.0.suggestion:object");
  expect(JSON.stringify(metadata)).not.toContain("PRIVATE_TOKEN");
  expect(JSON.stringify(metadata)).not.toContain("token");
});
