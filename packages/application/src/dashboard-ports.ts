import type {
  CreateTeamWorkspaceInput,
  DeliveryWake,
  DeliveryWakeResult,
  ReviewPage,
  SessionIdentity,
  WorkspaceAccess,
  WorkspaceDto,
  WorkspaceMembershipDto,
  WorkspaceRole,
} from "@holon/contracts/dashboard";

/** Implementations validate the session again on every request, without cookie cache. */
export interface DashboardIdentityPort {
  readSession(credential: string | undefined): Promise<SessionIdentity | null>;
}
/** Membership alone does not grant access to a private GitHub repository. */
export interface WorkspaceAccessPort {
  readMembership(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceAccess | null>;
}

export interface WorkspaceTenancyPort {
  provisionPersonalWorkspace(userId: string): Promise<{
    workspace: WorkspaceDto;
    membership: WorkspaceMembershipDto;
  }>;
  createTeamWorkspace(
    actorUserId: string,
    input: CreateTeamWorkspaceInput,
  ): Promise<{
    workspace: WorkspaceDto;
    membership: WorkspaceMembershipDto;
  }>;
  listUserWorkspaces(
    userId: string,
  ): Promise<Array<{ workspace: WorkspaceDto; role: WorkspaceRole }>>;
  readWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<{ workspace: WorkspaceDto; role: WorkspaceRole } | null>;
  readMembership(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceAccess | null>;
}

/** A wake-up is transport, not the durable invitation/delivery obligation. */
export interface EmailDeliveryPort {
  wake(input: DeliveryWake): Promise<DeliveryWakeResult>;
}

/** Constructed after session + membership + GitHub grants; never parsed from a browser body. */
export interface AuthorizedReviewScope {
  readonly userId: string;
  readonly workspaceId: string;
  readonly repositoryIds: readonly number[];
}
/** M5 adds list filters and detail without exposing a SQL handle or stored rows. */
export interface ReviewReadPort {
  list(
    scope: AuthorizedReviewScope,
    page: { readonly cursor: string | null; readonly limit: number },
  ): Promise<ReviewPage>;
}
