import { z } from "zod/mini";

import { dashboardIdSchema, dashboardLocaleSchema } from "./dashboard.js";

export const installationIdSchema = z
  .number()
  .check(z.int())
  .check(z.positive());
export const invitationEmailSchema = z.pipe(
  z
    .string()
    .check(z.trim())
    .check(z.minLength(3))
    .check(z.maxLength(254))
    .check(z.email()),
  z.transform((value) => value.toLowerCase()),
);
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
  delivery: z.enum([
    "intent_recorded",
    "provider_accepted",
    "failed",
    "result_unknown",
    "delivery_canceled",
  ]),
});
export const invitationListSchema = z
  .array(invitationDtoSchema)
  .check(z.maxLength(100));
export const connectionDtoSchema = z.strictObject({
  installationId: installationIdSchema,
  state: z.enum(["active", "suspended", "revoked"]),
  generation: z.number().check(z.int()).check(z.positive()),
});
export const connectionListSchema = z
  .array(connectionDtoSchema)
  .check(z.maxLength(10000));
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
    login: z.string().check(z.minLength(1)).check(z.maxLength(100)),
  }),
  suspended_at: z.nullable(z.string()),
});
export const githubInstallationsSchema = z.object({
  total_count: z.number().check(z.int()).check(z.nonnegative()),
  installations: z.array(githubInstallationSchema).check(z.maxLength(100)),
});
export const githubMembershipSchema = z.object({
  state: z.enum(["active", "pending"]),
  role: z.enum(["admin", "member"]),
  organization: z.object({ id: installationIdSchema }),
});
export const githubMembershipsSchema = z
  .array(githubMembershipSchema)
  .check(z.maxLength(100));
export const githubRepositoriesSchema = z.object({
  total_count: z.number().check(z.int()).check(z.nonnegative()),
  repositories: z
    .array(
      z.object({
        id: installationIdSchema,
        full_name: z.string().check(z.minLength(3)).check(z.maxLength(256)),
      }),
    )
    .check(z.maxLength(100)),
});
export const githubEmailsSchema = z
  .array(
    z.object({
      email: invitationEmailSchema,
      verified: z.boolean(),
      primary: z.boolean(),
    }),
  )
  .check(z.maxLength(100));
export const githubRefreshSchema = z.object({
  access_token: z.string().check(z.minLength(1)).check(z.maxLength(4096)),
  refresh_token: z.string().check(z.minLength(1)).check(z.maxLength(4096)),
  expires_in: z.number().check(z.int()).check(z.positive()).check(z.lte(86400)),
  refresh_token_expires_in: z
    .number()
    .check(z.int())
    .check(z.positive())
    .check(z.lte(31536000)),
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
    githubAccountId: z.string().check(z.regex(/^\d+$/)),
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
      version: z.number().check(z.int()).check(z.nonnegative()),
      value: z.string().check(z.minLength(32)),
    }),
  )
  .check(z.minLength(1))
  .check(z.maxLength(5))
  .check(
    z.superRefine((keys, ctx) => {
      if (new Set(keys.map((k) => k.version)).size !== keys.length)
        ctx.addIssue({ code: "custom", message: "duplicate secret version" });
    }),
  );

export const authorizedRepositoryListSchema = z.strictObject({
  repositories: z
    .array(
      z.strictObject({
        installationId: installationIdSchema,
        repositoryId: installationIdSchema,
        fullName: z.string().check(z.minLength(3)).check(z.maxLength(256)),
      }),
    )
    .check(z.maxLength(10000)),
});
export type AuthorizedRepositoryList = z.infer<
  typeof authorizedRepositoryListSchema
>;
