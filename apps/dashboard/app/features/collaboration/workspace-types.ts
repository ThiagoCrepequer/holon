export type Workspace = {
  workspace: { id: string; type: "personal" | "team"; name: string };
  role: "owner" | "member";
};

export type CollaborationRun = (
  path: string,
  body: unknown,
  onReady: (data: unknown) => void,
) => Promise<void>;
