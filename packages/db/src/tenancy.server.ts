import {
  workspaceDtoSchema,
  dashboardIdSchema,
  dashboardCursorSchema,
  workspaceMemberPageSchema,
  type WorkspaceMemberPage,
  workspaceMembershipDtoSchema,
  createTeamWorkspaceInputSchema,
  tenancyOperationReceiptSchema,
  type AdmittedUser,
  type WorkspaceDto,
  type WorkspaceMembershipDto,
  type WorkspaceRole,
  type CreateTeamWorkspaceInput,
  type ReauthInitInput,
  type ReauthReceipt,
  type PromoteMemberInput,
  type DemoteMemberInput,
  type RemoveMemberInput,
  type LeaveWorkspaceInput,
} from "@holon/contracts/dashboard";

import {
  createGovernancePersistence,
  type PendingReauthContext,
} from "./governance.server.js";
import { TenancyError, type TenancyErrorCode } from "./tenancy-error.server.js";

export { TenancyError, type TenancyErrorCode, type PendingReauthContext };

export interface TenancyPersistence {
  /** Atomically admits current session/account/membership with the returned page. */
  listMembers(
    actor: AdmittedUser,
    workspaceId: string,
    cursor: string | null,
  ): Promise<WorkspaceMemberPage>;
  provisionPersonalWorkspace(actor: AdmittedUser): Promise<{
    workspace: WorkspaceDto;
    membership: WorkspaceMembershipDto;
  }>;
  createTeamWorkspace(
    actor: AdmittedUser,
    input: CreateTeamWorkspaceInput,
  ): Promise<{
    workspace: WorkspaceDto;
    membership: WorkspaceMembershipDto;
  }>;
  listUserWorkspaces(
    userId: string,
  ): Promise<Array<{ workspace: WorkspaceDto; role: WorkspaceRole }>>;
  readWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<{ workspace: WorkspaceDto; role: WorkspaceRole } | null>;
  readMembership(
    userId: string,
    workspaceId: string,
  ): Promise<{ workspaceId: string; role: WorkspaceRole } | null>;
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

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export function createTenancyPersistence(
  database: D1Database,
): TenancyPersistence {
  async function assertAdmittedActor(actor: AdmittedUser): Promise<void> {
    const result = await database
      .prepare(
        `SELECT u.id
         FROM user u
         JOIN account a ON a.userId = u.id AND a.providerId = 'github' AND a.accountId = ?
         JOIN session s ON s.userId = u.id AND s.id = ? AND s.expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
         WHERE u.id = ?
         LIMIT 1`,
      )
      .bind(actor.githubAccountId, actor.sessionId, actor.id)
      .first<{ id: string }>();

    if (!result) {
      throw new TenancyError("user_not_admitted");
    }
  }

  async function readVerifiedMembership(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMembershipDto | null> {
    const row = await database
      .prepare(
        `SELECT workspace_id, user_id, role
         FROM membership
         WHERE workspace_id = ? AND user_id = ?`,
      )
      .bind(workspaceId, userId)
      .first();

    if (!row) return null;
    const record = row;
    const parsed = workspaceMembershipDtoSchema.safeParse({
      workspaceId: record.workspace_id,
      userId: record.user_id,
      role: record.role,
    });
    if (!parsed.success) {
      throw new TenancyError("storage_corrupted");
    }
    return parsed.data;
  }

  async function reconcileReplay(
    operationId: string,
    actor: AdmittedUser,
    expectedPayloadHash: string,
  ): Promise<{
    workspace: WorkspaceDto;
    membership: WorkspaceMembershipDto;
  } | null> {
    const rawOp = await database
      .prepare(
        `SELECT operation_id, actor_user_id, action, payload_hash, target_workspace_id
         FROM tenancy_operation
         WHERE operation_id = ?`,
      )
      .bind(operationId)
      .first();

    if (!rawOp) return null;

    const parsedOp = tenancyOperationReceiptSchema.safeParse(rawOp);
    if (!parsedOp.success) {
      throw new TenancyError("storage_corrupted");
    }

    const op = parsedOp.data;
    if (
      op.actor_user_id !== actor.id ||
      op.payload_hash !== expectedPayloadHash
    ) {
      throw new TenancyError("operation_conflict");
    }

    await assertAdmittedActor(actor);

    const rawWs = await database
      .prepare("SELECT id, type, name FROM workspace WHERE id = ?")
      .bind(op.target_workspace_id)
      .first();

    if (!rawWs) {
      throw new TenancyError("storage_corrupted");
    }

    const wsRecord = rawWs;
    const parsedWs = workspaceDtoSchema.safeParse({
      id: wsRecord.id,
      type: wsRecord.type,
      name: wsRecord.name,
    });
    if (!parsedWs.success) {
      throw new TenancyError("storage_corrupted");
    }

    const membership = await readVerifiedMembership(parsedWs.data.id, actor.id);
    if (!membership) {
      throw new TenancyError("team_workspace_creation_failed");
    }

    return {
      workspace: parsedWs.data,
      membership,
    };
  }

  const governance = createGovernancePersistence(database, {
    assertAdmittedActor,
    readVerifiedMembership,
  });

  return {
    async provisionPersonalWorkspace(actor: AdmittedUser) {
      await assertAdmittedActor(actor);

      const existing = await database
        .prepare(
          `SELECT w.id, w.type, w.name, m.role
           FROM workspace w
           JOIN membership m ON m.workspace_id = w.id AND m.user_id = ?
           WHERE w.type = 'personal' AND w.personal_user_id = ?`,
        )
        .bind(actor.id, actor.id)
        .first();

      if (existing) {
        const record = existing;
        const parsedWs = workspaceDtoSchema.safeParse({
          id: record.id,
          type: record.type,
          name: record.name,
        });
        const parsedRole = workspaceMembershipDtoSchema.shape.role.safeParse(
          record.role,
        );
        if (parsedWs.success && parsedRole.success) {
          return {
            workspace: parsedWs.data,
            membership: {
              workspaceId: parsedWs.data.id,
              userId: actor.id,
              role: parsedRole.data,
            },
          };
        }
      }

      const attemptKey = `att_${crypto.randomUUID().replace(/-/gu, "")}`;
      const workspaceId = `ws_${crypto.randomUUID().replace(/-/gu, "")}`;
      const now = Date.now();

      await database.batch([
        database
          .prepare(
            `INSERT INTO tenancy_mutation_guard (attempt_key, admitted)
             VALUES (?, (
               SELECT CASE WHEN EXISTS (
                 SELECT 1 FROM user u
                 JOIN account a ON a.userId = u.id AND a.providerId = 'github' AND a.accountId = ?
                 JOIN session s ON s.userId = u.id AND s.id = ? AND s.expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
                 WHERE u.id = ?
               ) THEN 1 ELSE 0 END
             ))`,
          )
          .bind(attemptKey, actor.githubAccountId, actor.sessionId, actor.id),
        database
          .prepare(
            `INSERT INTO workspace (id, type, name, personal_user_id, created_at, updated_at)
             SELECT ?, 'personal', 'Personal', ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM tenancy_mutation_guard
               WHERE attempt_key = ? AND admitted = 1
             )
             ON CONFLICT(personal_user_id) DO NOTHING`,
          )
          .bind(workspaceId, actor.id, now, now, attemptKey),
        database
          .prepare(
            `INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at)
             SELECT w.id, ?, 'owner', ?, ?
             FROM workspace w
             WHERE w.personal_user_id = ? AND w.type = 'personal'
             AND EXISTS (
               SELECT 1 FROM tenancy_mutation_guard
               WHERE attempt_key = ? AND admitted = 1
             )
             ON CONFLICT(workspace_id, user_id) DO NOTHING`,
          )
          .bind(actor.id, now, now, actor.id, attemptKey),
        database
          .prepare(`DELETE FROM tenancy_mutation_guard WHERE attempt_key = ?`)
          .bind(attemptKey),
      ]);

      const created = await database
        .prepare(
          `SELECT w.id, w.type, w.name, m.role
           FROM workspace w
           JOIN membership m ON m.workspace_id = w.id AND m.user_id = ?
           WHERE w.type = 'personal' AND w.personal_user_id = ?`,
        )
        .bind(actor.id, actor.id)
        .first();

      if (!created) {
        throw new TenancyError("user_not_admitted");
      }

      const record = created;
      const parsedWs = workspaceDtoSchema.safeParse({
        id: record.id,
        type: record.type,
        name: record.name,
      });
      const parsedRole = workspaceMembershipDtoSchema.shape.role.safeParse(
        record.role,
      );
      if (!parsedWs.success || !parsedRole.success) {
        throw new TenancyError("personal_workspace_provision_failed");
      }

      return {
        workspace: parsedWs.data,
        membership: {
          workspaceId: parsedWs.data.id,
          userId: actor.id,
          role: parsedRole.data,
        },
      };
    },

    async createTeamWorkspace(
      actor: AdmittedUser,
      input: CreateTeamWorkspaceInput,
    ) {
      const validatedInput = createTeamWorkspaceInputSchema.parse(input);
      await assertAdmittedActor(actor);

      const payloadHash = await sha256Hex(
        JSON.stringify([
          "create_team",
          actor.id,
          validatedInput.name,
          validatedInput.operationId,
        ]),
      );

      const existing = await reconcileReplay(
        validatedInput.operationId,
        actor,
        payloadHash,
      );
      if (existing) {
        return existing;
      }

      const attemptKey = `att_${crypto.randomUUID().replace(/-/gu, "")}`;
      const workspaceId = `ws_${crypto.randomUUID().replace(/-/gu, "")}`;
      const now = Date.now();

      try {
        await database.batch([
          database
            .prepare(
              `INSERT INTO tenancy_mutation_guard (attempt_key, admitted)
               VALUES (?, (
                 SELECT CASE WHEN EXISTS (
                   SELECT 1 FROM user u
                   JOIN account a ON a.userId = u.id AND a.providerId = 'github' AND a.accountId = ?
                   JOIN session s ON s.userId = u.id AND s.id = ? AND s.expiresAt > CAST(unixepoch('subsec') * 1000 AS INTEGER)
                   WHERE u.id = ?
                 ) THEN 1 ELSE 0 END
               ))`,
            )
            .bind(attemptKey, actor.githubAccountId, actor.sessionId, actor.id),
          database
            .prepare(
              `INSERT INTO workspace (id, type, name, personal_user_id, created_at, updated_at)
               SELECT ?, 'team', ?, NULL, ?, ?
               WHERE EXISTS (
                 SELECT 1 FROM tenancy_mutation_guard
                 WHERE attempt_key = ? AND admitted = 1
               )`,
            )
            .bind(workspaceId, validatedInput.name, now, now, attemptKey),
          database
            .prepare(
              `INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at)
               SELECT ?, ?, 'owner', ?, ?
               WHERE EXISTS (
                 SELECT 1 FROM workspace WHERE id = ? AND type = 'team'
               )
               AND EXISTS (
                 SELECT 1 FROM tenancy_mutation_guard
                 WHERE attempt_key = ? AND admitted = 1
               )`,
            )
            .bind(workspaceId, actor.id, now, now, workspaceId, attemptKey),
          database
            .prepare(
              `INSERT INTO tenancy_operation (operation_id, actor_user_id, action, payload_hash, target_workspace_id, created_at)
               SELECT ?, ?, 'create_team', ?, ?, ?
               WHERE EXISTS (
                 SELECT 1 FROM workspace WHERE id = ? AND type = 'team'
               )
               AND EXISTS (
                 SELECT 1 FROM membership WHERE workspace_id = ? AND user_id = ?
               )
               AND EXISTS (
                 SELECT 1 FROM tenancy_mutation_guard
                 WHERE attempt_key = ? AND admitted = 1
               )`,
            )
            .bind(
              validatedInput.operationId,
              actor.id,
              payloadHash,
              workspaceId,
              now,
              workspaceId,
              workspaceId,
              actor.id,
              attemptKey,
            ),
          database
            .prepare(`DELETE FROM tenancy_mutation_guard WHERE attempt_key = ?`)
            .bind(attemptKey),
        ]);

        const opRecord = await database
          .prepare(
            "SELECT target_workspace_id FROM tenancy_operation WHERE operation_id = ?",
          )
          .bind(validatedInput.operationId)
          .first<{ target_workspace_id: string }>();

        if (!opRecord) {
          await assertAdmittedActor(actor);
          throw new TenancyError("user_not_admitted");
        }

        const createdWs = await database
          .prepare("SELECT id, type, name FROM workspace WHERE id = ?")
          .bind(workspaceId)
          .first();

        if (!createdWs) {
          throw new TenancyError("team_workspace_creation_failed");
        }

        const wsRecord = createdWs;
        const parsedWs = workspaceDtoSchema.safeParse({
          id: wsRecord.id,
          type: wsRecord.type,
          name: wsRecord.name,
        });
        if (!parsedWs.success) {
          throw new TenancyError("team_workspace_creation_failed");
        }

        const createdMembership = await readVerifiedMembership(
          parsedWs.data.id,
          actor.id,
        );
        if (!createdMembership) {
          throw new TenancyError("team_workspace_creation_failed");
        }

        return {
          workspace: parsedWs.data,
          membership: createdMembership,
        };
      } catch (error) {
        if (
          error instanceof TenancyError &&
          (error.code === "user_not_admitted" ||
            error.code === "operation_conflict")
        ) {
          throw error;
        }

        let replayed = null;
        try {
          replayed = await reconcileReplay(
            validatedInput.operationId,
            actor,
            payloadHash,
          );
        } catch (replayError) {
          if (
            replayError instanceof TenancyError &&
            (replayError.code === "operation_conflict" ||
              replayError.code === "user_not_admitted")
          ) {
            throw replayError;
          }
          throw new TenancyError("command_unknown");
        }

        if (replayed) {
          return replayed;
        }

        throw new TenancyError("team_workspace_creation_failed");
      }
    },

    async listMembers(
      actor: AdmittedUser,
      workspaceId: string,
      cursor: string | null,
    ) {
      dashboardIdSchema.parse(workspaceId);
      dashboardCursorSchema.parse(cursor);
      const guard = `EXISTS(SELECT 1 FROM membership admission
        JOIN session s ON s.userId=admission.user_id
        JOIN account a ON a.userId=s.userId AND a.providerId='github'
        WHERE admission.workspace_id=? AND admission.user_id=? AND s.id=? AND s.expiresAt>CAST(unixepoch('subsec') * 1000 AS INTEGER) AND a.accountId=?)`;
      const params = [
        workspaceId,
        actor.id,
        actor.sessionId,
        actor.githubAccountId,
      ];
      const results = await database.batch([
        database
          .prepare(
            `SELECT role FROM membership WHERE workspace_id=? AND user_id=? AND ${guard}`,
          )
          .bind(workspaceId, actor.id, ...params),
        database
          .prepare(`SELECT m.user_id AS userId,u.name,m.role FROM membership m JOIN user u ON u.id=m.user_id
          WHERE m.workspace_id=? AND ${guard} AND (? IS NULL OR m.user_id>?) ORDER BY m.user_id LIMIT 101`)
          .bind(workspaceId, ...params, cursor, cursor),
        database
          .prepare(
            `SELECT count(*) AS owners FROM membership WHERE workspace_id=? AND role='owner' AND ${guard}`,
          )
          .bind(workspaceId, ...params),
      ]);
      if (!results.every((r) => r.success))
        throw new TenancyError("storage_corrupted");
      const admission = results[0]?.results[0];
      if (!admission) throw new TenancyError("user_not_admitted");
      const rows = results[1]?.results ?? [];
      return workspaceMemberPageSchema.parse({
        members: rows.slice(0, 100),
        actorRole: (admission as Record<string, unknown>).role,
        ownerCount: (
          results[2]?.results[0] as Record<string, unknown> | undefined
        )?.owners,
        nextCursor:
          rows.length > 100
            ? (rows[99] as Record<string, unknown> | undefined)?.userId
            : null,
      });
    },

    async listUserWorkspaces(userId: string) {
      const results = await database
        .prepare(
          `SELECT w.id, w.type, w.name, m.role
           FROM membership m
           JOIN workspace w ON w.id = m.workspace_id
           WHERE m.user_id = ?
           ORDER BY w.created_at ASC`,
        )
        .bind(userId)
        .all();

      const items: Array<{ workspace: WorkspaceDto; role: WorkspaceRole }> = [];
      for (const row of results.results) {
        const record = row;
        const parsedWs = workspaceDtoSchema.safeParse({
          id: record.id,
          type: record.type,
          name: record.name,
        });
        const parsedRole = workspaceMembershipDtoSchema.shape.role.safeParse(
          record.role,
        );
        if (!parsedWs.success || !parsedRole.success) {
          throw new TenancyError("storage_corrupted");
        }
        items.push({
          workspace: parsedWs.data,
          role: parsedRole.data,
        });
      }
      return items;
    },

    async readWorkspace(userId: string, workspaceId: string) {
      const row = await database
        .prepare(
          `SELECT w.id, w.type, w.name, m.role
           FROM membership m
           JOIN workspace w ON w.id = m.workspace_id
           WHERE m.user_id = ? AND w.id = ?`,
        )
        .bind(userId, workspaceId)
        .first();

      if (!row) return null;
      const record = row;
      const parsedWs = workspaceDtoSchema.safeParse({
        id: record.id,
        type: record.type,
        name: record.name,
      });
      const parsedRole = workspaceMembershipDtoSchema.shape.role.safeParse(
        record.role,
      );
      if (!parsedWs.success || !parsedRole.success) {
        throw new TenancyError("storage_corrupted");
      }
      return {
        workspace: parsedWs.data,
        role: parsedRole.data,
      };
    },

    async readMembership(userId: string, workspaceId: string) {
      const membership = await readVerifiedMembership(workspaceId, userId);
      if (!membership) return null;
      return { workspaceId: membership.workspaceId, role: membership.role };
    },

    createReauthIntent(actor, input) {
      return governance.createReauthIntent(actor, input);
    },
    confirmReauthIntent(reauthIntentId, accountId, userId, proofSessionId) {
      return governance.confirmReauthIntent(
        reauthIntentId,
        accountId,
        userId,
        proofSessionId,
      );
    },
    readPendingReauthContext(
      reauthIntentId,
      callerSessionId,
      callerUserId,
      now,
    ) {
      return governance.readPendingReauthContext(
        reauthIntentId,
        callerSessionId,
        callerUserId,
        now,
      );
    },
    promoteMember(actor, workspaceId, input) {
      return governance.promoteMember(actor, workspaceId, input);
    },
    demoteMember(actor, workspaceId, input) {
      return governance.demoteMember(actor, workspaceId, input);
    },
    removeMember(actor, workspaceId, input) {
      return governance.removeMember(actor, workspaceId, input);
    },
    leaveWorkspace(actor, workspaceId, input) {
      return governance.leaveWorkspace(actor, workspaceId, input);
    },
  };
}
