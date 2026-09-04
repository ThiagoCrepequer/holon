import {
  type AdminRunProjectionEventV1,
  type AdminRunsFilterParams,
  computeFilterHash,
  computeSha256Hex,
  type CursorKeyring,
  decodeAdminCursor,
  encodeAdminCursor,
} from "@holon/contracts";

import type {
  AdminQuarantineRow,
  AdminRunRow,
  AdminSummaryMetrics,
  RetentionCleanupResult,
} from "./types.js";

export type InsertProjectionResult =
  | { status: "inserted" }
  | { status: "duplicate" }
  | { status: "conflict" }
  | { status: "event_id_collision" };

export interface QuarantineParams {
  observedEventId?: string | null | undefined;
  observedRunId?: string | null | undefined;
  payloadBytes: number;
  computedPayloadHash: string;
  observedSchemaVersion?: number | null | undefined;
  errorCode: string;
  nowEpochMs?: number | undefined;
}

export class D1AdminStorage {
  constructor(private readonly db: D1Database) {}

  async insertProjection(
    event: AdminRunProjectionEventV1,
    nowEpochMs?: number,
  ): Promise<InsertProjectionResult> {
    const now = nowEpochMs ?? Date.now();
    const projectedAt = new Date(now).toISOString();
    const projectedAtEpochMs = now;
    const payload = event.payload;
    const terminalAtEpochMs = Date.parse(payload.timestamps.terminalAt);
    const projectionRequestedAtEpochMs = Date.parse(
      payload.projectionRequestedAt,
    );
    const projectionDeliveryLagMs = Math.max(
      0,
      projectedAtEpochMs - projectionRequestedAtEpochMs,
    );

    const insertSql = `
      INSERT INTO admin_runs (
        run_id,
        repository_id,
        repository_owner,
        repository_name,
        pr_key,
        pr_number,
        head_sha,
        terminal_state,
        verdict,
        scope_status,
        review_phase_reached,
        review_admission_wait_ms,
        execution_duration_ms,
        input_tokens,
        output_tokens,
        reasoning_tokens,
        tool_calls_count,
        estimated_cost_micro_usd,
        pricing_model,
        shards_count,
        is_degraded,
        webhook_received_at,
        workflow_started_at,
        analysis_started_at,
        terminal_at,
        terminal_at_epoch_ms,
        projection_requested_at,
        projected_at,
        projected_at_epoch_ms,
        projection_delivery_lag_ms,
        schema_version,
        record_version,
        payload_hash,
        source_event_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(run_id) DO NOTHING;
    `;

    try {
      const result = await this.db
        .prepare(insertSql)
        .bind(
          payload.runId,
          payload.repository.id,
          payload.repository.owner,
          payload.repository.name,
          payload.prKey,
          payload.pullRequestNumber,
          payload.headSha,
          payload.terminalState,
          payload.verdict ?? null,
          payload.scopeStatus ?? null,
          payload.reviewPhaseReached,
          payload.telemetry.reviewAdmissionQueueWaitMs,
          payload.telemetry.executionDurationMs,
          payload.telemetry.inputTokens,
          payload.telemetry.outputTokens,
          payload.telemetry.reasoningTokens ?? null,
          payload.telemetry.toolCallsCount,
          payload.telemetry.estimatedCostMicroUsd,
          payload.telemetry.pricingModel,
          payload.telemetry.shardsCount,
          payload.telemetry.isDegraded ? 1 : 0,
          payload.timestamps.webhookReceivedAt,
          payload.timestamps.workflowStartedAt,
          payload.timestamps.analysisStartedAt ?? null,
          payload.timestamps.terminalAt,
          terminalAtEpochMs,
          payload.projectionRequestedAt,
          projectedAt,
          projectedAtEpochMs,
          projectionDeliveryLagMs,
          payload.schemaVersion,
          payload.recordVersion,
          event.payloadHash,
          event.eventId,
        )
        .run();

      if (result.meta?.changes && result.meta.changes > 0) {
        await this.db
          .prepare(
            `INSERT INTO admin_metadata (key, value, updated_at_epoch_ms)
             VALUES ('last_projection_received_at', ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at_epoch_ms = excluded.updated_at_epoch_ms;`,
          )
          .bind(projectedAt, projectedAtEpochMs)
          .run();

        return { status: "inserted" };
      }

      // Check existing row
      const existing = await this.db
        .prepare(
          `SELECT payload_hash, source_event_id, schema_version, record_version FROM admin_runs WHERE run_id = ?`,
        )
        .bind(payload.runId)
        .first<{
          payload_hash: string;
          source_event_id: string;
          schema_version: number;
          record_version: number;
        }>();

      if (
        existing &&
        existing.payload_hash === event.payloadHash &&
        existing.source_event_id === event.eventId
      ) {
        return { status: "duplicate" };
      }

      return { status: "conflict" };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "";
      if (
        errorMsg.includes("admin_runs.source_event_id") ||
        errorMsg.includes("UNIQUE constraint failed")
      ) {
        const existingByEventId = await this.db
          .prepare(`SELECT run_id FROM admin_runs WHERE source_event_id = ?`)
          .bind(event.eventId)
          .first<{ run_id: string }>();

        if (existingByEventId && existingByEventId.run_id !== payload.runId) {
          return { status: "event_id_collision" };
        }
      }
      throw error;
    }
  }

  async quarantine(params: QuarantineParams): Promise<void> {
    const now = params.nowEpochMs ?? Date.now();
    const eventIdHash = params.observedEventId
      ? await computeSha256Hex(params.observedEventId)
      : null;
    const runIdHash = params.observedRunId
      ? await computeSha256Hex(params.observedRunId)
      : null;

    await this.db
      .prepare(
        `INSERT INTO admin_projection_quarantine (
          observed_event_id_hash,
          observed_run_id_hash,
          computed_payload_hash,
          payload_bytes,
          observed_schema_version,
          error_code,
          created_at_epoch_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      )
      .bind(
        eventIdHash,
        runIdHash,
        params.computedPayloadHash,
        params.payloadBytes,
        params.observedSchemaVersion ?? null,
        params.errorCode,
        now,
      )
      .run();
  }

  async getQuarantined(limit = 50): Promise<AdminQuarantineRow[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM admin_projection_quarantine ORDER BY created_at_epoch_ms DESC, id DESC LIMIT ?`,
      )
      .bind(limit)
      .all<AdminQuarantineRow>();
    return result.results ?? [];
  }

  async listRuns(
    params: Partial<AdminRunsFilterParams> & {
      searchQuery?: string | undefined;
      cursor?: string | undefined;
    },
    keyring: CursorKeyring,
    nowEpochMs?: number,
  ): Promise<{ runs: AdminRunRow[]; nextCursor: string | null }> {
    const filterParams: Partial<AdminRunsFilterParams> = {
      order: params.order ?? "desc",
      pageSize: params.pageSize ?? 50,
      period: params.period ?? "24h",
    };
    if (params.repositoryId !== undefined) {
      filterParams.repositoryId = params.repositoryId;
    }
    if (params.terminalState !== undefined) {
      filterParams.terminalState = params.terminalState;
    }
    if (params.verdict !== undefined) {
      filterParams.verdict = params.verdict;
    }
    const currentFilterHash = await computeFilterHash(filterParams);
    let seekPayload: { terminalAtEpochMs: number; runId: string } | null = null;

    if (params.cursor) {
      const decoded = await decodeAdminCursor(
        params.cursor,
        currentFilterHash,
        keyring,
        nowEpochMs,
      );
      seekPayload = {
        terminalAtEpochMs: decoded.terminalAtEpochMs,
        runId: decoded.runId,
      };
    }

    const conditions: string[] = [];
    const bindings: (string | number)[] = [];

    const periodMs =
      filterParams.period === "30d"
        ? 30 * 24 * 3600 * 1000
        : filterParams.period === "7d"
          ? 7 * 24 * 3600 * 1000
          : 24 * 3600 * 1000;
    const minEpochMs = (nowEpochMs ?? Date.now()) - periodMs;
    conditions.push("terminal_at_epoch_ms >= ?");
    bindings.push(minEpochMs);

    if (filterParams.repositoryId !== undefined) {
      conditions.push("repository_id = ?");
      bindings.push(filterParams.repositoryId);
    }

    if (filterParams.terminalState !== undefined) {
      conditions.push("terminal_state = ?");
      bindings.push(filterParams.terminalState);
    }

    if (filterParams.verdict !== undefined) {
      conditions.push("verdict = ?");
      bindings.push(filterParams.verdict);
    }

    if (params.searchQuery && params.searchQuery.trim().length > 0) {
      const q = params.searchQuery.trim();
      const prMatch = q.match(/^([^/]+)\/([^#]+)#(\d+)$/);
      const match1 = prMatch?.[1];
      const match2 = prMatch?.[2];
      const match3 = prMatch?.[3];
      if (prMatch && match1 && match2 && match3) {
        conditions.push(
          "repository_owner = ? AND repository_name = ? AND pr_number = ?",
        );
        bindings.push(match1.trim(), match2.trim(), parseInt(match3, 10));
      } else if (/^[a-fA-F0-9]{40}$/.test(q)) {
        conditions.push("head_sha = ?");
        bindings.push(q.toLowerCase());
      } else if (q.startsWith("github:") || q.includes(":")) {
        conditions.push("run_id = ?");
        bindings.push(q);
      } else {
        conditions.push("1 = 0");
      }
    }

    if (seekPayload) {
      conditions.push(
        "(terminal_at_epoch_ms < ? OR (terminal_at_epoch_ms = ? AND run_id < ?))",
      );
      bindings.push(
        seekPayload.terminalAtEpochMs,
        seekPayload.terminalAtEpochMs,
        seekPayload.runId,
      );
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const pageSize = filterParams.pageSize ?? 50;
    const limitPlusOne = pageSize + 1;

    const sql = `
      SELECT * FROM admin_runs
      ${whereClause}
      ORDER BY terminal_at_epoch_ms DESC, run_id DESC
      LIMIT ?;
    `;
    bindings.push(limitPlusOne);

    const result = await this.db
      .prepare(sql)
      .bind(...bindings)
      .all<AdminRunRow>();
    const rows = result.results ?? [];

    const hasMore = rows.length > pageSize;
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows;

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const lastRow = pageRows[pageRows.length - 1];
      if (lastRow) {
        nextCursor = await encodeAdminCursor(
          {
            filterHash: currentFilterHash,
            runId: lastRow.run_id,
            terminalAtEpochMs: lastRow.terminal_at_epoch_ms,
          },
          keyring,
          nowEpochMs,
        );
      }
    }

    return {
      runs: pageRows,
      nextCursor,
    };
  }

  async getRunById(runId: string): Promise<AdminRunRow | null> {
    const result = await this.db
      .prepare(`SELECT * FROM admin_runs WHERE run_id = ?`)
      .bind(runId)
      .first<AdminRunRow>();
    return result ?? null;
  }

  async getSummaryMetrics(
    period: "24h" | "7d" | "30d" = "24h",
    nowEpochMs?: number,
  ): Promise<AdminSummaryMetrics> {
    const periodMs =
      period === "30d"
        ? 30 * 24 * 3600 * 1000
        : period === "7d"
          ? 7 * 24 * 3600 * 1000
          : 24 * 3600 * 1000;
    const minEpochMs = (nowEpochMs ?? Date.now()) - periodMs;

    const summaryResult = await this.db
      .prepare(
        `SELECT
          COUNT(*) as total_runs,
          SUM(CASE WHEN terminal_state = 'completed' THEN 1 ELSE 0 END) as completed_runs,
          SUM(CASE WHEN terminal_state = 'failed_terminal' THEN 1 ELSE 0 END) as failed_terminal_runs,
          SUM(CASE WHEN terminal_state = 'obsolete' THEN 1 ELSE 0 END) as obsolete_runs,
          COALESCE(SUM(input_tokens), 0) as total_input_tokens,
          COALESCE(SUM(output_tokens), 0) as total_output_tokens,
          COALESCE(SUM(reasoning_tokens), 0) as total_reasoning_tokens,
          COALESCE(SUM(estimated_cost_micro_usd), 0) as total_cost_micro_usd,
          COALESCE(AVG(execution_duration_ms), 0) as avg_duration_ms
        FROM admin_runs
        WHERE terminal_at_epoch_ms >= ?;`,
      )
      .bind(minEpochMs)
      .first<{
        total_runs: number;
        completed_runs: number;
        failed_terminal_runs: number;
        obsolete_runs: number;
        total_input_tokens: number;
        total_output_tokens: number;
        total_reasoning_tokens: number;
        total_cost_micro_usd: number;
        avg_duration_ms: number;
      }>();

    const verdictsResult = await this.db
      .prepare(
        `SELECT verdict, COUNT(*) as count
        FROM admin_runs
        WHERE terminal_at_epoch_ms >= ? AND verdict IS NOT NULL
        GROUP BY verdict;`,
      )
      .bind(minEpochMs)
      .all<{ verdict: string; count: number }>();

    const total = summaryResult?.total_runs ?? 0;
    const completed = summaryResult?.completed_runs ?? 0;
    const failed = summaryResult?.failed_terminal_runs ?? 0;
    const obsolete = summaryResult?.obsolete_runs ?? 0;
    const successRate = total > 0 ? (completed / total) * 100 : 100;

    const verdictMap = { approve: 0, requestChanges: 0, comment: 0 };
    for (const row of verdictsResult.results ?? []) {
      if (row.verdict === "APPROVE") verdictMap.approve = row.count;
      if (row.verdict === "REQUEST_CHANGES")
        verdictMap.requestChanges = row.count;
      if (row.verdict === "COMMENT") verdictMap.comment = row.count;
    }

    return {
      totalRuns: total,
      completedRuns: completed,
      failedTerminalRuns: failed,
      obsoleteRuns: obsolete,
      successRatePercentage: Math.round(successRate * 10) / 10,
      totalTokens:
        (summaryResult?.total_input_tokens ?? 0) +
        (summaryResult?.total_output_tokens ?? 0) +
        (summaryResult?.total_reasoning_tokens ?? 0),
      totalInputTokens: summaryResult?.total_input_tokens ?? 0,
      totalOutputTokens: summaryResult?.total_output_tokens ?? 0,
      totalReasoningTokens: summaryResult?.total_reasoning_tokens ?? 0,
      totalEstimatedCostMicroUsd: summaryResult?.total_cost_micro_usd ?? 0,
      averageExecutionDurationMs: Math.round(
        summaryResult?.avg_duration_ms ?? 0,
      ),
      verdictDistribution: verdictMap,
    };
  }

  async cleanupRetention(nowEpochMs?: number): Promise<RetentionCleanupResult> {
    const now = nowEpochMs ?? Date.now();
    const runsRetentionMs = 180 * 24 * 3600 * 1000;
    const runsThresholdEpochMs = now - runsRetentionMs;

    const deleteRunsSql = `
      DELETE FROM admin_runs
      WHERE run_id IN (
        SELECT run_id
        FROM admin_runs
        WHERE terminal_at_epoch_ms < ?
        ORDER BY terminal_at_epoch_ms ASC, run_id ASC
        LIMIT 500
      );
    `;

    const runsResult = await this.db
      .prepare(deleteRunsSql)
      .bind(runsThresholdEpochMs)
      .run();
    const deletedRuns = runsResult.meta?.changes ?? 0;

    const quarantineRetentionMs = 30 * 24 * 3600 * 1000;
    const quarantineThresholdEpochMs = now - quarantineRetentionMs;

    const deleteQuarantineSql = `
      DELETE FROM admin_projection_quarantine
      WHERE id IN (
        SELECT id
        FROM admin_projection_quarantine
        WHERE created_at_epoch_ms < ?
        ORDER BY created_at_epoch_ms ASC, id ASC
        LIMIT 500
      );
    `;

    const quarantineResult = await this.db
      .prepare(deleteQuarantineSql)
      .bind(quarantineThresholdEpochMs)
      .run();
    const deletedQuarantine = quarantineResult.meta?.changes ?? 0;

    return {
      deletedRunsCount: deletedRuns,
      deletedQuarantineCount: deletedQuarantine,
    };
  }
}
