import type { AdmittedUser } from "@holon/contracts/dashboard";
import type {
  CreateInvitation,
  InvitationDto,
  ConnectionCommand,
  ConnectionDto,
} from "@holon/contracts/dashboard-collaboration";

import type { AuthorizedReviewScope } from "./dashboard-ports.js";
export interface WorkspaceCollaborationPort {
  createInvitation(
    actor: AdmittedUser,
    workspaceId: string,
    input: CreateInvitation,
  ): Promise<InvitationDto>;
  listInvitations(
    actor: AdmittedUser,
    workspaceId: string,
  ): Promise<InvitationDto[]>;
  acceptInvitation(
    actor: AdmittedUser,
    invitationId: string,
  ): Promise<{ status: "accepted"; membershipActive: boolean }>;
  cancelInvitation(
    actor: AdmittedUser,
    workspaceId: string,
    invitationId: string,
  ): Promise<InvitationDto>;
  listConnections(
    actor: AdmittedUser,
    workspaceId: string,
  ): Promise<ConnectionDto[]>;
  linkInstallation(
    actor: AdmittedUser,
    workspaceId: string,
    input: ConnectionCommand,
  ): Promise<ConnectionDto>;
  unlinkInstallation(
    actor: AdmittedUser,
    workspaceId: string,
    input: ConnectionCommand,
  ): Promise<{ unlinked: true }>;
  authorizeReviews(
    actor: AdmittedUser,
    workspaceId: string,
  ): Promise<AuthorizedReviewScope>;
  connectionStatus(
    actor: AdmittedUser,
  ): Promise<{ status: "connected" | "refreshing" | "reconnect_required" }>;
}
