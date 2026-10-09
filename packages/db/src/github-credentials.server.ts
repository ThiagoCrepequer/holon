import type { AdmittedUser } from "@holon/contracts/dashboard";

import {
  actorBindings,
  assertCollaborationActor,
  currentActorSql,
} from "./collaboration-admission.server.js";
import { CollaborationError } from "./collaboration-error.server.js";
export interface CredentialRecord {
  accountId: string;
  generation: number;
  state: "ready" | "refreshing" | "reconnect_required";
  accessToken: string | null;
  refreshToken: string | null;
  accessExpiresAt: number | null;
  refreshExpiresAt: number | null;
}
export interface RefreshClaim {
  accountId: string;
  generation: number;
  claimId: string;
}
export interface EncryptedCredentialPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}
const nowSql = "CAST(unixepoch('subsec')*1000 AS INTEGER)";
export function createCredentialPersistence(database: D1Database) {
  return {
    async read(actor: AdmittedUser): Promise<CredentialRecord> {
      await assertCollaborationActor(database, actor);
      await database
        .prepare(
          `UPDATE github_credential_state SET state='reconnect_required',claim_id=NULL,claim_until=NULL,generation=generation+1 WHERE state='refreshing' AND claim_until<=${nowSql} AND account_id IN(SELECT id FROM account WHERE userId=? AND providerId='github' AND accountId=?)`,
        )
        .bind(actor.id, actor.githubAccountId)
        .run();
      const row = await database
        .prepare(
          `SELECT a.id AS accountId,c.generation,c.state,a.accessToken,a.refreshToken,a.accessTokenExpiresAt AS accessExpiresAt,a.refreshTokenExpiresAt AS refreshExpiresAt FROM account a JOIN github_credential_state c ON c.account_id=a.id WHERE a.userId=? AND a.providerId='github' AND a.accountId=? AND ${currentActorSql}`,
        )
        .bind(actor.id, actor.githubAccountId, ...actorBindings(actor))
        .first<CredentialRecord>();
      if (!row) throw new CollaborationError("reconnect_required");
      return row;
    },
    async claim(
      actor: AdmittedUser,
      record: CredentialRecord,
    ): Promise<RefreshClaim | null> {
      const claimId = crypto.randomUUID();
      const result = await database
        .prepare(
          `UPDATE github_credential_state SET state='refreshing',claim_id=?,claim_until=${nowSql}+30000 WHERE account_id=? AND generation=? AND state='ready' AND ${currentActorSql} AND EXISTS(SELECT 1 FROM account WHERE id=github_credential_state.account_id AND userId=? AND accountId=? AND refreshToken IS NOT NULL AND refreshTokenExpiresAt>${nowSql})`,
        )
        .bind(
          claimId,
          record.accountId,
          record.generation,
          ...actorBindings(actor),
          actor.id,
          actor.githubAccountId,
        )
        .run();
      return result.meta.changes > 0
        ? {
            accountId: record.accountId,
            generation: record.generation,
            claimId,
          }
        : null;
    },
    async complete(
      actor: AdmittedUser,
      claim: RefreshClaim,
      pair: EncryptedCredentialPair,
    ): Promise<boolean> {
      const result = await database
        .prepare(
          `UPDATE account SET accessToken=?,refreshToken=?,accessTokenExpiresAt=?,refreshTokenExpiresAt=?,updatedAt=${nowSql} WHERE id=? AND userId=? AND accountId=? AND ${currentActorSql} AND EXISTS(SELECT 1 FROM github_credential_state c WHERE c.account_id=account.id AND c.generation=? AND c.state='refreshing' AND c.claim_id=? AND c.claim_until>${nowSql})`,
        )
        .bind(
          pair.accessToken,
          pair.refreshToken,
          pair.accessExpiresAt,
          pair.refreshExpiresAt,
          claim.accountId,
          actor.id,
          actor.githubAccountId,
          ...actorBindings(actor),
          claim.generation,
          claim.claimId,
        )
        .run();
      return result.meta.changes > 0;
    },
    async disconnect(
      actor: AdmittedUser,
      claim: { accountId: string; generation: number; claimId?: string },
    ): Promise<void> {
      await database
        .prepare(
          `UPDATE github_credential_state SET state='reconnect_required',generation=generation+1,claim_id=NULL,claim_until=NULL WHERE account_id=? AND generation=? AND (? IS NULL OR claim_id=?) AND account_id IN(SELECT id FROM account WHERE userId=? AND accountId=?)`,
        )
        .bind(
          claim.accountId,
          claim.generation,
          claim.claimId ?? null,
          claim.claimId ?? null,
          actor.id,
          actor.githubAccountId,
        )
        .run();
    },
  };
}
