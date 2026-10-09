import { z } from "zod";

import { invitationEmailSchema } from "./dashboard-collaboration.js";
import { dashboardIdSchema, dashboardLocaleSchema } from "./dashboard.js";

export const emailJobSchema = z.strictObject({ jobId: dashboardIdSchema });
export const emailAttemptSchema = emailJobSchema.extend({
  attemptId: z.uuid(),
  generation: z.number().int().positive().safe(),
});
export const emailClaimSchema = emailAttemptSchema.extend({
  leaseUntil: z.number().int().positive().safe(),
});
export const emailContextSchema = z.strictObject({
  jobId: dashboardIdSchema,
  recipient: invitationEmailSchema,
  locale: dashboardLocaleSchema,
  workspaceName: z.string().min(1).max(200),
  expiresAt: z.iso.datetime(),
});
export const emailOutcomeSchema = z.enum([
  "accepted",
  "transient",
  "permanent",
  "unknown",
]);
export const emailResultSchema = emailAttemptSchema.extend({
  outcome: emailOutcomeSchema,
});
export const emailReceiptSchema = z.strictObject({ recorded: z.boolean() });
export type EmailAttempt = z.infer<typeof emailAttemptSchema>;
export type EmailClaim = z.infer<typeof emailClaimSchema>;
export type EmailContext = z.infer<typeof emailContextSchema>;
export type EmailResult = z.infer<typeof emailResultSchema>;
export interface EmailDeliveryAuthorityPort {
  claim(input: unknown): Promise<EmailClaim | null>;
  start(input: unknown): Promise<EmailContext | null>;
  record(input: unknown): Promise<z.infer<typeof emailReceiptSchema>>;
}
