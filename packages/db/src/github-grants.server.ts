import type { AdmittedUser } from "@holon/contracts/dashboard";
import { installationIdSchema } from "@holon/contracts/dashboard-collaboration";

import {
  actorBindings,
  assertWorkspaceActor,
  currentActorSql,
} from "./collaboration-admission.server.js";
import { CollaborationError } from "./collaboration-error.server.js";
export interface GrantIdentity {
  accountId: string;
  credentialGeneration: number;
  installationId: number;
  connectionGeneration: number;
}
const nowSql = "CAST(unixepoch('subsec')*1000 AS INTEGER)";
export function createGrantPersistence(database: D1Database) {
  return {
    async read(
      actor: AdmittedUser,
      workspaceId: string,
      key: GrantIdentity,
    ): Promise<{ repositoryIds: number[]; expiresAt: number } | null> {
      await assertWorkspaceActor(database, actor, workspaceId);
      const row = await database
        .prepare(
          `SELECT g.repository_ids,g.expires_at FROM github_grant_cache g JOIN github_connection l ON l.installation_id=g.installation_id AND l.generation=g.connection_generation AND l.state='active' JOIN github_credential_state c ON c.account_id=g.account_id AND c.generation=g.credential_generation AND c.state='ready' WHERE g.user_id=? AND g.account_id=? AND g.credential_generation=? AND g.installation_id=? AND g.connection_generation=? AND g.expires_at>${nowSql} AND l.workspace_id=? AND ${currentActorSql}`,
        )
        .bind(
          actor.id,
          key.accountId,
          key.credentialGeneration,
          key.installationId,
          key.connectionGeneration,
          workspaceId,
          ...actorBindings(actor),
        )
        .first<{ repository_ids: string; expires_at: number }>();
      if (!row) return null;
      try {
        const parsed: unknown = JSON.parse(row.repository_ids);
        if (!Array.isArray(parsed)) throw new Error();
        return {
          repositoryIds: parsed.map((id) => installationIdSchema.parse(id)),
          expiresAt: row.expires_at,
        };
      } catch {
        throw new CollaborationError("unavailable");
      }
    },
    async write(
      actor: AdmittedUser,
      workspaceId: string,
      key: GrantIdentity,
      repositoryIds: readonly number[],
      observedAt: number,
    ): Promise<boolean> {
      const ids = repositoryIds.map((id) => installationIdSchema.parse(id));
      const res = await database
        .prepare(
          `INSERT INTO github_grant_cache(user_id,account_id,credential_generation,installation_id,connection_generation,repository_ids,expires_at) SELECT ?,?,?,?,?,?,? WHERE ${currentActorSql} AND EXISTS(SELECT 1 FROM membership WHERE user_id=? AND workspace_id=?) AND EXISTS(SELECT 1 FROM github_connection WHERE installation_id=? AND workspace_id=? AND generation=? AND state='active') AND EXISTS(SELECT 1 FROM github_credential_state WHERE account_id=? AND generation=? AND state='ready') AND ?>${nowSql} AND ?<=${nowSql} ON CONFLICT(user_id,account_id,installation_id) DO UPDATE SET credential_generation=excluded.credential_generation,connection_generation=excluded.connection_generation,repository_ids=excluded.repository_ids,expires_at=excluded.expires_at`,
        )
        .bind(
          actor.id,
          key.accountId,
          key.credentialGeneration,
          key.installationId,
          key.connectionGeneration,
          JSON.stringify(ids),
          observedAt + 60000,
          ...actorBindings(actor),
          actor.id,
          workspaceId,
          key.installationId,
          workspaceId,
          key.connectionGeneration,
          key.accountId,
          key.credentialGeneration,
          observedAt + 60000,
          observedAt,
        )
        .run();
      return res.meta.changes === 1;
    },
    async assertCurrent(
      actor: AdmittedUser,
      workspaceId: string,
      accountId: string,
      generation: number,
      connections: readonly {
        installationId: number;
        generation: number;
        grantExpiresAt: number;
      }[],
    ): Promise<void> {
      await assertWorkspaceActor(database, actor, workspaceId);
      const row = await database
        .prepare(
          `SELECT 1 FROM github_credential_state c JOIN account a ON a.id=c.account_id WHERE c.account_id=? AND c.generation=? AND c.state='ready' AND a.userId=? AND a.accountId=? AND ${currentActorSql} AND EXISTS(SELECT 1 FROM membership WHERE workspace_id=? AND user_id=?) AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM github_connection l WHERE l.workspace_id=? AND l.installation_id=json_extract(e.value,'$.installationId') AND l.generation=json_extract(e.value,'$.generation') AND l.state='active' AND json_extract(e.value,'$.grantExpiresAt')>${nowSql} AND EXISTS(SELECT 1 FROM github_grant_cache g WHERE g.user_id=a.userId AND g.account_id=c.account_id AND g.credential_generation=c.generation AND g.installation_id=l.installation_id AND g.connection_generation=l.generation AND g.expires_at>${nowSql})))`,
        )
        .bind(
          accountId,
          generation,
          actor.id,
          actor.githubAccountId,
          ...actorBindings(actor),
          workspaceId,
          actor.id,
          JSON.stringify(connections),
          workspaceId,
        )
        .first();
      if (!row) {
        await assertWorkspaceActor(database, actor, workspaceId);
        const credential = await database
          .prepare(
            "SELECT 1 FROM github_credential_state WHERE account_id=? AND generation=? AND state='ready'",
          )
          .bind(accountId, generation)
          .first();
        throw new CollaborationError(
          credential ? "denied" : "reconnect_required",
        );
      }
    },
  };
}
