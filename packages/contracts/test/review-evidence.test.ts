import { expect, it } from "vitest";

import {
  createReviewEvidenceReceipt,
  validateReviewEvidencePack,
} from "../src/index.js";
const runId = `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`;
it("binds receipts to snapshot, window and exact content", async () => {
  const content = "if (value == null) return;";
  const receipt = await createReviewEvidenceReceipt(
    runId,
    "src/caller.ts",
    1,
    1,
    content,
    false,
  );
  expect(
    await validateReviewEvidencePack([{ receipt, content }], runId),
  ).toHaveLength(1);
  await expect(
    validateReviewEvidencePack(
      [{ receipt, content: content.replace("==", "!=") }],
      runId,
    ),
  ).rejects.toThrow(/identity/u);
  await expect(
    validateReviewEvidencePack(
      [{ receipt, content }],
      runId.replace("head:" + "a".repeat(40), "head:" + "c".repeat(40)),
    ),
  ).rejects.toThrow(/identity/u);
  await expect(
    validateReviewEvidencePack(
      [{ receipt: { ...receipt, startLine: 2, endLine: 2 }, content }],
      runId,
    ),
  ).rejects.toThrow(/identity/u);
});
