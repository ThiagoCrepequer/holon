import {
  type AdmittedUser,
  type WorkspaceMembershipDto,
  type ReauthAction,
  type ReauthInitInput,
  type ReauthReceipt,
  type PromoteMemberInput,
  type DemoteMemberInput,
  type RemoveMemberInput,
  type LeaveWorkspaceInput,
} from "@holon/contracts/dashboard";

import { TenancyError } from "./tenancy-error.server.js";

export type PendingReauthContext = {
  reauthIntentId: string;
  originalSessionId: string;
  expectedAccountId: string;
  userId: string;
};

export interface GovernancePersistence {
  createReauthIntent(
    actor: AdmittedUser,
    input: ReauthInitInput,
  ): Promise<ReauthReceipt>;
  confirmReauthIntent(
    reauthIntentId: string,
    accountId: string,
    userId: string,
    proofSessionId: string,
  ): Promise<boolean>;
  readPendingReauthContext(
    reauthIntentId: string,
    callerSessionId: string,
    callerUserId: string,
    now?: number,
  ): Promise<PendingReauthContext | null>;
  promoteMember(
    actor: AdmittedUser,
    workspaceId: string,
    input: PromoteMemberInput,
  ): Promise<WorkspaceMembershipDto>;
  demoteMember(
    actor: AdmittedUser,
    workspaceId: string,
    input: DemoteMemberInput,
  ): Promise<WorkspaceMembershipDto>;
  removeMember(
    actor: AdmittedUser,
    workspaceId: string,
    input: RemoveMemberInput,
  ): Promise<{ removed: true }>;
  leaveWorkspace(
    actor: AdmittedUser,
    workspaceId: string,
    input: LeaveWorkspaceInput,
  ): Promise<{ left: true }>;
}

export function createGovernancePersistence(
  database: D1Database,
  helpers: {
    assertAdmittedActor: (actor: AdmittedUser) => Promise<void>;
    readVerifiedMembership: (
      workspaceId: string,
      userId: string,
    ) => Promise<WorkspaceMembershipDto | null>;
  },
): GovernancePersistence {
  async function executeGuardedGovernanceMutation(
    actor: AdmittedUser,
    reauthIntentId: string,
    action: ReauthAction,
    workspaceId: string,
    targetUserId: string,
    mutationBuilder: (attemptKey: string) => D1PreparedStatement,
  ): Promise<void> {
    await helpers.assertAdmittedActor(actor);

    const now = Date.now();
    const intent = await database
      .prepare(
        `SELECT id, confirmed_at, consumed_at, expires_at, proof_session_id
         FROM reauth_intent
         WHERE id = ? AND user_id = ? AND account_id = ?
           AND workspace_id = ? AND action = ? AND target_user_id = ?`,
      )
      .bind(
        reauthIntentId,
        actor.id,
        actor.githubAccountId,
        workspaceId,
        action,
        targetUserId,
      )
      .first<{
        id: string;
        confirmed_at: number | null;
        consumed_at: number | null;
        expires_at: number;
        proof_session_id: string | null;
      }>();

    if (!intent) {
      throw new TenancyError("governance_denied");
    }

    if (
      intent.confirmed_at === null ||
      intent.consumed_at !== null ||
      intent.expires_at <= now
    ) {
      throw new TenancyError("reauth_required");
    }

    // Only the freshly issued proofSessionId from OAuth reauth is authorized
    if (intent.proof_session_id !== actor.sessionId) {
      throw new TenancyError("reauth_required");
    }

    const attemptKey = `att_${crypto.randomUUID().replace(/-/gu, "")}`;
    try {
      const batchResults = await database.batch([
        database
          .prepare(
            `INSERT INTO tenancy_mutation_guard (attempt_key, admitted)
             VALUES (?, (
               SELECT CASE WHEN EXISTS (
                 SELECT 1 FROM user u
                 JOIN account a ON a.userId = u.id AND a.providerId = 'github' AND a.accountId = ?
                 JOIN session s ON s.userId = u.id AND s.id = ? AND s.expiresAt > ? AND s.expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
                 JOIN workspace w ON w.id = ? AND w.type = 'team'
                 JOIN membership m_actor ON m_actor.workspace_id = w.id AND m_actor.user_id = u.id
                 JOIN reauth_intent r ON r.id = ? AND r.user_id = u.id AND r.account_id = a.accountId
                   AND r.workspace_id = w.id AND r.action = ? AND r.target_user_id = ?
                   AND r.proof_session_id = s.id AND r.confirmed_at IS NOT NULL AND r.consumed_at IS NULL
                   AND r.expires_at > ? AND r.expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
                 WHERE u.id = ?
                   AND (
                     (? = 'leave' AND ? = u.id)
                     OR
                     (? != 'leave' AND m_actor.role = 'owner' AND EXISTS (
                       SELECT 1 FROM membership m_target
                       WHERE m_target.workspace_id = w.id AND m_target.user_id = ?
                         AND (
                           (? = 'promote' AND m_target.role = 'member') OR
                           (? = 'demote' AND m_target.role = 'owner') OR
                           (? = 'remove')
                         )
                     ))
                   )
               ) THEN 1 ELSE 0 END
             ))`,
          )
          .bind(
            attemptKey,
            actor.githubAccountId,
            actor.sessionId,
            now,
            workspaceId,
            reauthIntentId,
            action,
            targetUserId,
            now,
            actor.id,
            action,
            targetUserId,
            action,
            targetUserId,
            action,
            action,
            action,
          ),
        database
          .prepare(
            `UPDATE reauth_intent
             SET consumed_at = ?
             WHERE id = ? AND consumed_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM tenancy_mutation_guard
                 WHERE attempt_key = ? AND admitted = 1
               )`,
          )
          .bind(now, reauthIntentId, attemptKey),
        mutationBuilder(attemptKey),
        database
          .prepare(
            `SELECT admitted FROM tenancy_mutation_guard WHERE attempt_key = ?`,
          )
          .bind(attemptKey),
        database
          .prepare(`DELETE FROM tenancy_mutation_guard WHERE attempt_key = ?`)
          .bind(attemptKey),
      ]);

      const guardResult = batchResults[3];
      const admittedRow = guardResult?.results?.[0] as
        | { admitted: number }
        | undefined;
      if (admittedRow?.admitted !== 1) {
        throw new TenancyError("user_not_admitted");
      }

      const mutationResult = batchResults[2];
      if (!mutationResult || (mutationResult.meta?.changes ?? 0) === 0) {
        const target = await helpers.readVerifiedMembership(
          workspaceId,
          targetUserId,
        );
        if (!target && action !== "leave") {
          throw new TenancyError("member_not_found");
        }
        const actorMem = await helpers.readVerifiedMembership(
          workspaceId,
          actor.id,
        );
        if (!actorMem || (action !== "leave" && actorMem.role !== "owner")) {
          throw new TenancyError("governance_denied");
        }
        throw new TenancyError("command_unknown");
      }
    } catch (error) {
      if (error instanceof TenancyError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("cannot remove last owner") ||
        message.includes("cannot demote last owner") ||
        message.includes("personal workspace")
      ) {
        throw new TenancyError("governance_denied");
      }
      try {
        const consumedCheck = await database
          .prepare("SELECT consumed_at FROM reauth_intent WHERE id = ?")
          .bind(reauthIntentId)
          .first<{ consumed_at: number | null }>();
        if (consumedCheck && consumedCheck.consumed_at !== null) {
          throw new TenancyError("command_unknown");
        }
      } catch {
        // reconciliation check unavailable: treat uncertain batch outcome as command_unknown
      }
      throw new TenancyError("command_unknown");
    }
  }

  return {
    async createReauthIntent(
      actor: AdmittedUser,
      input: ReauthInitInput,
    ): Promise<ReauthReceipt> {
      await helpers.assertAdmittedActor(actor);

      const ws = await database
        .prepare("SELECT type FROM workspace WHERE id = ?")
        .bind(input.workspaceId)
        .first<{ type: string }>();

      if (!ws || ws.type !== "team") {
        throw new TenancyError("governance_denied");
      }

      const actorMembership = await helpers.readVerifiedMembership(
        input.workspaceId,
        actor.id,
      );
      if (!actorMembership) {
        throw new TenancyError("governance_denied");
      }

      if (input.action === "leave") {
        if (input.targetUserId !== actor.id) {
          throw new TenancyError("governance_denied");
        }
      } else {
        if (actorMembership.role !== "owner") {
          throw new TenancyError("governance_denied");
        }

        const targetMembership = await helpers.readVerifiedMembership(
          input.workspaceId,
          input.targetUserId,
        );
        if (!targetMembership) {
          throw new TenancyError("member_not_found");
        }

        if (input.action === "promote" && targetMembership.role === "owner") {
          throw new TenancyError("invalid_role_transition");
        }
        if (input.action === "demote" && targetMembership.role === "member") {
          throw new TenancyError("invalid_role_transition");
        }
      }

      // Expiration is authorization's final boundary; confirmed proofs have a
      // later expiry than their pending intents. Limit cleanup work per command.
      await database
        .prepare(
          `DELETE FROM reauth_intent WHERE id IN (
             SELECT id FROM reauth_intent
             WHERE expires_at <= CAST(unixepoch('subsec') * 1000 AS INTEGER)
             ORDER BY expires_at, id
             LIMIT 100
           )`,
        )
        .run();

      const id = `reauth_${crypto.randomUUID().replace(/-/gu, "")}`;
      const now = Date.now();
      const expiresAt = now + 10 * 60 * 1000;

      const insertResult = await database
        .prepare(
          `INSERT INTO reauth_intent (
             id, user_id, account_id, original_session_id, proof_session_id,
             workspace_id, action, target_user_id, created_at, expires_at,
             confirmed_at, consumed_at
           )
           SELECT
             ?, u.id, a.accountId, s.id, NULL,
             w.id, ?, ?, ?, ?,
             NULL, NULL
           FROM user u
           JOIN account a ON a.userId = u.id AND a.providerId = 'github' AND a.accountId = ?
           JOIN session s ON s.userId = u.id AND s.id = ? AND s.expiresAt > ? AND s.expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
           JOIN workspace w ON w.id = ? AND w.type = 'team'
           JOIN membership m_actor ON m_actor.workspace_id = w.id AND m_actor.user_id = u.id
           WHERE u.id = ?
             AND (
               (? = 'leave' AND ? = u.id)
               OR
               (? != 'leave' AND m_actor.role = 'owner' AND EXISTS (
                 SELECT 1 FROM membership m_target
                 WHERE m_target.workspace_id = w.id AND m_target.user_id = ?
                   AND (
                     (? = 'promote' AND m_target.role = 'member') OR
                     (? = 'demote' AND m_target.role = 'owner') OR
                     (? = 'remove')
                   )
               ))
             )`,
        )
        .bind(
          id,
          input.action,
          input.targetUserId,
          now,
          expiresAt,
          actor.githubAccountId,
          actor.sessionId,
          now,
          input.workspaceId,
          actor.id,
          input.action,
          input.targetUserId,
          input.action,
          input.targetUserId,
          input.action,
          input.action,
          input.action,
        )
        .run();

      if ((insertResult.meta?.changes ?? 0) === 0) {
        await helpers.assertAdmittedActor(actor);
        const recheckMembership = await helpers.readVerifiedMembership(
          input.workspaceId,
          actor.id,
        );
        if (
          !recheckMembership ||
          (input.action !== "leave" && recheckMembership.role !== "owner")
        ) {
          throw new TenancyError("governance_denied");
        }
        throw new TenancyError("governance_denied");
      }

      return {
        reauthIntentId: id,
        expiresAt: new Date(expiresAt).toISOString(),
      };
    },

    async confirmReauthIntent(
      reauthIntentId: string,
      accountId: string,
      userId: string,
      proofSessionId: string,
    ): Promise<boolean> {
      const now = Date.now();
      const expiresAt = now + 5 * 60 * 1000;
      const res = await database
        .prepare(
          `UPDATE reauth_intent
           SET confirmed_at = ?, proof_session_id = ?, expires_at = ?
           WHERE id = ? AND user_id = ? AND account_id = ?
             AND confirmed_at IS NULL AND consumed_at IS NULL
             AND expires_at > ?
             AND expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
             AND EXISTS (
               SELECT 1 FROM session s_orig
               WHERE s_orig.id = reauth_intent.original_session_id
                 AND s_orig.userId = ?
                 AND s_orig.expiresAt > ?
                 AND s_orig.expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
             )
             AND EXISTS (
               SELECT 1 FROM session s_proof
               WHERE s_proof.id = ?
                 AND s_proof.userId = ?
                 AND s_proof.id != reauth_intent.original_session_id
                 AND s_proof.expiresAt > ?
                 AND s_proof.expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
             )`,
        )
        .bind(
          now,
          proofSessionId,
          expiresAt,
          reauthIntentId,
          userId,
          accountId,
          now,
          userId,
          now,
          proofSessionId,
          userId,
          now,
        )
        .run();
      return (res.meta?.changes ?? 0) > 0;
    },

    async readPendingReauthContext(
      reauthIntentId: string,
      callerSessionId: string,
      callerUserId: string,
      now = Date.now(),
    ): Promise<PendingReauthContext | null> {
      const row = await database
        .prepare(
          `SELECT r.id, r.user_id, r.original_session_id, r.account_id
           FROM reauth_intent r
           JOIN session s ON s.id = r.original_session_id AND s.userId = r.user_id
             AND s.expiresAt > ? AND s.expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
           JOIN account a ON a.userId = r.user_id AND a.providerId = 'github' AND a.accountId = r.account_id
           WHERE r.id = ? AND r.original_session_id = ? AND r.user_id = ?
             AND r.confirmed_at IS NULL AND r.consumed_at IS NULL
             AND r.expires_at > ? AND r.expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)`,
        )
        .bind(now, reauthIntentId, callerSessionId, callerUserId, now)
        .first<{
          id: string;
          user_id: string;
          original_session_id: string;
          account_id: string;
        }>();

      if (!row) return null;
      return {
        reauthIntentId: row.id,
        originalSessionId: row.original_session_id,
        expectedAccountId: row.account_id,
        userId: row.user_id,
      };
    },

    async promoteMember(
      actor: AdmittedUser,
      workspaceId: string,
      input: PromoteMemberInput,
    ): Promise<WorkspaceMembershipDto> {
      const ws = await database
        .prepare("SELECT type FROM workspace WHERE id = ?")
        .bind(workspaceId)
        .first<{ type: string }>();
      if (!ws || ws.type !== "team")
        throw new TenancyError("governance_denied");

      const actorMembership = await helpers.readVerifiedMembership(
        workspaceId,
        actor.id,
      );
      if (!actorMembership || actorMembership.role !== "owner") {
        throw new TenancyError("governance_denied");
      }

      const targetMembership = await helpers.readVerifiedMembership(
        workspaceId,
        input.targetUserId,
      );
      if (!targetMembership) throw new TenancyError("member_not_found");
      if (targetMembership.role === "owner") {
        throw new TenancyError("invalid_role_transition");
      }

      const now = Date.now();
      await executeGuardedGovernanceMutation(
        actor,
        input.reauthIntentId,
        "promote",
        workspaceId,
        input.targetUserId,
        (attemptKey) =>
          database
            .prepare(
              `UPDATE membership
               SET role = 'owner', updated_at = ?
               WHERE workspace_id = ? AND user_id = ? AND role = 'member'
                 AND EXISTS (
                   SELECT 1 FROM tenancy_mutation_guard
                   WHERE attempt_key = ? AND admitted = 1
                 )`,
            )
            .bind(now, workspaceId, input.targetUserId, attemptKey),
      );

      const updated = await helpers.readVerifiedMembership(
        workspaceId,
        input.targetUserId,
      );
      if (!updated) throw new TenancyError("storage_corrupted");
      return updated;
    },

    async demoteMember(
      actor: AdmittedUser,
      workspaceId: string,
      input: DemoteMemberInput,
    ): Promise<WorkspaceMembershipDto> {
      const ws = await database
        .prepare("SELECT type FROM workspace WHERE id = ?")
        .bind(workspaceId)
        .first<{ type: string }>();
      if (!ws || ws.type !== "team")
        throw new TenancyError("governance_denied");

      const actorMembership = await helpers.readVerifiedMembership(
        workspaceId,
        actor.id,
      );
      if (!actorMembership || actorMembership.role !== "owner") {
        throw new TenancyError("governance_denied");
      }

      const targetMembership = await helpers.readVerifiedMembership(
        workspaceId,
        input.targetUserId,
      );
      if (!targetMembership) throw new TenancyError("member_not_found");
      if (targetMembership.role === "member") {
        throw new TenancyError("invalid_role_transition");
      }

      const now = Date.now();
      await executeGuardedGovernanceMutation(
        actor,
        input.reauthIntentId,
        "demote",
        workspaceId,
        input.targetUserId,
        (attemptKey) =>
          database
            .prepare(
              `UPDATE membership
               SET role = 'member', updated_at = ?
               WHERE workspace_id = ? AND user_id = ? AND role = 'owner'
                 AND EXISTS (
                   SELECT 1 FROM tenancy_mutation_guard
                   WHERE attempt_key = ? AND admitted = 1
                 )`,
            )
            .bind(now, workspaceId, input.targetUserId, attemptKey),
      );

      const updated = await helpers.readVerifiedMembership(
        workspaceId,
        input.targetUserId,
      );
      if (!updated) throw new TenancyError("storage_corrupted");
      return updated;
    },

    async removeMember(
      actor: AdmittedUser,
      workspaceId: string,
      input: RemoveMemberInput,
    ): Promise<{ removed: true }> {
      const ws = await database
        .prepare("SELECT type FROM workspace WHERE id = ?")
        .bind(workspaceId)
        .first<{ type: string }>();
      if (!ws || ws.type !== "team")
        throw new TenancyError("governance_denied");

      const actorMembership = await helpers.readVerifiedMembership(
        workspaceId,
        actor.id,
      );
      if (!actorMembership || actorMembership.role !== "owner") {
        throw new TenancyError("governance_denied");
      }

      const targetMembership = await helpers.readVerifiedMembership(
        workspaceId,
        input.targetUserId,
      );
      if (!targetMembership) throw new TenancyError("member_not_found");

      await executeGuardedGovernanceMutation(
        actor,
        input.reauthIntentId,
        "remove",
        workspaceId,
        input.targetUserId,
        (attemptKey) =>
          database
            .prepare(
              `DELETE FROM membership
               WHERE workspace_id = ? AND user_id = ?
                 AND EXISTS (
                   SELECT 1 FROM tenancy_mutation_guard
                   WHERE attempt_key = ? AND admitted = 1
                 )`,
            )
            .bind(workspaceId, input.targetUserId, attemptKey),
      );

      return { removed: true };
    },

    async leaveWorkspace(
      actor: AdmittedUser,
      workspaceId: string,
      input: LeaveWorkspaceInput,
    ): Promise<{ left: true }> {
      const ws = await database
        .prepare("SELECT type FROM workspace WHERE id = ?")
        .bind(workspaceId)
        .first<{ type: string }>();
      if (!ws || ws.type !== "team")
        throw new TenancyError("governance_denied");

      const actorMembership = await helpers.readVerifiedMembership(
        workspaceId,
        actor.id,
      );
      if (!actorMembership) throw new TenancyError("governance_denied");

      await executeGuardedGovernanceMutation(
        actor,
        input.reauthIntentId,
        "leave",
        workspaceId,
        actor.id,
        (attemptKey) =>
          database
            .prepare(
              `DELETE FROM membership
               WHERE workspace_id = ? AND user_id = ?
                 AND EXISTS (
                   SELECT 1 FROM tenancy_mutation_guard
                   WHERE attempt_key = ? AND admitted = 1
                 )`,
            )
            .bind(workspaceId, actor.id, attemptKey),
      );

      return { left: true };
    },
  };
}
