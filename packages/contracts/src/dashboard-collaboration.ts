import { z } from "zod";

import { dashboardIdSchema, dashboardLocaleSchema } from "./dashboard.js";

export const installationIdSchema = z.number().int().positive().safe();
export const invitationEmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email()
  .transform((value) => value.toLowerCase());
export const createInvitationSchema = z.strictObject({
  operationId: dashboardIdSchema,
  email: invitationEmailSchema,
  locale: dashboardLocaleSchema,
});
export const emptyCollaborationCommandSchema = z.strictObject({});
export const connectionCommandSchema = z.strictObject({
  installationId: installationIdSchema,
  reauthIntentId: dashboardIdSchema,
});
export const invitationDtoSchema = z.strictObject({
  id: dashboardIdSchema,
  workspaceId: dashboardIdSchema,
  recipientEmail: invitationEmailSchema,
  state: z.enum(["pending", "accepted", "canceled", "expired"]),
  expiresAt: z.iso.datetime(),
  delivery: z.literal("intent_recorded"),
});
export const invitationListSchema = z.array(invitationDtoSchema).max(100);
export const connectionDtoSchema = z.strictObject({
  installationId: installationIdSchema,
  state: z.enum(["active", "suspended", "revoked"]),
  generation: z.number().int().positive().safe(),
});
export const connectionListSchema = z.array(connectionDtoSchema).max(10000);
export const githubConnectionStatusSchema = z.strictObject({
  status: z.enum(["connected", "refreshing", "reconnect_required"]),
});
// GitHub responses are additive external contracts; only the fields used below are admitted.
export const githubUserSchema = z.object({ id: installationIdSchema });
export const githubInstallationSchema = z.object({
  id: installationIdSchema,
  app_id: installationIdSchema,
  account: z.object({
    id: installationIdSchema,
    type: z.enum(["User", "Organization"]),
    login: z.string().min(1).max(100),
  }),
  suspended_at: z.string().nullable(),
});
export const githubInstallationsSchema = z.object({
  total_count: z.number().int().nonnegative().safe(),
  installations: z.array(githubInstallationSchema).max(100),
});
export const githubMembershipSchema = z.object({
  state: z.enum(["active", "pending"]),
  role: z.enum(["admin", "member"]),
  organization: z.object({ id: installationIdSchema }),
});
export const githubMembershipsSchema = z.array(githubMembershipSchema).max(100);
export const githubRepositoriesSchema = z.object({
  total_count: z.number().int().nonnegative().safe(),
  repositories: z.array(z.object({ id: installationIdSchema })).max(100),
});
export const githubEmailsSchema = z
  .array(
    z.object({
      email: invitationEmailSchema,
      verified: z.boolean(),
      primary: z.boolean(),
    }),
  )
  .max(100);
export const githubRefreshSchema = z.object({
  access_token: z.string().min(1).max(4096),
  refresh_token: z.string().min(1).max(4096),
  expires_in: z.number().int().positive().max(86400),
  refresh_token_expires_in: z.number().int().positive().max(31536000),
  token_type: z.literal("bearer"),
});
export type CreateInvitation = z.infer<typeof createInvitationSchema>;
export type InvitationDto = z.infer<typeof invitationDtoSchema>;
export type ConnectionCommand = z.infer<typeof connectionCommandSchema>;
export type ConnectionDto = z.infer<typeof connectionDtoSchema>;
export type GitHubInstallation = z.infer<typeof githubInstallationSchema>;

export const connectionReauthSchema = z.strictObject({
  workspaceId: dashboardIdSchema,
  installationId: installationIdSchema,
  action: z.enum(["link", "unlink"]),
});
export const githubAccessEventSchema = z.union([
  z.strictObject({
    deliveryId: dashboardIdSchema,
    installationId: installationIdSchema,
    action: z.enum(["suspended", "revoked", "repositories_changed"]),
  }),
  z.strictObject({
    deliveryId: dashboardIdSchema,
    action: z.literal("user_revoked"),
    githubAccountId: z.string().regex(/^\d+$/),
  }),
]);
export const githubAuthorizationRevocationSchema = z.object({
  action: z.literal("revoked"),
  sender: z.object({ id: installationIdSchema }),
});
export const githubAccessQueueMessageSchema = z.strictObject({
  event: z.literal("github_access"),
  access: githubAccessEventSchema,
});
export type GitHubAccessEvent = z.infer<typeof githubAccessEventSchema>;

export const authSecretRingSchema = z
  .array(
    z.strictObject({
      version: z.number().int().nonnegative().safe(),
      value: z.string().min(32),
    }),
  )
  .min(1)
  .max(5)
  .superRefine((keys, ctx) => {
    if (new Set(keys.map((k) => k.version)).size !== keys.length)
      ctx.addIssue({ code: "custom", message: "duplicate secret version" });
  });
