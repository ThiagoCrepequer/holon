import {
  type AdminRunProjectionEventV1,
  type AdminRunProjectionPayloadV1,
  buildAdminProjectionEventV1,
  type CursorKeyring,
  type RunId,
} from "@holon/contracts";

export const TEST_KEYRING: CursorKeyring = {
  primary: {
    kid: "cursor-key-2026-01",
    secretHex:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
  secondary: {
    kid: "cursor-key-2025-12",
    secretHex:
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  },
};

export async function setupTestDatabase(db: D1Database): Promise<void> {
  const statements = [
    "DROP TABLE IF EXISTS admin_projection_quarantine",
    "DROP TABLE IF EXISTS admin_metadata",
    "DROP TABLE IF EXISTS admin_runs",
    `CREATE TABLE admin_runs (
      run_id TEXT PRIMARY KEY,
      repository_id INTEGER NOT NULL CHECK (repository_id > 0),
      repository_owner TEXT NOT NULL CHECK (length(repository_owner) BETWEEN 1 AND 100),
      repository_name TEXT NOT NULL CHECK (length(repository_name) BETWEEN 1 AND 100),
      pr_key TEXT NOT NULL,
      pr_number INTEGER NOT NULL CHECK (pr_number > 0),
      head_sha TEXT NOT NULL CHECK (length(head_sha) = 40),
      terminal_state TEXT NOT NULL CHECK (terminal_state IN ('completed', 'failed_terminal', 'obsolete')),
      verdict TEXT CHECK (verdict IN ('APPROVE', 'REQUEST_CHANGES', 'COMMENT') OR verdict IS NULL),
      scope_status TEXT CHECK (scope_status IN ('complete', 'partial_by_policy', 'partial_by_failure', 'unsupported') OR scope_status IS NULL),
      review_phase_reached TEXT NOT NULL CHECK (review_phase_reached IN ('admitted', 'repository_prepared', 'analysis_started', 'analyzed', 'publishing')),
      review_admission_wait_ms INTEGER NOT NULL CHECK (review_admission_wait_ms >= 0),
      execution_duration_ms INTEGER NOT NULL CHECK (execution_duration_ms >= 0),
      input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
      output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
      reasoning_tokens INTEGER CHECK (reasoning_tokens >= 0 OR reasoning_tokens IS NULL),
      tool_calls_count INTEGER NOT NULL CHECK (tool_calls_count >= 0),
      estimated_cost_micro_usd INTEGER NOT NULL CHECK (estimated_cost_micro_usd >= 0),
      pricing_model TEXT NOT NULL CHECK (length(pricing_model) BETWEEN 1 AND 100),
      shards_count INTEGER NOT NULL CHECK (shards_count >= 0),
      is_degraded INTEGER NOT NULL CHECK (is_degraded IN (0, 1)),
      webhook_received_at TEXT NOT NULL,
      workflow_started_at TEXT NOT NULL,
      analysis_started_at TEXT,
      terminal_at TEXT NOT NULL,
      terminal_at_epoch_ms INTEGER NOT NULL CHECK (terminal_at_epoch_ms > 0),
      projection_requested_at TEXT NOT NULL,
      projected_at TEXT NOT NULL,
      projected_at_epoch_ms INTEGER NOT NULL CHECK (projected_at_epoch_ms > 0),
      projection_delivery_lag_ms INTEGER NOT NULL CHECK (projection_delivery_lag_ms >= 0),
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      record_version INTEGER NOT NULL CHECK (record_version = 1),
      payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
      source_event_id TEXT NOT NULL UNIQUE
    )`,
    "CREATE INDEX idx_admin_runs_cursor ON admin_runs(terminal_at_epoch_ms DESC, run_id DESC)",
    "CREATE INDEX idx_admin_runs_repo_cursor ON admin_runs(repository_id, terminal_at_epoch_ms DESC, run_id DESC)",
    "CREATE INDEX idx_admin_runs_state_cursor ON admin_runs(terminal_state, terminal_at_epoch_ms DESC, run_id DESC)",
    "CREATE INDEX idx_admin_runs_repo_pr ON admin_runs(repository_id, pr_number, terminal_at_epoch_ms DESC, run_id DESC)",
    "CREATE INDEX idx_admin_runs_head_sha ON admin_runs(head_sha)",
    `CREATE TABLE admin_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at_epoch_ms INTEGER NOT NULL
    )`,
    `CREATE TABLE admin_projection_quarantine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observed_event_id_hash TEXT,
      observed_run_id_hash TEXT,
      computed_payload_hash TEXT NOT NULL CHECK (length(computed_payload_hash) = 64),
      payload_bytes INTEGER NOT NULL CHECK (payload_bytes >= 0),
      observed_schema_version INTEGER,
      error_code TEXT NOT NULL CHECK (length(error_code) BETWEEN 1 AND 100),
      created_at_epoch_ms INTEGER NOT NULL CHECK (created_at_epoch_ms > 0)
    )`,
    "CREATE INDEX idx_admin_projection_quarantine_created ON admin_projection_quarantine(created_at_epoch_ms)",
  ];

  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

export function createSampleProjectionPayload(
  overrides?: Record<string, unknown>,
): AdminRunProjectionPayloadV1 {
  const sha =
    (overrides?.headSha as string) ??
    "0123456789abcdef0123456789abcdef01234567";
  const repoObj = overrides?.repository as Record<string, unknown> | undefined;
  const repoId =
    (repoObj?.id as number) ?? (overrides?.repositoryId as number) ?? 101;
  const repoName =
    (repoObj?.name as string) ??
    (overrides?.repositoryName as string) ??
    "test-repo";
  const repoOwner =
    (repoObj?.owner as string) ??
    (overrides?.repositoryOwner as string) ??
    "test-owner";
  const prNum =
    (overrides?.pullRequestNumber as number) ??
    (overrides?.prNumber as number) ??
    1;
  const prKey = (overrides?.prKey as string) ?? `github:${repoId}:pr:${prNum}`;
  const runId = ((overrides?.runId as string) ??
    `${prKey}:head:${sha}`) as RunId;

  const terminalEpoch = overrides?.terminalAtEpochMs as number | undefined;
  const terminalAt =
    ((overrides?.timestamps as Record<string, unknown>)
      ?.terminalAt as string) ??
    (terminalEpoch
      ? new Date(terminalEpoch).toISOString()
      : (overrides?.terminalAt as string)) ??
    "2026-03-04T00:00:45.000Z";
  const terminalMs = Date.parse(terminalAt);

  const webhookReceivedAt =
    ((overrides?.timestamps as Record<string, unknown>)
      ?.webhookReceivedAt as string) ??
    new Date(terminalMs - 45000).toISOString();
  const workflowStartedAt =
    ((overrides?.timestamps as Record<string, unknown>)
      ?.workflowStartedAt as string) ??
    new Date(terminalMs - 44000).toISOString();
  const timestampsObj = overrides?.timestamps as
    | Record<string, unknown>
    | undefined;
  const analysisStartedAt =
    timestampsObj?.analysisStartedAt !== undefined
      ? (timestampsObj.analysisStartedAt as string | null)
      : overrides?.analysisStartedAt !== undefined
        ? (overrides.analysisStartedAt as string | null)
        : new Date(terminalMs - 40000).toISOString();
  const projectionRequestedAt =
    (overrides?.projectionRequestedAt as string) ??
    new Date(terminalMs + 5000).toISOString();

  const telemObj = overrides?.telemetry as Record<string, unknown> | undefined;
  const inputTokens =
    (telemObj?.inputTokens as number) ??
    (overrides?.inputTokens as number) ??
    12000;
  const outputTokens =
    (telemObj?.outputTokens as number) ??
    (overrides?.outputTokens as number) ??
    800;
  const reasoningTokens =
    telemObj?.reasoningTokens !== undefined
      ? (telemObj.reasoningTokens as number | null)
      : overrides?.reasoningTokens !== undefined
        ? (overrides.reasoningTokens as number | null)
        : 250;
  const executionDurationMs =
    (telemObj?.executionDurationMs as number) ??
    (overrides?.executionDurationMs as number) ??
    44000;
  const estimatedCostMicroUsd =
    (telemObj?.estimatedCostMicroUsd as number) ??
    (overrides?.estimatedCostMicroUsd as number) ??
    1500;
  const toolCallsCount =
    (telemObj?.toolCallsCount as number) ??
    (overrides?.toolCallsCount as number) ??
    4;
  const isDegraded =
    (telemObj?.isDegraded as boolean) ??
    (overrides?.isDegraded as boolean) ??
    false;
  const pricingModel =
    (telemObj?.pricingModel as string) ??
    (overrides?.pricingModel as string) ??
    "cloudflare/workers-ai-v1";
  const reviewAdmissionQueueWaitMs =
    (telemObj?.reviewAdmissionQueueWaitMs as number) ??
    (overrides?.reviewAdmissionWaitMs as number) ??
    1000;
  const shardsCount =
    (telemObj?.shardsCount as number) ??
    (overrides?.shardsCount as number) ??
    1;

  const terminalState =
    (overrides?.terminalState as
      | "completed"
      | "failed_terminal"
      | "obsolete") ?? "completed";
  const scopeStatus =
    overrides?.scopeStatus !== undefined
      ? (overrides.scopeStatus as
          | "complete"
          | "partial_by_policy"
          | "partial_by_failure"
          | "unsupported"
          | null)
      : "complete";
  const verdict =
    overrides?.verdict !== undefined
      ? (overrides.verdict as "APPROVE" | "REQUEST_CHANGES" | "COMMENT" | null)
      : "APPROVE";
  const reviewPhaseReached =
    (overrides?.reviewPhaseReached as
      | "admitted"
      | "repository_prepared"
      | "analysis_started"
      | "analyzed"
      | "publishing") ?? "publishing";

  return {
    headSha: sha,
    prKey,
    projectedFrom: "workflow",
    projectionRequestedAt,
    pullRequestNumber: prNum,
    recordVersion: 1,
    repository: {
      id: repoId,
      name: repoName,
      owner: repoOwner,
    },
    reviewPhaseReached,
    runId,
    schemaVersion: 1,
    scopeStatus,
    telemetry: {
      estimatedCostMicroUsd,
      executionDurationMs,
      inputTokens,
      isDegraded,
      outputTokens,
      pricingModel,
      reasoningTokens,
      reviewAdmissionQueueWaitMs,
      shardsCount,
      toolCallsCount,
    },
    terminalState,
    timestamps: {
      analysisStartedAt,
      terminalAt,
      webhookReceivedAt,
      workflowStartedAt,
    },
    verdict,
  };
}

export async function createSampleProjectionEvent(
  payloadOverrides?: Record<string, unknown>,
  eventIdOverride?: string,
): Promise<AdminRunProjectionEventV1> {
  const payload = createSampleProjectionPayload(payloadOverrides);
  const event = await buildAdminProjectionEventV1(payload);
  if (eventIdOverride) {
    return {
      ...event,
      eventId: eventIdOverride,
    };
  }
  return event;
}
