import {
  workspaceDtoSchema,
  workspaceCreationSchema,
  workspaceRoleSchema,
  workspaceMemberPageSchema,
  workspaceMembershipDtoSchema,
  reauthReceiptSchema,
  type ReauthAction,
  type CreateTeamWorkspaceInput,
} from "@holon/contracts/dashboard";
import {
  authorizedRepositoryListSchema,
  connectionListSchema,
  connectionDtoSchema,
  invitationDtoSchema,
  invitationListSchema,
  connectionCommandSchema,
  type CreateInvitation,
} from "@holon/contracts/dashboard-collaboration";

import {
  collaborationRequest,
  oauthRedirect,
  type CollaborationResponse,
} from "./collaboration-client.js";
import type { Workspace } from "./workspace-types.js";

export type WorkspaceResult<T> =
  | { status: "ready"; data: T }
  | Exclude<CollaborationResponse, { status: "ready" }>;

const base = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`;
const created = (raw: unknown, type: "personal" | "team", name?: string) => {
  const value = workspaceCreationSchema.parse(raw).workspace;
  if (value.type !== type || (name !== undefined && value.name !== name))
    throw new Error("creation_mismatch");
  return value;
};
const confirmed = (raw: unknown, flag: string) => {
  if (
    !raw ||
    typeof raw !== "object" ||
    !(flag in raw) ||
    Reflect.get(raw, flag) !== true
  )
    throw new Error("unconfirmed_command");
};
const invitation = (raw: unknown, id: string) => {
  const value = invitationDtoSchema.parse(raw);
  if (value.workspaceId !== id) throw new Error("scope_mismatch");
  return value;
};

/** HTTP and runtime validation stay behind the product operations used by the controller. */
export function workspaceData(csrf: string) {
  async function request<T>(
    path: string,
    signal: AbortSignal,
    parse: (data: unknown) => T,
    body?: unknown,
  ): Promise<WorkspaceResult<T>> {
    const result = await collaborationRequest(
      path,
      signal,
      body === undefined ? undefined : { csrf, body },
    );
    if (result.status !== "ready") return result;
    try {
      return { status: "ready", data: parse(result.data) };
    } catch {
      return { status: body === undefined ? "unavailable" : "unconfirmed" };
    }
  }
  return {
    workspaces: (signal: AbortSignal) =>
      request("/api/workspaces", signal, (raw): Workspace[] => {
        if (
          !raw ||
          typeof raw !== "object" ||
          !("workspaces" in raw) ||
          !Array.isArray(raw.workspaces)
        )
          throw new Error("invalid_workspaces");
        return raw.workspaces.map((row) => {
          if (!row || typeof row !== "object")
            throw new Error("invalid_workspace");
          return {
            workspace: workspaceDtoSchema.parse(row.workspace),
            role: workspaceRoleSchema.parse(row.role),
          };
        });
      }),
    createPersonal: (signal: AbortSignal) =>
      request(
        "/api/workspaces/personal",
        signal,
        (raw) => created(raw, "personal"),
        {},
      ),
    createTeam: (input: CreateTeamWorkspaceInput, signal: AbortSignal) =>
      request(
        "/api/workspaces/team",
        signal,
        (raw) => created(raw, "team", input.name),
        input,
      ),
    connections: (id: string, signal: AbortSignal) =>
      request(`${base(id)}/github`, signal, (raw) =>
        connectionListSchema.parse(raw),
      ),
    repositories: (id: string, signal: AbortSignal) =>
      request(`${base(id)}/github/repositories`, signal, (raw) =>
        authorizedRepositoryListSchema.parse(raw),
      ),
    members: (id: string, cursor: string | null, signal: AbortSignal) =>
      request(
        `${base(id)}/members${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        signal,
        (raw) => workspaceMemberPageSchema.parse(raw),
      ),
    invitations: (id: string, signal: AbortSignal) =>
      request(`${base(id)}/invitations`, signal, (raw) =>
        invitationListSchema.parse(raw).map((row) => invitation(row, id)),
      ),
    invite: (id: string, input: CreateInvitation, signal: AbortSignal) =>
      request(
        `${base(id)}/invitations`,
        signal,
        (raw) => {
          const value = invitation(raw, id);
          if (value.recipientEmail !== input.email)
            throw new Error("recipient_mismatch");
          return value;
        },
        input,
      ),
    cancel: (id: string, invitationId: string, signal: AbortSignal) =>
      request(
        `${base(id)}/invitations/${encodeURIComponent(invitationId)}/cancel`,
        signal,
        (raw) => {
          const value = invitation(raw, id);
          if (value.id !== invitationId) throw new Error("invitation_mismatch");
          return value;
        },
        {},
      ),
    async memberVerification(
      workspaceId: string,
      action: ReauthAction,
      targetUserId: string,
      signal: AbortSignal,
    ): Promise<WorkspaceResult<string>> {
      const result = await request(
        "/api/auth/reauth/init",
        signal,
        (raw) => reauthReceiptSchema.parse(raw),
        { workspaceId, action, targetUserId },
      );
      if (result.status !== "ready") return result;
      const parameters = new URLSearchParams({
        workspace: workspaceId,
        memberAction: action,
        targetUser: targetUserId,
        reauth: result.data.reauthIntentId,
      });
      if (typeof window !== "undefined") {
        const locale = new URL(window.location.href).searchParams.get("lang");
        if (locale) parameters.set("lang", locale);
      }
      const url = await oauthRedirect(
        {
          provider: "github",
          callbackURL: `/account?${parameters}`,
          reauthIntentId: result.data.reauthIntentId,
          disableRedirect: true,
        },
        signal,
      );
      return url ? { status: "ready", data: url } : { status: "unavailable" };
    },
    confirmConnection: (
      id: string,
      action: "link" | "unlink",
      input: unknown,
      signal: AbortSignal,
    ) =>
      request(
        `${base(id)}/github/${action}`,
        signal,
        (raw) => {
          if (action === "link") {
            const value = connectionDtoSchema.parse(raw);
            if (
              value.installationId !==
              connectionCommandSchema.parse(input).installationId
            )
              throw new Error("installation_mismatch");
          } else confirmed(raw, "unlinked");
        },
        connectionCommandSchema.parse(input),
      ),
    confirmMember: (
      id: string,
      action: "promote" | "demote" | "remove" | "leave",
      proof: string,
      target: string,
      signal: AbortSignal,
    ) =>
      request(
        action === "leave"
          ? `${base(id)}/leave`
          : `${base(id)}/members/${action}`,
        signal,
        (raw) => {
          if (action === "promote" || action === "demote") {
            const value = workspaceMembershipDtoSchema.parse(raw);
            if (
              value.workspaceId !== id ||
              value.userId !== target ||
              value.role !== (action === "promote" ? "owner" : "member")
            )
              throw new Error("membership_mismatch");
          } else confirmed(raw, action === "leave" ? "left" : "removed");
        },
        {
          reauthIntentId: proof,
          ...(action === "leave" ? {} : { targetUserId: target }),
        },
      ),
  };
}
