import type { AdmittedUser } from "@holon/contracts/dashboard";
import {
  createInvitationSchema,
  invitationDtoSchema,
  type CreateInvitation,
  type InvitationDto,
} from "@holon/contracts/dashboard-collaboration";

import {
  actorBindings,
  assertCollaborationActor,
  assertWorkspaceActor,
  currentActorSql,
} from "./collaboration-admission.server.js";
import { CollaborationError } from "./collaboration-error.server.js";

export interface RecipientProof {
  accountId: string;
  generation: number;
  verifiedEmails: readonly string[];
}
interface InvitationRow {
  id: string;
  workspace_id: string;
  created_by: string;
  operation_id: string;
  email: string;
  locale: string;
  state: "pending" | "accepted" | "canceled" | "expired";
  expires_at: number;
  accepted_by: string | null;
  delivery_state: string | null;
  accepted_at: number | null;
  last_outcome: string | null;
}
const invitationSelect = `SELECT i.*,(SELECT state FROM invitation_delivery_intent WHERE id=i.id) AS delivery_state,(SELECT accepted_at FROM invitation_delivery_intent WHERE id=i.id) AS accepted_at,(SELECT last_outcome FROM invitation_delivery_intent WHERE id=i.id) AS last_outcome FROM workspace_invitation i`;
const nowSql = "CAST(unixepoch('subsec')*1000 AS INTEGER)";
function dto(row: InvitationRow): InvitationDto {
  return invitationDtoSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    recipientEmail: row.email,
    state:
      row.state === "pending" && row.expires_at <= Date.now()
        ? "expired"
        : row.state,
    expiresAt: new Date(row.expires_at).toISOString(),
    delivery:
      row.accepted_at !== null && row.accepted_at !== undefined
        ? "provider_accepted"
        : row.delivery_state === "failed"
          ? "failed"
          : row.delivery_state === "canceled"
            ? "delivery_canceled"
            : row.last_outcome === "unknown"
              ? "result_unknown"
              : "intent_recorded",
  });
}
export function createInvitationPersistence(database: D1Database) {
  async function read(id: string) {
    return database
      .prepare(`${invitationSelect} WHERE i.id=?`)
      .bind(id)
      .first<InvitationRow>();
  }
  async function guarded(statements: D1PreparedStatement[]) {
    try {
      return await database.batch(statements);
    } catch {
      throw new CollaborationError("command_unknown");
    }
  }
  const ownerSql = `EXISTS(SELECT 1 FROM membership m JOIN workspace w ON w.id=m.workspace_id WHERE m.user_id=? AND w.id=? AND m.role='owner' AND w.type='team')`;
  return {
    async create(
      actor: AdmittedUser,
      workspaceId: string,
      raw: CreateInvitation,
    ): Promise<InvitationDto> {
      const input = createInvitationSchema.parse(raw);
      await assertWorkspaceActor(database, actor, workspaceId, true, true);
      const previous = await database
        .prepare(`${invitationSelect} WHERE created_by=? AND operation_id=?`)
        .bind(actor.id, input.operationId)
        .first<InvitationRow>();
      if (previous) {
        if (
          previous.workspace_id !== workspaceId ||
          previous.email !== input.email ||
          previous.locale !== input.locale
        )
          throw new CollaborationError("conflict");
        return dto(previous);
      }
      const id = `invite_${crypto.randomUUID().replace(/-/g, "")}`;
      const attempt = crypto.randomUUID();
      const now = Date.now();
      const expires = now + 7 * 86400000;
      const actorScope = `actor:${actor.id}:${workspaceId}`;
      const workspaceScope = `workspace:${workspaceId}`;
      const budgetSql = `NOT EXISTS(SELECT 1 FROM invitation_budget WHERE (scope=? AND used>=10 OR scope=? AND used>=30) AND window_start>${nowSql}-60000)`;
      const results = await guarded([
        database
          .prepare(
            `INSERT INTO collaboration_guard SELECT ?, CASE WHEN ${currentActorSql} AND ${ownerSql} AND ${budgetSql} THEN 1 ELSE 0 END`,
          )
          .bind(
            attempt,
            ...actorBindings(actor),
            actor.id,
            workspaceId,
            actorScope,
            workspaceScope,
          ),
        database
          .prepare(
            `INSERT INTO workspace_invitation(id,workspace_id,created_by,operation_id,email,locale,state,created_at,expires_at) SELECT ?,?,?,?,?,?,'pending',?,? WHERE EXISTS(SELECT 1 FROM collaboration_guard WHERE attempt_id=? AND admitted=1) ON CONFLICT(created_by,operation_id) DO NOTHING`,
          )
          .bind(
            id,
            workspaceId,
            actor.id,
            input.operationId,
            input.email,
            input.locale,
            now,
            expires,
            attempt,
          ),
        database
          .prepare(
            `INSERT INTO invitation_delivery_intent(id,state,next_action_at,deadline) SELECT id,'pending',created_at,expires_at FROM workspace_invitation WHERE id=?`,
          )
          .bind(id),
        ...[actorScope, workspaceScope].map((scope) =>
          database
            .prepare(
              `INSERT INTO invitation_budget(scope,window_start,used) SELECT ?,${nowSql},1 WHERE EXISTS(SELECT 1 FROM workspace_invitation WHERE id=?) ON CONFLICT(scope) DO UPDATE SET used=CASE WHEN window_start<=${nowSql}-60000 THEN 1 ELSE used+1 END,window_start=CASE WHEN window_start<=${nowSql}-60000 THEN ${nowSql} ELSE window_start END`,
            )
            .bind(scope, id),
        ),
        database
          .prepare("DELETE FROM collaboration_guard WHERE attempt_id=?")
          .bind(attempt),
      ]);
      const row = await database
        .prepare(`${invitationSelect} WHERE created_by=? AND operation_id=?`)
        .bind(actor.id, input.operationId)
        .first<InvitationRow>();
      if (!row) {
        await assertWorkspaceActor(database, actor, workspaceId, true, true);
        if (results[1]?.meta.changes === 0)
          throw new CollaborationError("rate_limited");
        throw new CollaborationError("command_unknown");
      }
      if (
        row.workspace_id !== workspaceId ||
        row.email !== input.email ||
        row.locale !== input.locale
      )
        throw new CollaborationError("conflict");
      return dto(row);
    },
    async list(
      actor: AdmittedUser,
      workspaceId: string,
    ): Promise<InvitationDto[]> {
      await assertWorkspaceActor(database, actor, workspaceId, true, true);
      const result = await database
        .prepare(
          `${invitationSelect} WHERE workspace_id=? AND ${currentActorSql} AND ${ownerSql} ORDER BY created_at DESC,id LIMIT 100`,
        )
        .bind(workspaceId, ...actorBindings(actor), actor.id, workspaceId)
        .all<InvitationRow>();
      return result.results.map(dto);
    },
    async accept(
      actor: AdmittedUser,
      id: string,
      proof: RecipientProof,
    ): Promise<{ status: "accepted"; membershipActive: boolean }> {
      await assertCollaborationActor(database, actor);
      const row = await read(id);
      if (!row || !proof.verifiedEmails.includes(row.email))
        throw new CollaborationError("denied");
      if (row.state === "accepted") {
        if (row.accepted_by !== actor.id)
          throw new CollaborationError("denied");
        return {
          status: "accepted",
          membershipActive: !!(await database
            .prepare(
              "SELECT 1 FROM membership WHERE workspace_id=? AND user_id=?",
            )
            .bind(row.workspace_id, actor.id)
            .first()),
        };
      }
      const attempt = crypto.randomUUID();
      const results = await guarded([
        database
          .prepare(
            `INSERT INTO collaboration_guard SELECT ?,CASE WHEN ${currentActorSql} AND EXISTS(SELECT 1 FROM account a JOIN github_credential_state c ON c.account_id=a.id WHERE a.id=? AND a.userId=? AND a.accountId=? AND c.generation=? AND c.state='ready') AND EXISTS(SELECT 1 FROM workspace_invitation i JOIN workspace w ON w.id=i.workspace_id AND w.type='team' WHERE i.id=? AND i.email=? AND i.state='pending' AND i.expires_at>${nowSql}) THEN 1 ELSE 0 END`,
          )
          .bind(
            attempt,
            ...actorBindings(actor),
            proof.accountId,
            actor.id,
            actor.githubAccountId,
            proof.generation,
            id,
            row.email,
          ),
        database
          .prepare(
            `UPDATE workspace_invitation SET state='accepted',accepted_by=?,terminal_at=${nowSql} WHERE id=? AND EXISTS(SELECT 1 FROM collaboration_guard WHERE attempt_id=? AND admitted=1)`,
          )
          .bind(actor.id, id, attempt),
        database
          .prepare(
            `INSERT INTO membership(workspace_id,user_id,role,created_at,updated_at) SELECT workspace_id,?,'member',${nowSql},${nowSql} FROM workspace_invitation WHERE id=? AND EXISTS(SELECT 1 FROM collaboration_guard WHERE attempt_id=? AND admitted=1) ON CONFLICT(workspace_id,user_id) DO NOTHING`,
          )
          .bind(actor.id, id, attempt),
        database
          .prepare("DELETE FROM collaboration_guard WHERE attempt_id=?")
          .bind(attempt),
      ]);
      if ((results[1]?.meta.changes ?? 0) === 0) {
        const current = await read(id);
        if (current?.state === "accepted" && current.accepted_by === actor.id)
          return {
            status: "accepted",
            membershipActive: !!(await database
              .prepare(
                "SELECT 1 FROM membership WHERE workspace_id=? AND user_id=?",
              )
              .bind(current.workspace_id, actor.id)
              .first()),
          };
        throw new CollaborationError("denied");
      }
      return { status: "accepted", membershipActive: true };
    },
    async cancel(
      actor: AdmittedUser,
      workspaceId: string,
      id: string,
    ): Promise<InvitationDto> {
      await assertWorkspaceActor(database, actor, workspaceId, true, true);
      await database
        .prepare(
          `UPDATE workspace_invitation SET state='canceled',terminal_at=${nowSql} WHERE id=? AND workspace_id=? AND state='pending' AND ${currentActorSql} AND ${ownerSql}`,
        )
        .bind(id, workspaceId, ...actorBindings(actor), actor.id, workspaceId)
        .run();
      await assertWorkspaceActor(database, actor, workspaceId, true, true);
      const row = await read(id);
      if (!row || row.workspace_id !== workspaceId)
        throw new CollaborationError("denied");
      return dto(row);
    },
    async expireDue(): Promise<void> {
      await database
        .prepare(
          `UPDATE workspace_invitation SET state='expired',terminal_at=${nowSql} WHERE id IN (SELECT id FROM workspace_invitation WHERE state='pending' AND expires_at<=${nowSql} ORDER BY expires_at LIMIT 100)`,
        )
        .run();
    },
  };
}
