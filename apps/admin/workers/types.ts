export interface AdminRunRow {
  run_id: string;
  repository_id: number;
  repository_owner: string;
  repository_name: string;
  pr_key: string;
  pr_number: number;
  head_sha: string;
  terminal_state: "completed" | "failed_terminal" | "obsolete" | null;
  verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" | null;
  scope_status:
    | "complete"
    | "partial_by_policy"
    | "partial_by_failure"
    | "unsupported"
    | null;
  review_phase_reached:
    | "admitted"
    | "repository_prepared"
    | "analysis_started"
    | "analyzed"
    | "publishing";
  review_admission_wait_ms: number;
  execution_duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number | null;
  tool_calls_count: number;
  estimated_cost_micro_usd: number;
  pricing_model: string;
  shards_count: number;
  is_degraded: number;
  webhook_received_at: string;
  workflow_started_at: string;
  analysis_started_at: string | null;
  terminal_at: string;
  terminal_at_epoch_ms: number;
  projection_requested_at: string;
  projected_at: string;
  projected_at_epoch_ms: number;
  projection_delivery_lag_ms: number;
  schema_version: number;
  record_version: number;
  payload_hash: string;
  source_event_id: string;
}

export interface AdminQuarantineRow {
  id: number;
  observed_event_id_hash: string | null;
  observed_run_id_hash: string | null;
  computed_payload_hash: string;
  payload_bytes: number;
  observed_schema_version: number | null;
  error_code: string;
  created_at_epoch_ms: number;
}

export interface AdminSummaryMetrics {
  totalRuns: number;
  completedRuns: number;
  failedTerminalRuns: number;
  obsoleteRuns: number;
  successRatePercentage: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalEstimatedCostMicroUsd: number;
  averageExecutionDurationMs: number;
  verdictDistribution: {
    approve: number;
    requestChanges: number;
    comment: number;
  };
}

export interface RetentionCleanupResult {
  deletedRunsCount: number;
  deletedQuarantineCount: number;
}
