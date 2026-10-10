import {
  normalizeReviewSearch,
  privateReviewSummarySchema,
  privateReviewPageSchema,
  projectionWriteSchema,
  recoveryScopeSchema,
  reviewListInputSchema,
  type ProjectionWriteResult,
  type PrivateReviewPage,
  type ReviewListInput,
} from "@holon/contracts/dashboard-reviews";

import { authorityCheck } from "./authority.server.js";
import { createReviewCursor } from "./review-cursor.server.js";

/** Only one repository, selected after human ACL, reaches this adapter. */
export function createProjectionPersistence(
  database: D1Database,
  cursorSecret?: string,
) {
  const cursor = createReviewCursor(cursorSecret);
  return {
    assertReady: authorityCheck(database, "projection"),
    async readScope(
      installationId: number,
      repositoryId: number,
    ): Promise<{ generation: number; state: "active" | "rebuilding" } | null> {
      const row = await database
        .prepare(
          "SELECT generation,state FROM review_projection_scope WHERE installation_id=? AND repository_id=?",
        )
        .bind(installationId, repositoryId)
        .first<{ generation: number; state: "active" | "rebuilding" }>();
      if (
        row &&
        (!Number.isSafeInteger(row.generation) ||
          row.generation < 1 ||
          !["active", "rebuilding"].includes(row.state))
      )
        throw new Error("projection_scope_corrupt");
      return row;
    },
    async write(raw: unknown): Promise<ProjectionWriteResult> {
      const { generation, snapshot: s } = projectionWriteSchema.parse(raw);
      const payload = JSON.stringify(s);
      const scope = [s.installationId, s.repositoryId];
      // Each child statement has its own fence; a zero-row parent cannot guard a batch.
      const result = await database.batch<Record<string, unknown>>([
        database
          .prepare(
            "INSERT INTO review_projection_scope VALUES (?,?,1,'active') ON CONFLICT DO NOTHING",
          )
          .bind(...scope),
        database
          .prepare(`INSERT INTO review_projection
          SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS
          (SELECT 1 FROM review_projection_scope WHERE installation_id=? AND repository_id=? AND generation=?)
          ON CONFLICT(installation_id,repository_id,pull_request_number) DO UPDATE SET
          generation=excluded.generation, snapshot_revision=excluded.snapshot_revision,
          activity_at=excluded.activity_at,state=excluded.state,normalized_title=excluded.normalized_title,payload=excluded.payload
          WHERE excluded.generation>review_projection.generation OR
          (excluded.generation=review_projection.generation AND excluded.snapshot_revision>review_projection.snapshot_revision)`)
          .bind(
            ...scope,
            s.pullRequestNumber,
            generation,
            s.snapshotRevision,
            s.activityAt,
            s.state,
            normalizeReviewSearch(s.title),
            payload,
            ...scope,
            generation,
          ),
        database
          .prepare(`SELECT c.generation AS current_generation,p.generation,p.snapshot_revision,p.payload FROM review_projection_scope c
          LEFT JOIN review_projection p ON p.installation_id=c.installation_id AND p.repository_id=c.repository_id AND p.pull_request_number=?
          WHERE c.installation_id=? AND c.repository_id=?`)
          .bind(s.pullRequestNumber, ...scope),
      ]);
      const row = result[2]?.results[0];
      if (
        !result.every((x) => x.success) ||
        !row ||
        typeof row.current_generation !== "number"
      )
        throw new Error("Invalid projection reply");
      if (row.current_generation !== generation) return "fenced";
      if (
        row.snapshot_revision === s.snapshotRevision &&
        row.generation === generation
      ) {
        if (row.payload !== payload) return "conflict";
        return result[1]?.meta.changes === 1 ? "applied" : "duplicate";
      }
      if (
        typeof row.snapshot_revision === "number" &&
        row.snapshot_revision > s.snapshotRevision
      )
        return "stale";
      throw new Error("Invalid projection write result");
    },
    async beginRecovery(raw: unknown): Promise<number> {
      const s = recoveryScopeSchema.parse(raw);
      const result = await database
        .prepare(`UPDATE review_projection_scope SET generation=generation+1,state='rebuilding'
        WHERE installation_id=? AND repository_id=? AND generation=? AND state='active' RETURNING generation`)
        .bind(s.installationId, s.repositoryId, s.expectedGeneration)
        .first<{ generation: number }>();
      if (!result) throw new Error("recovery_conflict");
      return result.generation;
    },
    async activateRecovery(raw: unknown): Promise<void> {
      const s = recoveryScopeSchema.parse(raw);
      const result = await database
        .prepare(`UPDATE review_projection_scope SET state='active'
        WHERE installation_id=? AND repository_id=? AND generation=? AND state='rebuilding'
        AND NOT EXISTS(SELECT 1 FROM review_projection WHERE installation_id=? AND repository_id=? AND generation<>?) RETURNING generation`)
        .bind(
          s.installationId,
          s.repositoryId,
          s.expectedGeneration,
          s.installationId,
          s.repositoryId,
          s.expectedGeneration,
        )
        .first();
      if (!result) throw new Error("recovery_incomplete");
    },
    async list(raw: ReviewListInput): Promise<PrivateReviewPage> {
      const input = reviewListInputSchema.parse(raw);
      const position = input.cursor
        ? await cursor.read(input.cursor, input)
        : null;
      const term = normalizeReviewSearch(input.search);
      const number = /^#?[1-9][0-9]*$/u.test(input.search)
        ? Number(input.search.replace(/^#/u, ""))
        : -1;
      const condition = `p.installation_id=? AND p.repository_id=? AND p.generation=c.generation AND c.state='active'
        AND (? IS NULL OR p.state=?) AND (?='' OR p.pull_request_number=? OR instr(p.normalized_title,?)>0)`;
      const params = [
        input.installationId,
        input.repositoryId,
        input.status,
        input.status,
        term,
        number,
        term,
      ];
      const join = `FROM review_projection p JOIN review_projection_scope c ON c.installation_id=p.installation_id AND c.repository_id=p.repository_id`;
      const startedAt = Date.now();
      const result = await database.batch<Record<string, unknown>>([
        database
          .prepare(`SELECT p.payload ${join} WHERE ${condition} AND
          (? IS NULL OR p.activity_at<? OR (p.activity_at=? AND p.pull_request_number<?))
          ORDER BY p.activity_at DESC,p.pull_request_number DESC LIMIT ?`)
          .bind(
            ...params,
            position?.activityAt ?? null,
            position?.activityAt ?? null,
            position?.activityAt ?? null,
            position?.pullRequestNumber ?? null,
            input.limit + 1,
          ),
        database
          .prepare(`SELECT count(*) AS total ${join} WHERE ${condition}`)
          .bind(...params),
      ]);
      if (!result.every((x) => x.success) || !result[0] || !result[1])
        throw new Error("Invalid projection list result");
      console.info(
        JSON.stringify({
          event: "projection_read",
          duration_ms: Date.now() - startedAt,
          rows_read: result.reduce(
            (sum, query) => sum + (query.meta.rows_read ?? 0),
            0,
          ),
          returned: result[0].results.length,
        }),
      );
      const rows = result[0].results.map((x) =>
        privateReviewSummarySchema.parse(JSON.parse(String(x.payload))),
      );
      const items = rows.slice(0, input.limit),
        last = items.at(-1);
      return privateReviewPageSchema.parse({
        items,
        total: result[1].results[0]?.total,
        nextCursor:
          rows.length > input.limit && last
            ? await cursor.write(last, input)
            : null,
        observedAt: new Date().toISOString(),
      });
    },
  };
}
