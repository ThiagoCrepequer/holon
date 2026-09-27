import {
  analysisAccountingSchema,
  analysisUsageSchema,
  runIdSchema,
  type AnalysisUsage,
  type AnalysisAccounting,
} from "@holon/contracts";

export class ReviewAccountingStore {
  public constructor(private readonly sql: SqlStorage) {}
  public record(
    rawRunId: string,
    eventId: string,
    rawUsage: AnalysisUsage,
  ): void {
    const runId = runIdSchema.parse(rawRunId);
    if (!/^[a-zA-Z0-9:-]{1,100}$/u.test(eventId))
      throw new TypeError("Invalid usage event ID");
    const usage = analysisUsageSchema.parse(rawUsage);
    if (
      !this.sql.exec("SELECT 1 FROM runs WHERE id = ?", runId).toArray().length
    )
      throw new Error("Usage run is unavailable");
    this.sql.exec(
      "INSERT INTO analysis_usage(run_id,event_id,input_tokens,output_tokens,tool_calls) VALUES (?,?,?,?,?) ON CONFLICT(run_id,event_id) DO NOTHING",
      runId,
      eventId,
      usage.inputTokens,
      usage.outputTokens,
      usage.toolCallsCount,
    );
  }
  public reserveToolCall(
    rawRunId: string,
    index: number,
    totalShards: number,
  ): boolean {
    const runId = runIdSchema.parse(rawRunId);
    if (
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(totalShards) ||
      index < 0 ||
      index >= totalShards ||
      totalShards > 5
    )
      throw new TypeError("Invalid shard allocation");
    const allocation = 12;
    const prefix = `tool:${index}:`;
    const row = this.sql
      .exec<{ total: number; shard: number }>(
        "SELECT COALESCE(SUM(tool_calls),0) AS total, COALESCE(SUM(CASE WHEN event_id LIKE ? THEN tool_calls ELSE 0 END),0) AS shard FROM analysis_usage WHERE run_id = ?",
        `${prefix}%`,
        runId,
      )
      .toArray()[0]!;
    if (row.total >= 12 * totalShards || row.shard >= allocation) return false;
    this.record(runId, `${prefix}${row.shard + 1}`, {
      inputTokens: 0,
      outputTokens: 0,
      toolCallsCount: 1,
    });
    return true;
  }
  public load(rawRunId: string): AnalysisAccounting {
    const runId = runIdSchema.parse(rawRunId);
    const usage = this.sql
      .exec<{
        inputTokens: number;
        outputTokens: number;
        toolCallsCount: number;
      }>(
        "SELECT COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens, COALESCE(SUM(tool_calls),0) AS toolCallsCount FROM analysis_usage WHERE run_id = ?",
        runId,
      )
      .toArray()[0]!;
    const rows = this.sql
      .exec<{
        step_name: string;
        attempt: number;
        duration_ms: number;
        status: string;
      }>(
        "SELECT step_name,attempt,duration_ms,status FROM step_attempts WHERE run_id = ? AND status IN ('completed','failed') ORDER BY started_at,step_name,attempt",
        runId,
      )
      .toArray();
    return analysisAccountingSchema.parse({
      ...usage,
      stepTimings: rows.map((row) => ({
        stepName: row.step_name,
        attempt: row.attempt,
        durationMs: row.duration_ms ?? 0,
        status: row.status === "completed" ? "success" : "failure",
      })),
    });
  }
}
