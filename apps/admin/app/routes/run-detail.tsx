import {
  adminRunDetailV3Schema,
  runIdSchema,
  type AdminRunDetailV3,
} from "@holon/contracts";
import * as React from "react";
import {
  data,
  type LoaderFunctionArgs,
  useLoaderData,
  useRevalidator,
} from "react-router";

import { D1AdminStorage } from "../../workers/d1-adapter.js";
import type { AdminReadRpcClient } from "../../workers/observability/readiness.js";
import type { AdminRunRow } from "../../workers/types.js";
import { adminRequestContext } from "../server/request-context.js";
import { RunDetailView } from "../views/run-detail-view.js";

export function parseRpcRunDetail(value: unknown): AdminRunDetailV3 | null {
  if (value === null) return null;
  const parsedV3 = adminRunDetailV3Schema.safeParse(value);
  if (parsedV3.success) return parsedV3.data;
  throw new Error("Invalid RPC run detail response");
}

export function createSyntheticAdminRunRow(
  detail: AdminRunDetailV3,
  repoInfo?: { repository_owner: string; repository_name: string } | null,
): AdminRunRow {
  const prParts = detail.run.prKey.split(":");
  const repoId = Number(prParts[1]) || 0;
  const prNumber = Number(prParts[3]) || 0;
  const createdAt = detail.run.createdAt ?? new Date().toISOString();
  return {
    run_id: detail.run.runId,
    repository_id: repoId,
    repository_owner: repoInfo?.repository_owner ?? "repository",
    repository_name:
      repoInfo?.repository_name ?? (repoId ? `repo-${repoId}` : "unknown"),
    pr_key: detail.run.prKey,
    pr_number: prNumber,
    head_sha: detail.run.headSha,
    terminal_state: detail.run.terminalState ?? null,
    verdict: detail.run.verdict ?? null,
    scope_status: detail.run.scopeStatus ?? null,
    review_phase_reached:
      detail.run.runState === "publishing" ? "publishing" : "analysis_started",
    review_admission_wait_ms: 0,
    execution_duration_ms: 0,
    input_tokens: detail.run.tokens?.inputTokens ?? 0,
    output_tokens: detail.run.tokens?.outputTokens ?? 0,
    reasoning_tokens: detail.run.tokens?.reasoningTokens ?? null,
    tool_calls_count: detail.run.toolCallsCount ?? 0,
    estimated_cost_micro_usd: detail.run.cost?.estimatedCostMicroUsd ?? 0,
    pricing_model: detail.run.cost?.pricingModel ?? "standard",
    shards_count: detail.run.shardsCount ?? 1,
    is_degraded: detail.run.isDegraded ? 1 : 0,
    webhook_received_at: createdAt,
    workflow_started_at: createdAt,
    analysis_started_at: createdAt,
    terminal_at: createdAt,
    terminal_at_epoch_ms: Date.now(),
    projection_requested_at: createdAt,
    projected_at: createdAt,
    projected_at_epoch_ms: Date.now(),
    projection_delivery_lag_ms: 0,
    schema_version: 3,
    record_version: 1,
    payload_hash: "",
    source_event_id: `synthetic:${detail.run.runId}`,
  };
}

export async function loader({ params, context }: LoaderFunctionArgs) {
  const parsedRunId = runIdSchema.safeParse(params.runId);
  if (!parsedRunId.success) throw data("Invalid run ID", { status: 400 });
  const { env, identity } = context.get(adminRequestContext);
  const storage = new D1AdminStorage(env.DB);
  let run = await storage.getRunById(parsedRunId.data);

  let rpcDetail: AdminRunDetailV3 | null = null;
  let rpcError: string | null = null;
  const rpc = env.ADMIN_READ_API as unknown as AdminReadRpcClient | undefined;

  if (!rpc) {
    rpcError = "Control plane RPC binding not configured";
  } else if (!rpc.getRunDetailV3) {
    rpcError = "RPC getRunDetailV3 contract unavailable";
  } else {
    try {
      const candidate = await Promise.race([
        rpc.getRunDetailV3({ runId: parsedRunId.data }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 5_000),
        ),
      ]);
      rpcDetail = parseRpcRunDetail(candidate);
    } catch {
      rpcError = "RPC drill-down unavailable";
    }
  }

  if (!run) {
    if (rpcDetail?.run && rpcDetail.run.runId === parsedRunId.data) {
      const prParts = rpcDetail.run.prKey.split(":");
      const repoId = Number(prParts[1]) || 0;
      let repoInfo: {
        repository_owner: string;
        repository_name: string;
      } | null = null;
      if (repoId) {
        const repoRow = await env.DB.prepare(
          "SELECT repository_owner, repository_name FROM admin_runs WHERE repository_id = ? LIMIT 1",
        )
          .bind(repoId)
          .first<{ repository_owner: string; repository_name: string }>();
        repoInfo = repoRow ?? null;
      }
      run = createSyntheticAdminRunRow(rpcDetail, repoInfo);
    } else {
      throw data("Run not found", { status: 404 });
    }
  }

  const runState = rpcDetail?.run?.runState;
  const isActive =
    run.terminal_state === null ||
    runState === "running" ||
    runState === "publishing";

  return { isActive, rpcDetail, rpcError, run, userEmail: identity.email };
}

export function setupAutoPolling(
  isActive: boolean,
  revalidator: { state: string; revalidate: () => void },
  intervalMs = 3000,
): () => void {
  if (!isActive) {
    return () => {};
  }

  const tick = () => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      revalidator.state === "idle"
    ) {
      revalidator.revalidate();
    }
  };

  const timer = setInterval(tick, intervalMs);

  const onVisibilityChange = () => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      revalidator.state === "idle"
    ) {
      revalidator.revalidate();
    }
  };

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  return () => {
    clearInterval(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

export function createRevalidatorProxy(ref: {
  readonly current: { readonly state: string; revalidate(): void };
}): { readonly state: string; revalidate(): void } {
  return {
    get state() {
      return ref.current.state;
    },
    revalidate: () => ref.current.revalidate(),
  };
}

export default function RunDetailRoute() {
  const loaderData = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const revalidatorRef = React.useRef(revalidator);
  revalidatorRef.current = revalidator;

  React.useEffect(() => {
    const proxy = createRevalidatorProxy(revalidatorRef);
    return setupAutoPolling(loaderData.isActive, proxy);
  }, [loaderData.isActive]);

  return <RunDetailView {...loaderData} embedded />;
}
