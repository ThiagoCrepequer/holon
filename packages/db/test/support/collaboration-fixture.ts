import type { AdmittedUser } from "@holon/contracts/dashboard";
import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
const bindings = env as unknown as {
  IDENTITY_DB: D1Database;
  IDENTITY_MIGRATIONS: D1Migration[];
};
export const db = bindings.IDENTITY_DB;
export const owner: AdmittedUser = {
  id: "owner",
  name: "Synthetic",
  sessionId: "owner_session",
  githubAccountId: "101",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
export const target: AdmittedUser = {
  ...owner,
  id: "target",
  sessionId: "target_session",
  githubAccountId: "102",
};
export const outsider: AdmittedUser = {
  ...owner,
  id: "outsider",
  sessionId: "outsider_session",
  githubAccountId: "103",
};
export async function seedCollaboration() {
  await applyD1Migrations(db, bindings.IDENTITY_MIGRATIONS);
  const now = Date.now();
  for (const actor of [owner, target, outsider])
    await db.batch([
      db
        .prepare(
          "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,'Synthetic',?,1,?,?)",
        )
        .bind(actor.id, `${actor.id}@example.invalid`, now, now),
      db
        .prepare(
          "INSERT INTO account(id,userId,providerId,accountId,accessToken,refreshToken,accessTokenExpiresAt,refreshTokenExpiresAt,createdAt,updatedAt) VALUES(?,?,'github',?,'cipher','refresh-cipher',?,?,?,?)",
        )
        .bind(
          `${actor.id}_account`,
          actor.id,
          actor.githubAccountId,
          now + 1000000,
          now + 2000000,
          now,
          now,
        ),
      db
        .prepare(
          "INSERT INTO session(id,userId,token,createdAt,updatedAt,expiresAt) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          actor.sessionId,
          actor.id,
          `synthetic_${actor.id}`,
          now,
          now,
          now + 3600000,
        ),
    ]);
  for (const [workspace, actor, type] of [
    ["team", owner, "team"],
    ["other", outsider, "team"],
    ["personal", owner, "personal"],
  ] as const)
    await db.batch([
      db
        .prepare(
          "INSERT INTO workspace(id,type,name,personal_user_id,created_at,updated_at) VALUES(?,?,'Synthetic',?,?,?)",
        )
        .bind(workspace, type, type === "personal" ? actor.id : null, now, now),
      db
        .prepare(
          "INSERT INTO membership(workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,'owner',?,?)",
        )
        .bind(workspace, actor.id, now, now),
    ]);
}
export async function proof(
  actor: AdmittedUser,
  workspace = "team",
  installationId = 77,
  action = "link",
  id = "reauth",
) {
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO reauth_intent(id,user_id,account_id,original_session_id,proof_session_id,workspace_id,action,target_user_id,created_at,expires_at,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      actor.id,
      actor.githubAccountId,
      "old_session",
      actor.sessionId,
      workspace,
      action,
      String(installationId),
      now,
      now + 300000,
      now,
    )
    .run();
  return { installationId, reauthIntentId: id };
}
