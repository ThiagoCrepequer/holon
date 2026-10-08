import type { AdmittedUser, ReauthReceipt } from "@holon/contracts/dashboard";
import {
  connectionDtoSchema,
  githubAccessEventSchema,
  type ConnectionCommand,
  type ConnectionDto,
  type GitHubAccessEvent,
} from "@holon/contracts/dashboard-collaboration";

import {
  actorBindings,
  assertWorkspaceActor,
  currentActorSql,
} from "./collaboration-admission.server.js";
import { CollaborationError } from "./collaboration-error.server.js";
export interface InstallationProof {
  accountId: string;
  credentialGeneration: number;
  installationId: number;
  accountOwnerId: number;
}
const nowSql = "CAST(unixepoch('subsec')*1000 AS INTEGER)";
const ownerSql = `EXISTS(SELECT 1 FROM membership WHERE workspace_id=? AND user_id=? AND role='owner')`;
export function createConnectionPersistence(database: D1Database) {
  return {
    async createReauth(
      actor: AdmittedUser,
      workspaceId: string,
      installationId: number,
      action: "link" | "unlink",
    ): Promise<ReauthReceipt> {
      await assertWorkspaceActor(database, actor, workspaceId, true);
      const id = `reauth_${crypto.randomUUID().replace(/-/g, "")}`;
      const now = Date.now();
      const expires = now + 600000;
      const res = await database
        .prepare(
          `INSERT INTO reauth_intent(id,user_id,account_id,original_session_id,workspace_id,action,target_user_id,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${currentActorSql} AND ${ownerSql}`,
        )
        .bind(
          id,
          actor.id,
          actor.githubAccountId,
          actor.sessionId,
          workspaceId,
          action,
          String(installationId),
          now,
          expires,
          ...actorBindings(actor),
          workspaceId,
          actor.id,
        )
        .run();
      if (res.meta.changes !== 1) throw new CollaborationError("denied");
      return { reauthIntentId: id, expiresAt: new Date(expires).toISOString() };
    },
    async list(
      actor: AdmittedUser,
      workspaceId: string,
    ): Promise<ConnectionDto[]> {
      await assertWorkspaceActor(database, actor, workspaceId);
      const result = await database
        .prepare(
          `SELECT installation_id AS installationId,state,generation FROM github_connection WHERE workspace_id=? AND ${currentActorSql} AND EXISTS(SELECT 1 FROM membership WHERE workspace_id=? AND user_id=?) ORDER BY installation_id`,
        )
        .bind(workspaceId, ...actorBindings(actor), workspaceId, actor.id)
        .all();
      return result.results.map((row) => connectionDtoSchema.parse(row));
    },
    async mutate(
      actor: AdmittedUser,
      workspaceId: string,
      input: ConnectionCommand,
      action: "link" | "unlink",
      proof: InstallationProof,
    ): Promise<ConnectionDto | null> {
      await assertWorkspaceActor(database, actor, workspaceId, true);
      if (proof.installationId !== input.installationId)
        throw new CollaborationError("denied");
      const attempt = crypto.randomUUID();
      const guard = database
        .prepare(
          `INSERT INTO collaboration_guard SELECT ?,CASE WHEN ${currentActorSql} AND ${ownerSql} AND EXISTS(SELECT 1 FROM reauth_intent WHERE id=? AND user_id=? AND account_id=? AND proof_session_id=? AND workspace_id=? AND action=? AND target_user_id=? AND confirmed_at IS NOT NULL AND consumed_at IS NULL AND expires_at>${nowSql}) AND EXISTS(SELECT 1 FROM github_credential_state c JOIN account a ON a.id=c.account_id WHERE a.id=? AND a.userId=? AND a.accountId=? AND c.generation=? AND c.state='ready') AND NOT EXISTS(SELECT 1 FROM github_connection WHERE installation_id=? AND workspace_id!=?) THEN 1 ELSE 0 END`,
        )
        .bind(
          attempt,
          ...actorBindings(actor),
          workspaceId,
          actor.id,
          input.reauthIntentId,
          actor.id,
          actor.githubAccountId,
          actor.sessionId,
          workspaceId,
          action,
          String(input.installationId),
          proof.accountId,
          actor.id,
          actor.githubAccountId,
          proof.credentialGeneration,
          input.installationId,
          workspaceId,
        );
      const mutation =
        action === "link"
          ? database
              .prepare(
                `INSERT INTO github_connection(installation_id,workspace_id,account_owner_id,state,generation,created_by,updated_at) SELECT ?,?,?,'active',1,?,${nowSql} WHERE EXISTS(SELECT 1 FROM collaboration_guard WHERE attempt_id=? AND admitted=1) ON CONFLICT(installation_id) DO UPDATE SET state='active',generation=github_connection.generation+1,updated_at=${nowSql} WHERE github_connection.workspace_id=excluded.workspace_id`,
              )
              .bind(
                input.installationId,
                workspaceId,
                proof.accountOwnerId,
                actor.id,
                attempt,
              )
          : database
              .prepare(
                `UPDATE github_connection SET state='revoked',generation=generation+1,updated_at=${nowSql} WHERE installation_id=? AND workspace_id=? AND EXISTS(SELECT 1 FROM collaboration_guard WHERE attempt_id=? AND admitted=1)`,
              )
              .bind(input.installationId, workspaceId, attempt);
      let results: D1Result[];
      try {
        results = await database.batch([
          guard,
          mutation,
          database
            .prepare(
              `UPDATE reauth_intent SET consumed_at=${nowSql} WHERE id=? AND EXISTS(SELECT 1 FROM collaboration_guard WHERE attempt_id=? AND admitted=1)`,
            )
            .bind(input.reauthIntentId, attempt),
          database
            .prepare("DELETE FROM collaboration_guard WHERE attempt_id=?")
            .bind(attempt),
        ]);
      } catch {
        throw new CollaborationError("command_unknown");
      }
      if ((results[1]?.meta.changes ?? 0) === 0)
        throw new CollaborationError("denied");
      const row = await database
        .prepare(
          "SELECT installation_id AS installationId,state,generation FROM github_connection WHERE installation_id=? AND workspace_id=?",
        )
        .bind(input.installationId, workspaceId)
        .first();
      return row ? connectionDtoSchema.parse(row) : null;
    },
    async applyEvent(raw: GitHubAccessEvent): Promise<void> {
      const event = githubAccessEventSchema.parse(raw);
      const attempt = crypto.randomUUID();
      const guard = database
        .prepare(
          `INSERT INTO github_access_event_receipt VALUES(?,?,${nowSql}) ON CONFLICT(delivery_id) DO NOTHING`,
        )
        .bind(event.deliveryId, attempt);
      const seenSql = `EXISTS(SELECT 1 FROM github_access_event_receipt WHERE delivery_id=? AND attempt_id=?)`;
      const mutation =
        event.action === "user_revoked"
          ? database
              .prepare(
                `UPDATE github_credential_state SET state='reconnect_required',generation=generation+1,claim_id=NULL,claim_until=NULL WHERE account_id IN(SELECT id FROM account WHERE providerId='github' AND accountId=?) AND ${seenSql}`,
              )
              .bind(event.githubAccountId, event.deliveryId, attempt)
          : database
              .prepare(
                `UPDATE github_connection SET state=COALESCE(?,state),generation=generation+1,updated_at=${nowSql} WHERE installation_id=? AND ${seenSql}`,
              )
              .bind(
                event.action === "repositories_changed" ? null : event.action,
                event.installationId,
                event.deliveryId,
                attempt,
              );
      await database.batch([guard, mutation]);
    },
  };
}
