import type {
  AdminRunDetailV2,
  AdminRunDetailV3,
  StepExecutionNode,
} from "@holon/contracts";
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
import { ProjectVersions } from "../components/project-versions.js";
import {
  StepInspectorDrawer,
  WorkflowCanvas,
} from "../components/workflow-canvas/index.js";
import { useHydrated } from "../hooks/use-hydrated.js";
import { formatNumber } from "../utils/format.js";

export interface RunDetailViewProps {
  readonly userEmail?: string | undefined;
  readonly run: AdminRunRow;
  readonly rpcDetail: AdminRunDetailV3 | AdminRunDetailV2 | null;
  readonly rpcError?: string | null | undefined;
  readonly embedded?: boolean | undefined;
  readonly isActive?: boolean | undefined;
  readonly initialSelectedStepName?: string | null | undefined;
}

export function handleCloseComplete(
  isOpen: boolean,
  navigate: (to: string) => void | Promise<void>,
): void {
  if (!isOpen) {
    void navigate("/runs");
  }
}

export const RunDetailView: React.FC<RunDetailViewProps> = ({
  userEmail,
  run,
  rpcDetail,
  rpcError,
  embedded = false,
  isActive: _isActive,
  initialSelectedStepName,
}) => {
  const navigate = useNavigate();
  const hydrated = useHydrated();
  const [open, setOpen] = React.useState(false);
  const [selectedStepName, setSelectedStepName] = React.useState<string | null>(
    initialSelectedStepName ?? null,
  );

  const stepExecutions: readonly StepExecutionNode[] = React.useMemo(() => {
    if (!rpcDetail) return [];
    if (
      "stepExecutions" in rpcDetail &&
      Array.isArray(rpcDetail.stepExecutions)
    ) {
      return rpcDetail.stepExecutions;
    }
    return [];
  }, [rpcDetail]);

  const selectedStep = React.useMemo(() => {
    if (!selectedStepName) return null;
    return stepExecutions.find((s) => s.stepName === selectedStepName) ?? null;
  }, [selectedStepName, stepExecutions]);

  const historicalFindings = React.useMemo(() => {
    if (
      rpcDetail &&
      "historicalRunFindings" in rpcDetail &&
      Array.isArray(rpcDetail.historicalRunFindings)
    ) {
      return rpcDetail.historicalRunFindings;
    }
    return null;
  }, [rpcDetail]);

  const currentFindings = React.useMemo(() => {
    return rpcDetail?.currentFindings ?? [];
  }, [rpcDetail]);

  const [findingsTab, setFindingsTab] = React.useState<"snapshot" | "current">(
    () => (historicalFindings !== null ? "snapshot" : "current"),
  );

  React.useEffect(() => {
    if (historicalFindings === null && findingsTab === "snapshot") {
      setFindingsTab("current");
    }
  }, [historicalFindings, findingsTab]);

  const activeFindings =
    findingsTab === "snapshot" && historicalFindings !== null
      ? historicalFindings
      : currentFindings;
  React.useEffect(() => {
    if (embedded) setOpen(true);
  }, [embedded]);
  const closeFromLink = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      !embedded ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    setOpen(false);
  };
  const content = (
    <>
      {/* Breadcrumb */}
      <nav
        className="mb-4 text-xs text-[var(--text-muted)] flex items-center gap-1.5"
        aria-label="Breadcrumb"
      >
        <Link
          to="/runs"
          onClick={closeFromLink}
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
                {`${run.repository_owner}/${run.repository_name} #${run.pr_number}`}
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
                  run.terminal_state === "completed"
                    ? "success"
                    : run.terminal_state === "failed_terminal"
                      ? "danger"
                      : run.terminal_state === null
                        ? "info"
                        : "neutral"
                }
                size="sm"
                dot
              >
                {run.terminal_state ??
                  (rpcDetail &&
                  "run" in rpcDetail &&
                  "runState" in rpcDetail.run
                    ? rpcDetail.run.runState
                    : "running")}
              </Badge>
            </div>
            <CardDescription className="font-mono text-xs text-[var(--text-muted)] mt-1 break-all">
              Commit SHA: {run.head_sha} &bull; Run ID: {run.run_id}
            </CardDescription>
          </div>

          <Link
            to="/runs"
            onClick={closeFromLink}
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

      {/* Workflow Execution DAG & Telemetry Preview */}
      <div className="section-gap mb-4">
        <div className="flex flex-col xl:flex-row gap-4 items-start">
          <div className="flex-1 min-w-0 w-full">
            <WorkflowCanvas
              stepExecutions={stepExecutions}
              selectedStepName={selectedStepName}
              onSelectStep={setSelectedStepName}
            />
          </div>
          {selectedStep && (
            <div className="w-full xl:w-96 shrink-0 h-[480px]">
              <StepInspectorDrawer
                step={selectedStep}
                onClose={() => setSelectedStepName(null)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Sandbox Cleanup Task Notification (if available) */}
      {rpcDetail && "cleanupTask" in rpcDetail && rpcDetail.cleanupTask && (
        <div className="mb-4 p-3 bg-purple-950/20 border border-purple-800/40 rounded-lg flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-purple-400">⏰</span>
            <span className="font-semibold text-purple-300">
              Sandbox Cleanup Task:
            </span>
            <Badge
              variant={
                rpcDetail.cleanupTask.state === "completed"
                  ? "success"
                  : "neutral"
              }
              size="sm"
            >
              {rpcDetail.cleanupTask.state}
            </Badge>
          </div>
          <span className="text-slate-400 font-mono text-[11px]">
            Tentativas: {rpcDetail.cleanupTask.attempts} &bull; Solicitado em:{" "}
            {rpcDetail.cleanupTask.requestedAt}
          </span>
        </div>
      )}

      <ProjectVersions result={rpcDetail?.projectIdentification} />

      {/* Findings Section */}
      <Card className="section-gap">
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <CardTitle>
              Findings & Diagnostics
              <span className="ml-2 text-xs font-normal text-[var(--text-muted)] font-mono">
                ({activeFindings.length} items)
              </span>
            </CardTitle>

            {/* Findings Perspective Tabs */}
            <div className="flex items-center gap-1.5 p-1 bg-[var(--surface-muted)] rounded-lg text-xs font-medium">
              {historicalFindings !== null ? (
                <button
                  type="button"
                  data-testid="tab-findings-snapshot"
                  onClick={() => setFindingsTab("snapshot")}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    findingsTab === "snapshot"
                      ? "bg-[var(--surface-hover)] text-[var(--text-primary)] shadow-xs font-semibold"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  Achados desta Execução (Snapshot) ({historicalFindings.length}
                  )
                </button>
              ) : (
                <span className="px-2.5 py-1 text-[11px] text-[var(--text-muted)] italic">
                  Snapshot da execução indisponível
                </span>
              )}
              <button
                type="button"
                data-testid="tab-findings-current"
                onClick={() => setFindingsTab("current")}
                className={`px-2.5 py-1 rounded transition-colors ${
                  findingsTab === "current"
                    ? "bg-[var(--surface-hover)] text-[var(--text-primary)] shadow-xs font-semibold"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Estado Atual no PR ({currentFindings.length})
              </button>
            </div>
          </div>
          <CardDescription className="text-xs text-[var(--text-muted)] mt-1">
            {findingsTab === "snapshot" && historicalFindings !== null
              ? "Achados capturados no momento em que esta execução foi analisada."
              : "Estado atual dos achados no PR (inclui resoluções ou novos achados de runs subsequentes)."}
            {rpcDetail && "findingsPerspective" in rpcDetail && (
              <span className="ml-2 font-mono text-[11px] text-[var(--text-muted)]">
                &bull; Perspectiva: {rpcDetail.findingsPerspective}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!rpcDetail || activeFindings.length === 0 ? (
            <div className="py-8">
              <EmptyState
                title="No findings emitted"
                description={
                  findingsTab === "snapshot"
                    ? "Esta execução específica não produziu achados diagnósticos acionáveis."
                    : "Não há achados ativos atualmente no pull request."
                }
              />
            </div>
          ) : (
            <div className="space-y-4">
              {activeFindings.map((f) => (
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
      <Drawer
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(isOpen) => handleCloseComplete(isOpen, navigate)}
      >
        <DrawerPopup className="w-full max-w-6xl">
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
