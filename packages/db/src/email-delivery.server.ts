import {
  emailAttemptSchema,
  emailClaimSchema,
  emailContextSchema,
  emailJobSchema,
  emailResultSchema,
  type EmailAttempt,
} from "@holon/contracts/email-delivery";

const now = "CAST(unixepoch('subsec')*1000 AS INTEGER)";
const validInvitation = `EXISTS(SELECT 1 FROM workspace_invitation i WHERE i.id=invitation_delivery_intent.id AND i.state='pending' AND i.expires_at>${now})`;
const eligible = `state='pending' AND accepted_at IS NULL AND deadline>${now} AND ${validInvitation}`;
const currentAttempt = `id=? AND job_id=? AND generation=?`;
function attemptBindings(a: EmailAttempt) {
  return [a.attemptId, a.jobId, a.generation];
}

export function createEmailDeliveryPersistence(db: D1Database) {
  async function reconcile() {
    await db.batch([
      db.prepare(
        `UPDATE invitation_delivery_intent SET state='canceled' WHERE id IN (SELECT id FROM invitation_delivery_intent WHERE state='pending' AND NOT ${validInvitation} LIMIT 50)`,
      ),
      db.prepare(
        `UPDATE invitation_delivery_intent SET state='failed' WHERE id IN (SELECT id FROM invitation_delivery_intent WHERE state='pending' AND accepted_at IS NULL AND (deadline<=${now} OR (attempts>=max_attempts AND lease_until<=${now})) LIMIT 50)`,
      ),
      db.prepare(
        `UPDATE email_delivery_attempt SET outcome='unknown',completed_at=${now} WHERE id IN (SELECT id FROM email_delivery_attempt WHERE outcome IS NULL AND lease_until<=${now} LIMIT 50)`,
      ),
      db.prepare(
        `UPDATE invitation_delivery_intent SET last_outcome='unknown',retry_at=MIN(deadline,lease_until+CASE attempts WHEN 1 THEN 60000 WHEN 2 THEN 300000 WHEN 3 THEN 900000 ELSE 3600000 END),next_action_at=MIN(deadline,lease_until+CASE attempts WHEN 1 THEN 60000 WHEN 2 THEN 300000 WHEN 3 THEN 900000 ELSE 3600000 END),lease_until=0 WHERE id IN (SELECT id FROM invitation_delivery_intent WHERE state='pending' AND lease_until>0 AND lease_until<=${now} LIMIT 50)`,
      ),
    ]);
  }
  return {
    async claim(raw: unknown) {
      const { jobId } = emailJobSchema.parse(raw);
      const attemptId = crypto.randomUUID();
      const results = await db.batch([
        db
          .prepare(
            `UPDATE invitation_delivery_intent SET attempts=attempts+1,generation=generation+1,lease_until=${now}+120000,next_action_at=MIN(deadline,${now}+120000),publication_id=NULL WHERE id=? AND ${eligible} AND attempts<max_attempts AND lease_until=0 AND retry_at<=${now}`,
          )
          .bind(jobId),
        db
          .prepare(
            `INSERT INTO email_delivery_attempt(id,job_id,generation,claimed_at,lease_until) SELECT ?,id,generation,${now},lease_until FROM invitation_delivery_intent WHERE id=? AND changes()=1`,
          )
          .bind(attemptId, jobId),
      ]);
      if (!results[1]?.meta.changes) return null;
      const row = await db
        .prepare(
          "SELECT generation,lease_until FROM email_delivery_attempt WHERE id=?",
        )
        .bind(attemptId)
        .first<{ generation: number; lease_until: number }>();
      return emailClaimSchema.parse({
        jobId,
        attemptId,
        generation: row!.generation,
        leaseUntil: row!.lease_until,
      });
    },
    async start(raw: unknown) {
      const a = emailAttemptSchema.parse(raw);
      const result = await db
        .prepare(
          `UPDATE email_delivery_attempt SET started_at=${now} WHERE ${currentAttempt} AND started_at IS NULL AND outcome IS NULL AND EXISTS(SELECT 1 FROM invitation_delivery_intent WHERE id=? AND generation=? AND lease_until>${now} AND ${eligible})`,
        )
        .bind(...attemptBindings(a), a.jobId, a.generation)
        .run();
      if (!result.meta.changes) return null;
      const row = await db
        .prepare(
          `SELECT i.email,i.locale,i.expires_at,w.name FROM workspace_invitation i JOIN workspace w ON w.id=i.workspace_id JOIN invitation_delivery_intent d ON d.id=i.id WHERE i.id=? AND i.state='pending' AND i.expires_at>${now} AND d.state='pending' AND d.accepted_at IS NULL AND d.generation=? AND d.lease_until>${now} AND d.deadline>${now}`,
        )
        .bind(a.jobId, a.generation)
        .first<{
          email: string;
          locale: string;
          expires_at: number;
          name: string;
        }>();
      if (!row) return null;
      return emailContextSchema.parse({
        jobId: a.jobId,
        recipient: row.email,
        locale: row.locale,
        workspaceName: row.name,
        expiresAt: new Date(row.expires_at).toISOString(),
      });
    },
    async record(raw: unknown) {
      const a = emailResultSchema.parse(raw);
      // Only attempts whose effect was authorized can attest acceptance. Late
      // acceptance upgrades unknown history, never rewrites a newer lease.
      const result = await db.batch([
        db
          .prepare(
            `UPDATE email_delivery_attempt SET outcome=?,completed_at=CASE WHEN outcome=? THEN completed_at ELSE ${now} END WHERE ${currentAttempt} AND started_at IS NOT NULL AND (outcome IS NULL OR outcome=? OR (outcome='unknown' AND ?='accepted'))`,
          )
          .bind(
            a.outcome,
            a.outcome,
            ...attemptBindings(a),
            a.outcome,
            a.outcome,
          ),
        db
          .prepare(
            `UPDATE invitation_delivery_intent SET accepted_at=COALESCE(accepted_at,${now}),last_outcome='accepted',state=CASE WHEN state='pending' THEN 'completed' ELSE state END WHERE id=? AND EXISTS(SELECT 1 FROM email_delivery_attempt WHERE ${currentAttempt} AND outcome='accepted')`,
          )
          .bind(a.jobId, ...attemptBindings(a)),
        db
          .prepare(
            `UPDATE invitation_delivery_intent SET last_outcome=?,lease_until=0,retry_at=MIN(deadline,${now}+CASE attempts WHEN 1 THEN 60000 WHEN 2 THEN 300000 WHEN 3 THEN 900000 ELSE 3600000 END),next_action_at=MIN(deadline,${now}+CASE attempts WHEN 1 THEN 60000 WHEN 2 THEN 300000 WHEN 3 THEN 900000 ELSE 3600000 END),state=CASE WHEN ?='permanent' OR attempts>=max_attempts OR deadline<=${now} THEN 'failed' ELSE state END WHERE id=? AND generation=? AND state='pending' AND accepted_at IS NULL AND lease_until>0 AND EXISTS(SELECT 1 FROM email_delivery_attempt WHERE ${currentAttempt} AND outcome=? AND outcome!='accepted')`,
          )
          .bind(
            a.outcome,
            a.outcome,
            a.jobId,
            a.generation,
            ...attemptBindings(a),
            a.outcome,
          ),
      ]);
      return { recorded: !!result[0]?.meta.changes };
    },
    async due() {
      await reconcile();
      const result = await db
        .prepare(
          `SELECT id FROM invitation_delivery_intent WHERE ${eligible} AND next_action_at<=${now} AND lease_until=0 ORDER BY next_action_at,id LIMIT 50`,
        )
        .all<{ id: string }>();
      return result.results.map((r) => r.id);
    },
    async reservePublication(jobId: string) {
      emailJobSchema.parse({ jobId });
      const id = crypto.randomUUID();
      const result = await db
        .prepare(
          `UPDATE invitation_delivery_intent SET publication_id=?,next_action_at=MIN(deadline,${now}+60000) WHERE id=? AND ${eligible} AND next_action_at<=${now} AND lease_until=0 AND attempts<max_attempts`,
        )
        .bind(id, jobId)
        .run();
      return result.meta.changes ? id : null;
    },
    async published(jobId: string, publicationId: string) {
      await db
        .prepare(
          `UPDATE invitation_delivery_intent SET publication_id=NULL,next_action_at=MIN(deadline,${now}+300000) WHERE id=? AND publication_id=? AND state='pending'`,
        )
        .bind(jobId, publicationId)
        .run();
    },
    async metrics() {
      return db
        .prepare(
          `SELECT COUNT(*) AS pending,COALESCE(SUM(CASE WHEN next_action_at<=${now} THEN 1 ELSE 0 END),0) AS due,COALESCE(MIN(next_action_at),0) AS oldest_due_at,COALESCE(SUM(attempts),0) AS attempts,COALESCE(SUM(last_outcome='unknown'),0) AS unknown,COALESCE(MAX(MAX(0,${now}-next_action_at)),0) AS overdue_ms FROM invitation_delivery_intent WHERE state='pending'`,
        )
        .first<{
          pending: number;
          due: number;
          oldest_due_at: number;
          attempts: number;
          unknown: number;
          overdue_ms: number;
        }>();
    },
  };
}
