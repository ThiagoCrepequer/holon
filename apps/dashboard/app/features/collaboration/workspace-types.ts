export type Workspace = {
  workspace: { id: string; type: "personal" | "team"; name: string };
  role: "owner" | "member";
};

export type WorkspaceRequestStatus =
  | "idle"
  | "loading"
  | "ready"
  | "denied"
  | "reconnect"
  | "unconfirmed"
  | "rate_limited"
  | "unavailable";
