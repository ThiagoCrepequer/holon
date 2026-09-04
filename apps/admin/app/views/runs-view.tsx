import {
  Badge,
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
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight text-zinc-950">
          Review Runs
        </h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Search and inspect individual execution runs and their deterministic
          projections
        </p>
      </div>

      {/* Filter and Search Bar */}
      <Card className="mb-6">
        <CardContent className="p-5">
          <form
            method="GET"
            action="/runs"
            className="flex flex-col md:flex-row gap-3.5 items-end"
          >
            {/* Structured Search */}
            <div className="flex-1 w-full">
              <label
                htmlFor="search-input"
                className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1"
              >
                Search
              </label>
              <input
                id="search-input"
                name="q"
                defaultValue={searchQuery}
                placeholder="Search owner/repo#123, SHA, or run_id..."
                className="w-full h-9 px-3 text-xs bg-white border border-zinc-200 rounded-lg shadow-xs hover:border-zinc-300 outline-none focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900/10 font-mono transition-colors"
              />
            </div>

            <div className="w-full md:w-36">
              <label
                htmlFor="repository-id"
                className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1"
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
                className="w-full h-9 px-3 text-xs bg-white border border-zinc-200 rounded-lg shadow-xs hover:border-zinc-300 outline-none focus:outline-none focus:border-zinc-900 focus:ring-1 focus:ring-zinc-900/10 transition-colors"
              />
            </div>

            {/* Verdict Filter */}
            <div className="w-full md:w-40">
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
            <div className="w-full md:w-40">
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
            <div className="w-full md:w-36">
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
              <button
                type="submit"
                className="h-9 px-4 text-xs font-semibold bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors shadow-xs shrink-0"
              >
                Filter
              </button>
              {hasActiveFilters && (
                <Link
                  to="/runs"
                  className="h-9 px-3 inline-flex items-center text-xs font-medium text-zinc-600 hover:text-zinc-950 underline underline-offset-2 shrink-0"
                >
                  Clear
                </Link>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Runs Table */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle>
            Runs Listing
            <span className="ml-2 text-xs font-normal text-zinc-500 font-mono">
              ({runs.length} displayed)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="py-12">
              <EmptyState
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
                      className="px-3 py-1.5 text-xs font-medium bg-zinc-100 text-zinc-900 rounded-md hover:bg-zinc-200 transition-colors"
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
                        <div className="font-medium text-zinc-900">
                          {run.repository_owner}/{run.repository_name}#
                          {run.pr_number}
                        </div>
                        <div className="font-mono text-[11px] text-zinc-400">
                          {run.head_sha.slice(0, 7)}
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
                      <TableCell className="text-xs text-zinc-600 font-mono">
                        {run.scope_status ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {run.execution_duration_ms
                          ? `${(run.execution_duration_ms / 1000).toFixed(1)}s`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-zinc-500 font-mono">
                        {formatTableDateTimeUtc(run.terminal_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          to={`/runs/${encodeURIComponent(run.run_id)}`}
                          className="text-xs font-semibold text-zinc-900 hover:text-zinc-700 underline underline-offset-2"
                        >
                          Inspect &rarr;
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Keyset Pagination Controls */}
              {nextCursor && (
                <div className="mt-4 pt-4 border-t border-zinc-100 flex items-center justify-end">
                  <Link
                    to={`/runs?period=${encodeURIComponent(period)}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}${verdict ? `&verdict=${encodeURIComponent(verdict)}` : ""}${terminalState ? `&state=${encodeURIComponent(terminalState)}` : ""}${repositoryId ? `&repositoryId=${repositoryId}` : ""}&order=${order}&pageSize=${pageSize}&cursor=${encodeURIComponent(nextCursor)}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-zinc-900 text-white rounded-md hover:bg-zinc-800 transition-colors shadow-xs"
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
