import type { FindingStatus } from "@holon/domain";
import { z } from "zod/mini";

export const findingStatusSchema: z.ZodMiniType<FindingStatus> = z.enum([
  "new",
  "persistent",
  "resolved",
  "obsolete",
  "reintroduced",
  "dismissed",
]);
