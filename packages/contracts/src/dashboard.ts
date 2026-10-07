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
export const workspaceRoleSchema = z.enum(["owner", "member"]);
export const workspaceAccessSchema = z.strictObject({
  workspaceId: dashboardIdSchema,
  role: workspaceRoleSchema,
});
export const workspaceTypeSchema = z.enum(["personal", "team"]);
export const workspaceDtoSchema = z.strictObject({
  id: dashboardIdSchema,
  type: workspaceTypeSchema,
  name: z.string().min(1).max(128),
});
export const workspaceMembershipDtoSchema = z.strictObject({
  workspaceId: dashboardIdSchema,
  userId: dashboardIdSchema,
  role: workspaceRoleSchema,
});
export const createTeamWorkspaceInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(128),
  operationId: dashboardIdSchema,
});
export const personalWorkspaceInputSchema = z.strictObject({});
export const tenancyOperationReceiptSchema = z.strictObject({
  operation_id: dashboardIdSchema,
  actor_user_id: dashboardIdSchema,
  action: z.literal("create_team"),
  payload_hash: z.string().length(64),
  target_workspace_id: dashboardIdSchema,
});

export const sessionUserDtoSchema = z.strictObject({
  id: dashboardIdSchema,
  name: z.string().min(1).max(256),
});
export const sessionDtoSchema = z.strictObject({
  id: dashboardIdSchema,
  expiresAt: z.iso.datetime(),
});
export const sessionOutputDtoSchema = z.strictObject({
  user: sessionUserDtoSchema,
  session: sessionDtoSchema,
});
export const admittedUserSchema = z.strictObject({
  id: dashboardIdSchema,
  name: z.string().min(1).max(256),
  sessionId: dashboardIdSchema,
  expiresAt: z.iso.datetime(),
  githubAccountId: z.string().min(1),
});
export const authSocialSignInInputSchema = z.strictObject({
  provider: z.literal("github"),
  callbackURL: z.string().optional(),
  disableRedirect: z.boolean().optional(),
});
export const authEnvironmentSchema = z.enum([
  "development",
  "preview",
  "production",
]);
export const githubAppAuthConfigSchema = z.strictObject({
  clientId: z.string().trim().min(1),
  clientSecret: z.string().trim().min(1),
  appOrigin: z.string().url(),
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
export type AdmittedUser = z.infer<typeof admittedUserSchema>;
export type AuthSocialSignInInput = z.infer<typeof authSocialSignInInputSchema>;
export type AuthEnvironment = z.infer<typeof authEnvironmentSchema>;
export type GitHubAppAuthConfig = z.infer<typeof githubAppAuthConfigSchema>;
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
