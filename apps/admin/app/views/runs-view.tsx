import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  SelectField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@holon/ui";
import * as React from "react";
import { Link } from "react-router";

import type { AdminRunRow } from "../../workers/types.js";
import { Layout } from "../components/layout.js";
import { PageHeader } from "../components/page-header.js";
import { formatTableDateTimeUtc } from "../utils/format.js";

export interface RunsViewProps {
  readonly userEmail?: string | undefined;
  readonly runs: AdminRunRow[];
  readonly nextCursor?: string | null | undefined;
  readonly currentCursor?: string | null | undefined;
  readonly searchQuery?: string | undefined;
  readonly period?: string | undefined;
  readonly terminalState?: string | undefined;
  readonly verdict?: string | undefined;
  readonly repositoryId?: number | undefined;
  readonly order?: "asc" | "desc" | undefined;
  readonly pageSize?: 20 | 50 | 100 | undefined;
}

export const RunsView: React.FC<RunsViewProps> = ({
  userEmail,
  runs,
  nextCursor,
  searchQuery = "",
  period = "24h",
  terminalState = "",
  verdict = "",
  repositoryId,
  order = "desc",
  pageSize = 50,
}) => {
  const hasActiveFilters =
    searchQuery !== "" ||
    terminalState !== "" ||
    verdict !== "" ||
    repositoryId !== undefined;

  return (
    <Layout userEmail={userEmail} currentPath="/runs">
      {/* Page Title */}
      <PageHeader
        title="Review Runs"
        description="Find a review by repository, pull request or commit."
      />

      {/* Filter and Search Bar */}
      <Card className="console-panel section-gap">
        <CardContent className="p-5">
          <form method="GET" action="/runs" className="runs-filter-grid">
            {/* Structured Search */}
            <div className="filter-search min-w-0 w-full">
              <label
                htmlFor="search-input"
                className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1"
              >
                Search
              </label>
              <input
                id="search-input"
                name="q"
                defaultValue={searchQuery}
                placeholder="Search owner/repo#123, SHA, or run_id..."
                className="w-full h-9 px-3 text-xs bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xs hover:border-[var(--border-strong)] outline-none focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] font-mono transition-colors"
              />
            </div>

            <div className="min-w-0 w-full">
              <label
                htmlFor="repository-id"
                className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1"
              >
                Repository ID
              </label>
              <input
                id="repository-id"
                name="repositoryId"
                type="number"
                min="1"
                defaultValue={repositoryId}
                placeholder="e.g. 42"
                className="w-full h-9 px-3 text-xs bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-xs hover:border-[var(--border-strong)] outline-none focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition-colors"
              />
            </div>

            {/* Verdict Filter */}
            <div className="min-w-0 w-full">
              <SelectField
                id="verdict-select"
                name="verdict"
                label="VERDICT"
                defaultValue={verdict}
                options={[
                  { value: "", label: "All Verdicts" },
                  { value: "APPROVE", label: "Approve" },
                  { value: "REQUEST_CHANGES", label: "Request Changes" },
                  { value: "COMMENT", label: "Comment" },
                ]}
              />
            </div>

            <input type="hidden" name="order" value={order} />
            <input type="hidden" name="pageSize" value={pageSize} />

            {/* Terminal State Filter */}
            <div className="min-w-0 w-full">
              <SelectField
                id="state-select"
                name="state"
                label="STATE"
                defaultValue={terminalState}
                options={[
                  { value: "", label: "All States" },
                  { value: "completed", label: "Completed" },
                  { value: "failed_terminal", label: "Failed Terminal" },
                  { value: "obsolete", label: "Obsolete" },
                ]}
              />
            </div>

            {/* Period Filter */}
            <div className="min-w-0 w-full">
              <SelectField
                id="period-select"
                name="period"
                label="PERIOD"
                defaultValue={period}
                options={[
                  { value: "24h", label: "Last 24h" },
                  { value: "7d", label: "Last 7d" },
                  { value: "30d", label: "Last 30d" },
                ]}
              />
            </div>

            {/* Submit & Reset */}
            <div className="flex items-center gap-2 pb-[1px] w-full md:w-auto">
              <Button type="submit" className="text-xs shrink-0">
                Filter
              </Button>
              {hasActiveFilters && (
                <Link
                  to="/runs"
                  className="h-9 px-3 inline-flex items-center text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline underline-offset-2 shrink-0"
                >
                  Clear
                </Link>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Runs Table */}
      <Card className="console-panel">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle>
            Runs Listing
            <span className="ml-2 text-xs font-normal text-[var(--text-muted)] font-mono">
              ({runs.length} displayed)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 border-t border-[var(--border)] overflow-hidden rounded-b-xl">
          {runs.length === 0 ? (
            <div className="runs-empty">
              <EmptyState
                className="console-empty-state"
                title={
                  hasActiveFilters
                    ? "No matching runs found"
                    : "No runs in this time window"
                }
                description={
                  hasActiveFilters
                    ? "Try adjusting your search query, state, or verdict filters."
                    : "No review projections have been recorded for the selected time period."
                }
                action={
                  hasActiveFilters ? (
                    <Link
                      to="/runs"
                      className="px-3 py-1.5 text-xs font-medium bg-[var(--surface-hover)] text-[var(--text-primary)] rounded-md hover:bg-[var(--surface-subtle)] transition-colors"
                    >
                      Reset all filters
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Repository / PR</TableHead>
                    <TableHead>Verdict</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Finished</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.run_id}>
                      <TableCell>
                        <div className="font-medium text-[var(--text-primary)]">
                          {run.repository_owner}/{run.repository_name}#
                          {run.pr_number}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="font-mono text-[11px] text-[var(--text-muted)] bg-[var(--surface-hover)] px-1.5 py-0.5 rounded border border-[var(--border)]/60">
                            {run.head_sha.slice(0, 7)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
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
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            run.terminal_state === "completed"
                              ? "success"
                              : run.terminal_state === "failed_terminal"
                                ? "danger"
                                : "neutral"
                          }
                          size="sm"
                        >
                          {run.terminal_state}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-[var(--text-secondary)] font-mono">
                        {run.scope_status ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {run.execution_duration_ms
                          ? `${(run.execution_duration_ms / 1000).toFixed(1)}s`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-[var(--text-muted)] font-mono">
                        {formatTableDateTimeUtc(run.terminal_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          to={`/runs/${encodeURIComponent(run.run_id)}`}
                          className="inline-flex items-center px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] bg-[var(--surface-hover)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)] rounded-md transition-colors shadow-2xs"
                        >
                          Inspect
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Keyset Pagination Controls */}
              {nextCursor && (
                <div className="p-4 border-t border-[var(--border)] flex items-center justify-end bg-[var(--surface-muted)]/50">
                  <Link
                    to={`/runs?period=${encodeURIComponent(period)}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}${verdict ? `&verdict=${encodeURIComponent(verdict)}` : ""}${terminalState ? `&state=${encodeURIComponent(terminalState)}` : ""}${repositoryId ? `&repositoryId=${repositoryId}` : ""}&order=${order}&pageSize=${pageSize}&cursor=${encodeURIComponent(nextCursor)}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[var(--accent)] text-white rounded-md hover:bg-[var(--accent-hover)] transition-colors shadow-xs"
                  >
                    Next Page &rarr;
                  </Link>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </Layout>
  );
};
