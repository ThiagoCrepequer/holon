import { runStates } from "@holon/domain";
import { z } from "zod";

// IDs are opaque; parsing them never grants authority.
export const dashboardIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
export const dashboardLocaleSchema = z.enum(["en", "pt-BR"]);
export const dashboardErrorCodeSchema = z.enum([
  "invalid_request",
  "denied",
  "reconnect_required",
  "unavailable",
  "command_unknown",
  "rate_limited",
]);
export const dashboardErrorSchema = z.strictObject({
  error: z.strictObject({
    code: dashboardErrorCodeSchema,
    requestId: z.uuid(),
  }),
});
export const sessionIdentitySchema = z.strictObject({
  userId: dashboardIdSchema,
  sessionId: dashboardIdSchema,
  expiresAt: z.iso.datetime(),
});
export const workspaceAccessSchema = z.strictObject({
  workspaceId: dashboardIdSchema,
  role: z.enum(["owner", "member"]),
});
export const deliveryWakeSchema = z.strictObject({
  operationId: dashboardIdSchema,
});
export const deliveryWakeResultSchema = z.strictObject({
  status: z.enum(["accepted", "unavailable"]),
});
export type DashboardLocale = z.infer<typeof dashboardLocaleSchema>;
export type DashboardErrorCode = z.infer<typeof dashboardErrorCodeSchema>;
export type SessionIdentity = z.infer<typeof sessionIdentitySchema>;
export type WorkspaceAccess = z.infer<typeof workspaceAccessSchema>;
export type DeliveryWake = z.infer<typeof deliveryWakeSchema>;
export type DeliveryWakeResult = z.infer<typeof deliveryWakeResultSchema>;

// Metadata only. The read adapter must receive a server-authorized repository scope.
export const reviewSummarySchema = z.strictObject({
  runId: dashboardIdSchema,
  repositoryId: z.number().int().positive().safe(),
  pullRequestNumber: z.number().int().positive().safe(),
  state: z.enum(runStates),
  updatedAt: z.iso.datetime(),
});
export const reviewPageSchema = z.strictObject({
  items: z.array(reviewSummarySchema).max(50),
  nextCursor: z.string().min(1).max(512).nullable(),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;
export type ReviewPage = z.infer<typeof reviewPageSchema>;
