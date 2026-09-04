import type { AdminRunDetailV1 } from "@holon/contracts";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerHeader,
  DrawerPopup,
  DrawerTitle,
} from "@holon/ui";
import * as React from "react";
import { Link, useNavigate } from "react-router";

import type { AdminRunRow } from "../../workers/types.js";
import { Layout } from "../components/layout.js";
import { useHydrated } from "../hooks/use-hydrated.js";
import { formatNumber } from "../utils/format.js";

export interface RunDetailViewProps {
  readonly userEmail?: string | undefined;
  readonly run: AdminRunRow;
  readonly rpcDetail: AdminRunDetailV1 | null;
  readonly rpcError?: string | null | undefined;
  readonly embedded?: boolean | undefined;
}

export const RunDetailView: React.FC<RunDetailViewProps> = ({
  userEmail,
  run,
  rpcDetail,
  rpcError,
  embedded = false,
}) => {
  const navigate = useNavigate();
  const hydrated = useHydrated();
  const content = (
    <>
      {/* Breadcrumb */}
      <nav
        className="mb-4 text-xs text-[var(--text-muted)] flex items-center gap-1.5"
        aria-label="Breadcrumb"
      >
        <Link
          to="/runs"
          className="hover:text-[var(--text-primary)] underline underline-offset-2"
        >
          Runs
        </Link>
        <span>/</span>
        <span className="font-mono text-[var(--text-secondary)] truncate max-w-sm">
          {run.run_id}
        </span>
      </nav>

      {/* Header Card */}
      <Card className="section-gap">
        <CardHeader className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-semibold text-[var(--text-primary)] break-words">
                {run.repository_owner}/{run.repository_name} #{run.pr_number}
              </h1>
              <Badge
                variant={
                  run.verdict === "APPROVE"
                    ? "success"
                    : run.verdict === "REQUEST_CHANGES"
                      ? "danger"
                      : run.verdict === "COMMENT"
                        ? "info"
                        : "neutral"
                }
                size="sm"
              >
                {run.verdict ?? "UNSPECIFIED"}
              </Badge>
              <Badge
                variant={
                  run.terminal_state === "completed" ? "success" : "neutral"
                }
                size="sm"
                dot
              >
                {run.terminal_state}
              </Badge>
            </div>
            <CardDescription className="font-mono text-xs text-[var(--text-muted)] mt-1 break-all">
              Commit SHA: {run.head_sha} &bull; Run ID: {run.run_id}
            </CardDescription>
          </div>

          <Link
            to="/runs"
            className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] bg-[var(--surface-hover)] hover:bg-[var(--surface-subtle)] rounded-md transition-colors shrink-0"
          >
            &larr; Back to list
          </Link>
        </CardHeader>
      </Card>

      {/* RPC Warning Banner if RPC timed out or degraded */}
      {rpcError && (
        <div
          role="alert"
          className="operational-notice is-degraded flex-wrap text-xs"
        >
          <span className="font-semibold">RPC Drill-down degraded:</span>
          <span>
            {rpcError}. Displaying cached projection data from D1 ledger.
          </span>
        </div>
      )}

      {/* Execution Telemetry Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-[var(--text-primary)] tracking-tight">
              {run.execution_duration_ms
                ? `${(run.execution_duration_ms / 1000).toFixed(2)}s`
                : "—"}
            </div>
            <div className="text-xs text-[var(--text-disabled)] mt-1">
              Queue wait:{" "}
              {run.review_admission_wait_ms
                ? `${run.review_admission_wait_ms}ms`
                : "0ms"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Total Tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-[var(--text-primary)] tracking-tight">
              {formatNumber((run.input_tokens ?? 0) + (run.output_tokens ?? 0))}
            </div>
            <div className="text-xs text-[var(--text-disabled)] mt-1">
              In: {formatNumber(run.input_tokens)} &bull; Out:{" "}
              {formatNumber(run.output_tokens)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Cost (USD)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-[var(--text-primary)] tracking-tight">
              ${((run.estimated_cost_micro_usd ?? 0) / 1000000).toFixed(4)}
            </div>
            <div className="text-xs text-[var(--text-disabled)] mt-1 font-mono truncate">
              {run.pricing_model ?? "standard"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
              Scope & Shards
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-[var(--text-primary)] tracking-tight">
              {run.scope_status ?? "complete"}
            </div>
            <div className="text-xs text-[var(--text-disabled)] mt-1">
              {run.shards_count ?? 1} shard(s) evaluated
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Findings Section */}
      <Card className="section-gap">
        <CardHeader className="pb-3">
          <CardTitle>
            Findings & Diagnostics
            <span className="ml-2 text-xs font-normal text-[var(--text-muted)] font-mono">
              ({rpcDetail ? rpcDetail.currentFindings.length : 0} items)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!rpcDetail || rpcDetail.currentFindings.length === 0 ? (
            <div className="py-8">
              <EmptyState
                title="No findings emitted"
                description="This review run did not produce any actionable diagnostic findings."
              />
            </div>
          ) : (
            <div className="space-y-4">
              {rpcDetail.currentFindings.map((f) => (
                <div
                  key={f.fingerprint}
                  className="p-4 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]/50 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          f.severity === "critical"
                            ? "danger"
                            : f.severity === "high"
                              ? "warning"
                              : "neutral"
                        }
                        size="sm"
                      >
                        {f.severity.toUpperCase()}
                      </Badge>
                      <span className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                        {f.filePath}:{f.line}
                      </span>
                    </div>
                    <Badge variant="info" size="sm">
                      {f.status}
                    </Badge>
                  </div>

                  <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                    {f.diagnostic}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Structured CI Evidence (if available via RPC) */}
      {rpcDetail?.structuredCi && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Continuous Integration Evidence</CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">Status:</span>
              <Badge
                variant={
                  rpcDetail.structuredCi.status === "available"
                    ? "success"
                    : "neutral"
                }
                size="sm"
              >
                {rpcDetail.structuredCi.status}
              </Badge>
            </div>
            {rpcDetail.structuredCi.workflowName && (
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">Workflow:</span>
                <span className="font-medium text-[var(--text-primary)]">
                  {rpcDetail.structuredCi.workflowName}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)]">
                Jobs (Passed / Failed / Total):
              </span>
              <span className="font-mono font-medium">
                {rpcDetail.structuredCi.passed} /{" "}
                {rpcDetail.structuredCi.failed} / {rpcDetail.structuredCi.total}
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
  if (embedded && hydrated) {
    return (
      <Drawer open onOpenChange={(open) => !open && navigate("/runs")}>
        <DrawerPopup>
          <DrawerHeader>
            <DrawerTitle>Run detail</DrawerTitle>
            <DrawerClose className="rounded-md px-2 py-1 text-xs hover:bg-[var(--surface-hover)]">
              Close
            </DrawerClose>
          </DrawerHeader>
          <DrawerBody>{content}</DrawerBody>
        </DrawerPopup>
      </Drawer>
    );
  }
  if (embedded) return <section className="mt-6">{content}</section>;
  return (
    <Layout
      userEmail={userEmail}
      currentPath={`/runs/${encodeURIComponent(run.run_id)}`}
    >
      {content}
    </Layout>
  );
};
