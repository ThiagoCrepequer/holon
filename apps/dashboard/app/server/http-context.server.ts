import type { WorkspaceCollaborationPort } from "@holon/application/collaboration-ports";
import type { WorkspaceTenancyPort } from "@holon/application/dashboard-ports";
import type { PersonalPreferencesPort } from "@holon/application/preferences-port";
import type { AuthService } from "@holon/auth/server";
import type { AdmittedUser, ReauthReceipt } from "@holon/contracts/dashboard";
import type {
  PrivateReviewCorePort,
  ReviewListInput,
  PrivateReviewPage,
} from "@holon/contracts/dashboard-reviews";
import type { RateLimitStorage } from "@holon/db/identity/server";
export interface DashboardServices {
  readonly reviewProjection?:
    | {
        list(input: ReviewListInput): Promise<PrivateReviewPage>;
        readScope(
          installationId: number,
          repositoryId: number,
        ): Promise<{
          generation: number;
          state: "active" | "rebuilding";
        } | null>;
      }
    | undefined;
  readonly reviewCore?: PrivateReviewCorePort | undefined;
  readonly authService?: AuthService | undefined;
  readonly tenancyPersistence?: WorkspaceTenancyPort | undefined;
  readonly preferencesPersistence?: PersonalPreferencesPort | undefined;
  readonly collaboration?:
    | (WorkspaceCollaborationPort & {
        createConnectionReauth(
          actor: AdmittedUser,
          workspaceId: string,
          installationId: number,
          action: "link" | "unlink",
        ): Promise<ReauthReceipt>;
      })
    | undefined;
  readonly authSecret?: string | undefined;
  readonly rateLimitStorage?: RateLimitStorage | undefined;
}

export interface ApiEnv {
  services: DashboardServices;
  origin: string;
  sessionCookies: string[];
}

export type SessionAdmission = (
  request: Request,
  services: DashboardServices,
  cookies: string[],
) => Promise<{ user: AdmittedUser; authHeaders: Headers }>;
export type MutationAdmission = <T>(
  request: Request,
  origin: string,
  services: DashboardServices,
  cookies: string[],
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
) => Promise<{ user: AdmittedUser; payload: T; authHeaders: Headers }>;
