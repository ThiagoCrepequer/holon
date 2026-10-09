import { z } from "zod";

import {
  gitShaSchema,
  repositoryPathSchema,
  runIdSchema,
  positiveIntegerSchema,
} from "./shared.js";

/** Host-issued receipt for a bounded read of the exact checkout, never a model assertion. */
export const reviewEvidenceReceiptSchema = z
  .strictObject({
    id: z.string().regex(/^[a-f0-9]{64}$/u),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    runId: runIdSchema,
    headSha: gitShaSchema,
    path: repositoryPathSchema,
    startLine: positiveIntegerSchema,
    endLine: positiveIntegerSchema,
    truncated: z.boolean(),
  })
  .refine(
    (value) => value.endLine >= value.startLine,
    "Invalid evidence window",
  );
export const reviewEvidencePackSchema = z
  .array(
    z.strictObject({
      receipt: reviewEvidenceReceiptSchema,
      content: z.string().max(16_000),
    }),
  )
  .max(8)
  .refine(
    (items) =>
      new TextEncoder().encode(JSON.stringify(items)).byteLength <= 20_000,
    "Evidence pack exceeds its byte budget",
  );
export type ReviewEvidenceReceipt = z.infer<typeof reviewEvidenceReceiptSchema>;
export type ReviewEvidencePack = z.infer<typeof reviewEvidencePackSchema>;

const hash = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

export async function createReviewEvidenceReceipt(
  runId: string,
  path: string,
  startLine: number,
  endLine: number,
  content: string,
  truncated: boolean,
): Promise<ReviewEvidenceReceipt> {
  const digest = await hash(content);
  const headSha = runIdSchema
    .parse(runId)
    .split(":head:")[1]!
    .split(":base:")[0]!;
  const identity = {
    digest,
    runId,
    headSha,
    path,
    startLine,
    endLine,
    truncated,
  };
  return reviewEvidenceReceiptSchema.parse({
    ...identity,
    id: await hash(JSON.stringify(identity)),
  });
}

export async function validateReviewEvidencePack(
  raw: unknown,
  runId: string,
): Promise<ReviewEvidencePack> {
  const pack = reviewEvidencePackSchema.parse(raw);
  for (const item of pack) {
    const expected = await createReviewEvidenceReceipt(
      runId,
      item.receipt.path,
      item.receipt.startLine,
      item.receipt.endLine,
      item.content,
      item.receipt.truncated,
    );
    if (JSON.stringify(expected) !== JSON.stringify(item.receipt))
      throw new TypeError(
        "Evidence pack snapshot or content identity mismatch",
      );
  }
  return pack;
}
