import {
  workspaceDtoSchema,
  workspaceMembershipDtoSchema,
  createTeamWorkspaceInputSchema,
  tenancyOperationReceiptSchema,
  type WorkspaceDto,
  type WorkspaceMembershipDto,
  type WorkspaceRole,
  type CreateTeamWorkspaceInput,
} from "@holon/contracts/dashboard";

export interface TenancyPersistence {
  provisionPersonalWorkspace(userId: string): Promise<{
    workspace: WorkspaceDto;
    membership: WorkspaceMembershipDto;
  }>;
  createTeamWorkspace(
    actorUserId: string,
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
  async function assertAdmittedUser(userId: string): Promise<void> {
    const now = Date.now();
    const result = await database
      .prepare(
        `SELECT u.id
         FROM user u
         JOIN account a ON a.userId = u.id
         JOIN session s ON s.userId = u.id AND s.expiresAt > ?
         WHERE u.id = ?
         LIMIT 1`,
      )
      .bind(now, userId)
      .first<{ id: string }>();

    if (!result) {
      throw new Error("user_not_admitted");
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
      throw new Error("storage_corrupted");
    }
    return parsed.data;
  }

  async function reconcileReplay(
    operationId: string,
    actorUserId: string,
    payloadHash: string,
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
      throw new Error("storage_corrupted");
    }

    const op = parsedOp.data;
    if (op.actor_user_id !== actorUserId || op.payload_hash !== payloadHash) {
      throw new Error("operation_conflict");
    }

    const rawWs = await database
      .prepare("SELECT id, type, name FROM workspace WHERE id = ?")
      .bind(op.target_workspace_id)
      .first();

    if (!rawWs) {
      throw new Error("storage_corrupted");
    }

    const wsRecord = rawWs;
    const parsedWs = workspaceDtoSchema.safeParse({
      id: wsRecord.id,
      type: wsRecord.type,
      name: wsRecord.name,
    });
    if (!parsedWs.success) {
      throw new Error("storage_corrupted");
    }

    const membership = await readVerifiedMembership(
      parsedWs.data.id,
      actorUserId,
    );
    if (!membership) {
      throw new Error("team_workspace_creation_failed");
    }

    return {
      workspace: parsedWs.data,
      membership,
    };
  }

  return {
    async provisionPersonalWorkspace(userId: string) {
      await assertAdmittedUser(userId);

      const existing = await database
        .prepare(
          `SELECT w.id, w.type, w.name, m.role
           FROM workspace w
           JOIN membership m ON m.workspace_id = w.id AND m.user_id = ?
           WHERE w.type = 'personal' AND w.personal_user_id = ?`,
        )
        .bind(userId, userId)
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
              userId,
              role: parsedRole.data,
            },
          };
        }
      }

      const workspaceId = `ws_${crypto.randomUUID().replace(/-/gu, "")}`;
      const now = Date.now();

      await database.batch([
        database
          .prepare(
            `INSERT INTO workspace (id, type, name, personal_user_id, created_at, updated_at)
             SELECT ?, 'personal', 'Personal', ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM user u
               JOIN account a ON a.userId = u.id
               JOIN session s ON s.userId = u.id AND s.expiresAt > ?
               WHERE u.id = ?
             )
             ON CONFLICT(personal_user_id) DO NOTHING`,
          )
          .bind(workspaceId, userId, now, now, now, userId),
        database
          .prepare(
            `INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at)
             SELECT w.id, ?, 'owner', ?, ?
             FROM workspace w
             WHERE w.personal_user_id = ? AND w.type = 'personal'
             AND EXISTS (
               SELECT 1 FROM user u
               JOIN account a ON a.userId = u.id
               JOIN session s ON s.userId = u.id AND s.expiresAt > ?
               WHERE u.id = ?
             )
             ON CONFLICT(workspace_id, user_id) DO NOTHING`,
          )
          .bind(userId, now, now, userId, now, userId),
      ]);

      const created = await database
        .prepare(
          `SELECT w.id, w.type, w.name, m.role
           FROM workspace w
           JOIN membership m ON m.workspace_id = w.id AND m.user_id = ?
           WHERE w.type = 'personal' AND w.personal_user_id = ?`,
        )
        .bind(userId, userId)
        .first();

      if (!created) {
        throw new Error("personal_workspace_provision_failed");
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
        throw new Error("personal_workspace_provision_failed");
      }

      return {
        workspace: parsedWs.data,
        membership: {
          workspaceId: parsedWs.data.id,
          userId,
          role: parsedRole.data,
        },
      };
    },

    async createTeamWorkspace(
      actorUserId: string,
      input: CreateTeamWorkspaceInput,
    ) {
      const validatedInput = createTeamWorkspaceInputSchema.parse(input);
      await assertAdmittedUser(actorUserId);

      const payloadHash = await sha256Hex(
        JSON.stringify([
          "create_team",
          actorUserId,
          validatedInput.name,
          validatedInput.operationId,
        ]),
      );

      const existing = await reconcileReplay(
        validatedInput.operationId,
        actorUserId,
        payloadHash,
      );
      if (existing) {
        return existing;
      }

      const workspaceId = `ws_${crypto.randomUUID().replace(/-/gu, "")}`;
      const now = Date.now();

      try {
        await database.batch([
          database
            .prepare(
              `INSERT INTO workspace (id, type, name, personal_user_id, created_at, updated_at)
               SELECT ?, 'team', ?, NULL, ?, ?
               WHERE EXISTS (
                 SELECT 1 FROM user u
                 JOIN account a ON a.userId = u.id
                 JOIN session s ON s.userId = u.id AND s.expiresAt > ?
                 WHERE u.id = ?
               )`,
            )
            .bind(workspaceId, validatedInput.name, now, now, now, actorUserId),
          database
            .prepare(
              `INSERT INTO membership (workspace_id, user_id, role, created_at, updated_at)
               SELECT ?, ?, 'owner', ?, ?
               WHERE EXISTS (
                 SELECT 1 FROM workspace WHERE id = ? AND type = 'team'
               )
               AND EXISTS (
                 SELECT 1 FROM user u
                 JOIN account a ON a.userId = u.id
                 JOIN session s ON s.userId = u.id AND s.expiresAt > ?
                 WHERE u.id = ?
               )`,
            )
            .bind(
              workspaceId,
              actorUserId,
              now,
              now,
              workspaceId,
              now,
              actorUserId,
            ),
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
                 SELECT 1 FROM user u
                 JOIN account a ON a.userId = u.id
                 JOIN session s ON s.userId = u.id AND s.expiresAt > ?
                 WHERE u.id = ?
               )`,
            )
            .bind(
              validatedInput.operationId,
              actorUserId,
              payloadHash,
              workspaceId,
              now,
              workspaceId,
              workspaceId,
              actorUserId,
              now,
              actorUserId,
            ),
        ]);
      } catch (error) {
        const replayed = await reconcileReplay(
          validatedInput.operationId,
          actorUserId,
          payloadHash,
        );
        if (replayed) {
          return replayed;
        }
        throw error;
      }

      const opRecord = await database
        .prepare(
          "SELECT target_workspace_id FROM tenancy_operation WHERE operation_id = ?",
        )
        .bind(validatedInput.operationId)
        .first<{ target_workspace_id: string }>();

      if (!opRecord) {
        throw new Error("user_not_admitted");
      }

      const createdWs = await database
        .prepare("SELECT id, type, name FROM workspace WHERE id = ?")
        .bind(workspaceId)
        .first();

      if (!createdWs) {
        throw new Error("team_workspace_creation_failed");
      }

      const wsRecord = createdWs;
      const parsedWs = workspaceDtoSchema.safeParse({
        id: wsRecord.id,
        type: wsRecord.type,
        name: wsRecord.name,
      });
      if (!parsedWs.success) {
        throw new Error("team_workspace_creation_failed");
      }

      const createdMembership = await readVerifiedMembership(
        parsedWs.data.id,
        actorUserId,
      );
      if (!createdMembership) {
        throw new Error("team_workspace_creation_failed");
      }

      return {
        workspace: parsedWs.data,
        membership: createdMembership,
      };
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
          throw new Error("storage_corrupted");
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
        throw new Error("storage_corrupted");
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
  };
}
