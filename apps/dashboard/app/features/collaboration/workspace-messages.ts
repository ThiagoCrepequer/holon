import type { I18n } from "@lingui/core";
export function workspaceMessages(i18n: I18n) {
  return {
    title: i18n._({
      id: "collaboration.title",
      message: "Workspaces and access",
    }),
    load: i18n._({ id: "collaboration.load", message: "Manage workspaces" }),
    workspace: i18n._({ id: "collaboration.workspace", message: "Workspace" }),
    choose: i18n._({
      id: "collaboration.choose",
      message: "Choose a workspace",
    }),
    loading: i18n._({
      id: "collaboration.loading",
      message: "Confirming current access…",
    }),
    ready: i18n._({
      id: "collaboration.ready",
      message: "Current state confirmed.",
    }),
    unavailable: i18n._({
      id: "collaboration.unavailable",
      message: "Unable to confirm access. Retry the same action.",
    }),
    denied: i18n._({
      id: "collaboration.denied",
      message: "Access denied. Reload your workspaces.",
    }),
    reconnect: i18n._({
      id: "collaboration.reconnect",
      message: "Reconnect the same GitHub account to continue.",
    }),
    unconfirmed: i18n._({
      id: "collaboration.unconfirmed",
      message:
        "Result unknown. Retry the same invitation to confirm its original intention.",
    }),
    rate: i18n._({
      id: "collaboration.rate",
      message: "Too many requests. Wait one minute before retrying.",
    }),
    github: i18n._({
      id: "collaboration.github",
      message: "GitHub connections",
    }),
    refresh: i18n._({
      id: "collaboration.refresh",
      message: "Refresh connections",
    }),
    invitationTitle: i18n._({
      id: "collaboration.invitations",
      message: "Workspace invitations",
    }),
    email: i18n._({ id: "collaboration.email", message: "Recipient email" }),
    invite: i18n._({
      id: "collaboration.invite",
      message: "Record invitation",
    }),
    notice: i18n._({
      id: "collaboration.notice",
      message:
        "An invitation records a delivery intention. It does not confirm email delivery. Canceling stops future sends; a message already in flight may still arrive.",
    }),
    privacy: i18n._({
      id: "collaboration.privacy",
      message:
        "The invitation link reveals no workspace details. Acceptance requires the recipient’s currently verified GitHub email and grants only member access.",
    }),
    cancel: i18n._({
      id: "collaboration.cancel",
      message: "Cancel invitation",
    }),
    list: i18n._({ id: "collaboration.list", message: "Refresh invitations" }),
    installation: i18n._({
      id: "collaboration.installation",
      message: "GitHub installation ID",
    }),
    link: i18n._({
      id: "collaboration.link",
      message: "Verify ownership and link",
    }),
    unlink: i18n._({
      id: "collaboration.unlink",
      message: "Verify identity and unlink",
    }),
    confirm: i18n._({
      id: "collaboration.confirm",
      message: "Confirm connection change",
    }),
    personal: i18n._({
      id: "collaboration.personal",
      message: "Create my personal workspace",
    }),
    team: i18n._({ id: "collaboration.team", message: "Team name" }),
    createTeam: i18n._({
      id: "collaboration.createTeam",
      message: "Create team",
    }),
    pending: i18n._({ id: "collaboration.pending", message: "Pending" }),
    accepted: i18n._({ id: "collaboration.accepted", message: "Accepted" }),
    canceled: i18n._({ id: "collaboration.canceled", message: "Canceled" }),
    expired: i18n._({ id: "collaboration.expired", message: "Expired" }),
    active: i18n._({ id: "collaboration.active", message: "Active" }),
    suspended: i18n._({ id: "collaboration.suspended", message: "Suspended" }),
    reconnectAction: i18n._({
      id: "collaboration.reconnectAction",
      message: "Reconnect GitHub",
    }),
    revoked: i18n._({ id: "collaboration.revoked", message: "Revoked" }),
  };
}
export type WorkspaceMessages = ReturnType<typeof workspaceMessages>;
