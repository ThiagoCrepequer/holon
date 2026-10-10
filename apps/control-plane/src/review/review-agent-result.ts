import { reviewEvidencePackSchema } from "@holon/contracts";
import { z } from "zod";

/** Internal child result: the durable model answer and its bounded host evidence. */
export const reviewAgentResultSchema = z.strictObject({
  output: z.unknown(),
  evidence: reviewEvidencePackSchema,
});
