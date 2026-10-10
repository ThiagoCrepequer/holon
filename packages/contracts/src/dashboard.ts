import { z } from "zod/mini";

// Disable JIT compilation to satisfy strict CSP without 'unsafe-eval'
z.config({ jitless: true });

// IDs are opaque; parsing them never grants authority.
export const dashboardIdSchema = z
  .string()
  .check(z.regex(/^[A-Za-z0-9_-]{1,128}$/u));
export const dashboardCursorSchema = z.nullable(dashboardIdSchema);
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
export const workspaceRoleSchema = z.enum(["owner", "member"]);
export const workspaceAccessSchema = z.strictObject({
  workspaceId: dashboardIdSchema,
  role: workspaceRoleSchema,
});
export const workspaceTypeSchema = z.enum(["personal", "team"]);
export const workspaceDtoSchema = z.strictObject({
  id: dashboardIdSchema,
  type: workspaceTypeSchema,
  name: z.string().check(z.minLength(1)).check(z.maxLength(128)),
});
export const workspaceMembershipDtoSchema = z.strictObject({
  workspaceId: dashboardIdSchema,
  userId: dashboardIdSchema,
  role: workspaceRoleSchema,
});
export const workspaceCreationSchema = z
  .strictObject({
    workspace: workspaceDtoSchema,
    membership: workspaceMembershipDtoSchema,
  })
  .check(
    z.refine((value) => value.workspace.id === value.membership.workspaceId, {
      message: "workspace_scope_mismatch",
    }),
  );
export const workspaceMemberPageSchema = z.strictObject({
  members: z
    .array(
      z.strictObject({
        userId: dashboardIdSchema,
        name: z.string().check(z.minLength(1)).check(z.maxLength(256)),
        role: workspaceRoleSchema,
      }),
    )
    .check(z.maxLength(100)),
  actorRole: workspaceRoleSchema,
  ownerCount: z.number().check(z.int()).check(z.positive()),
  nextCursor: z.nullable(dashboardIdSchema),
});
export type WorkspaceMemberPage = z.infer<typeof workspaceMemberPageSchema>;
export const createTeamWorkspaceInputSchema = z.strictObject({
  name: z
    .string()
    .check(z.trim())
    .check(z.minLength(1))
    .check(z.maxLength(128)),
  operationId: dashboardIdSchema,
});
export const personalWorkspaceInputSchema = z.strictObject({});
export const tenancyOperationReceiptSchema = z.strictObject({
  operation_id: dashboardIdSchema,
  actor_user_id: dashboardIdSchema,
  action: z.literal("create_team"),
  payload_hash: z.string().check(z.length(64)),
  target_workspace_id: dashboardIdSchema,
});

export const sessionUserDtoSchema = z.strictObject({
  id: dashboardIdSchema,
  name: z.string().check(z.minLength(1)).check(z.maxLength(256)),
});
export const sessionDtoSchema = z.strictObject({
  id: dashboardIdSchema,
  expiresAt: z.iso.datetime(),
});
export const sessionOutputDtoSchema = z.strictObject({
  user: sessionUserDtoSchema,
  session: sessionDtoSchema,
});
export const deviceBrowserLabelSchema = z.enum([
  "chrome",
  "firefox",
  "safari",
  "edge",
  "other",
]);
export const sessionDeviceDtoSchema = z.strictObject({
  id: dashboardIdSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  isCurrent: z.boolean(),
  label: deviceBrowserLabelSchema,
});
export const sessionDeviceListDtoSchema = z.strictObject({
  sessions: z.array(sessionDeviceDtoSchema).check(z.maxLength(100)),
  currentSessionId: dashboardIdSchema,
  nextCursor: z.nullable(dashboardIdSchema),
});
export const revokeSessionInputSchema = z.strictObject({});
export const revokeAllSessionsInputSchema = z.strictObject({});
export const signOutOutputSchema = z.strictObject({ success: z.literal(true) });
export const revokeSessionOutputSchema = z.strictObject({
  revoked: z.boolean(),
});
export const revokeAllSessionsOutputSchema = z.strictObject({
  revokedCount: z.number().check(z.int()).check(z.nonnegative()),
});
export const reauthActionSchema = z.enum([
  "promote",
  "demote",
  "remove",
  "leave",
]);
export const reauthInitInputSchema = z.strictObject({
  workspaceId: dashboardIdSchema,
  action: reauthActionSchema,
  targetUserId: dashboardIdSchema,
});
export const reauthReceiptSchema = z.strictObject({
  reauthIntentId: dashboardIdSchema,
  expiresAt: z.iso.datetime(),
});
export const promoteMemberInputSchema = z.strictObject({
  targetUserId: dashboardIdSchema,
  reauthIntentId: dashboardIdSchema,
});
export const demoteMemberInputSchema = z.strictObject({
  targetUserId: dashboardIdSchema,
  reauthIntentId: dashboardIdSchema,
});
export const removeMemberInputSchema = z.strictObject({
  targetUserId: dashboardIdSchema,
  reauthIntentId: dashboardIdSchema,
});
export const leaveWorkspaceInputSchema = z.strictObject({
  reauthIntentId: dashboardIdSchema,
});
export const admittedUserSchema = z.strictObject({
  id: dashboardIdSchema,
  name: z.string().check(z.minLength(1)).check(z.maxLength(256)),
  sessionId: dashboardIdSchema,
  expiresAt: z.iso.datetime(),
  githubAccountId: z.string().check(z.minLength(1)),
});
export const authSocialSignInInputSchema = z.strictObject({
  provider: z.literal("github"),
  callbackURL: z.optional(z.string()),
  disableRedirect: z.optional(z.boolean()),
  reauthIntentId: z.optional(dashboardIdSchema),
});
export const authEnvironmentSchema = z.enum([
  "development",
  "preview",
  "production",
]);
export const authRegisteredOriginsSchema = z.strictObject({
  preview: z.array(z.string().check(z.url())),
  production: z.array(z.string().check(z.url())),
});
export const authEnabledSchema = z.enum(["true", "false"]);
export const githubAppAuthConfigSchema = z.strictObject({
  clientId: z.string().check(z.trim()).check(z.minLength(1)),
  clientSecret: z.string().check(z.trim()).check(z.minLength(1)),
  appOrigin: z.string().check(z.url()),
  environment: authEnvironmentSchema,
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
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;
export type WorkspaceAccess = z.infer<typeof workspaceAccessSchema>;
export type WorkspaceType = z.infer<typeof workspaceTypeSchema>;
export type WorkspaceDto = z.infer<typeof workspaceDtoSchema>;
export type WorkspaceMembershipDto = z.infer<
  typeof workspaceMembershipDtoSchema
>;
export type CreateTeamWorkspaceInput = z.infer<
  typeof createTeamWorkspaceInputSchema
>;
export type PersonalWorkspaceInput = z.infer<
  typeof personalWorkspaceInputSchema
>;
export type TenancyOperationReceipt = z.infer<
  typeof tenancyOperationReceiptSchema
>;
export type SessionUserDto = z.infer<typeof sessionUserDtoSchema>;
export type SessionDto = z.infer<typeof sessionDtoSchema>;
export type SessionOutputDto = z.infer<typeof sessionOutputDtoSchema>;
export type DeviceBrowserLabel = z.infer<typeof deviceBrowserLabelSchema>;
export type SessionDeviceDto = z.infer<typeof sessionDeviceDtoSchema>;
export type SessionDeviceListDto = z.infer<typeof sessionDeviceListDtoSchema>;
export type RevokeSessionInput = z.infer<typeof revokeSessionInputSchema>;
export type RevokeAllSessionsInput = z.infer<
  typeof revokeAllSessionsInputSchema
>;
export type ReauthAction = z.infer<typeof reauthActionSchema>;
export type ReauthInitInput = z.infer<typeof reauthInitInputSchema>;
export type ReauthReceipt = z.infer<typeof reauthReceiptSchema>;
export type PromoteMemberInput = z.infer<typeof promoteMemberInputSchema>;
export type DemoteMemberInput = z.infer<typeof demoteMemberInputSchema>;
export type RemoveMemberInput = z.infer<typeof removeMemberInputSchema>;
export type LeaveWorkspaceInput = z.infer<typeof leaveWorkspaceInputSchema>;
export type AdmittedUser = z.infer<typeof admittedUserSchema>;
export type AuthSocialSignInInput = z.infer<typeof authSocialSignInInputSchema>;
export type AuthEnvironment = z.infer<typeof authEnvironmentSchema>;
export type AuthRegisteredOrigins = z.infer<typeof authRegisteredOriginsSchema>;
export type AuthEnabled = z.infer<typeof authEnabledSchema>;
export type GitHubAppAuthConfig = z.infer<typeof githubAppAuthConfigSchema>;
export type DeliveryWake = z.infer<typeof deliveryWakeSchema>;
export type DeliveryWakeResult = z.infer<typeof deliveryWakeResultSchema>;
