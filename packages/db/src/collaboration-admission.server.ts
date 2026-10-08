import type { AdmittedUser } from "@holon/contracts/dashboard";

import { CollaborationError } from "./collaboration-error.server.js";
export const currentActorSql = `EXISTS (SELECT 1 FROM session s JOIN account a ON a.userId=s.userId AND a.providerId='github' WHERE s.id=? AND s.userId=? AND s.expiresAt>CAST(unixepoch('subsec')*1000 AS INTEGER) AND a.accountId=?)`;
export function actorBindings(actor: AdmittedUser): [string, string, string] {
  return [actor.sessionId, actor.id, actor.githubAccountId];
}
export async function assertCollaborationActor(
  database: D1Database,
  actor: AdmittedUser,
) {
  const row = await database
    .prepare(`SELECT 1 AS admitted WHERE ${currentActorSql}`)
    .bind(...actorBindings(actor))
    .first();
  if (!row) throw new CollaborationError("denied");
}
export async function assertWorkspaceActor(
  database: D1Database,
  actor: AdmittedUser,
  workspaceId: string,
  owner = false,
  team = false,
) {
  const row = await database
    .prepare(
      `SELECT 1 AS admitted FROM membership m JOIN workspace w ON w.id=m.workspace_id WHERE m.workspace_id=? AND m.user_id=? AND (?=0 OR m.role='owner') AND (?=0 OR w.type='team') AND ${currentActorSql}`,
    )
    .bind(
      workspaceId,
      actor.id,
      owner ? 1 : 0,
      team ? 1 : 0,
      ...actorBindings(actor),
    )
    .first();
  if (!row) throw new CollaborationError("denied");
}
