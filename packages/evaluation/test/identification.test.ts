import { it, expect, vi } from "vitest";

import { identificationCorpus } from "../corpus/project-identification/index.js";
import { evaluateIdentification } from "../src/identification.js";
it("meets the offline corpus gate with independent declaration oracles", async () => {
  expect(new Set(identificationCorpus.map((c) => c.id)).size).toBe(44);
  expect(
    identificationCorpus.filter((c) => c.split === "holdout"),
  ).toHaveLength(11);
  expect(await evaluateIdentification()).toMatchObject({
    cases: 44,
    falseExact: 0,
    precision: 1,
    recall: 1,
    calls: 0,
    failures: 0,
  });
});
it("validates provider evidence and reports failures without logging payloads", async () => {
  const identify = vi.fn(async () => ({ selectedFactIds: ["invented"] }));
  const result = await evaluateIdentification({ identify });
  expect(result.failures).toBeGreaterThan(0);
  expect(result.falseExact).toBe(0);
  expect(result.calls).toBe(identify.mock.calls.length);
});
it("accepts valid bounded provider interpretations", async () => {
  expect(
    await evaluateIdentification({
      identify: async () => ({ selectedFactIds: [] }),
    }),
  ).toMatchObject({ falseExact: 0, precision: 1, recall: 1, failures: 0 });
});
