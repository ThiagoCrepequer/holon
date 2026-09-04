import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@holon/ui";
import * as React from "react";

import type { AdminRunRow } from "../../workers/types.js";
import { Layout } from "../components/layout.js";

export interface RunsViewProps {
  readonly userEmail?: string | undefined;
  readonly runs: AdminRunRow[];
  readonly nextCursor?: string | null | undefined;
  readonly currentCursor?: string | null | undefined;
  readonly searchQuery?: string | undefined;
  readonly period?: string | undefined;
  readonly terminalState?: string | undefined;
  readonly verdict?: string | undefined;
}

export const RunsView: React.FC<RunsViewProps> = ({
  userEmail,
  runs,
  nextCursor,
  searchQuery = "",
  period = "24h",
  terminalState = "",
  verdict = "",
}) => {
  const hasActiveFilters =
    searchQuery !== "" || terminalState !== "" || verdict !== "";

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
        <CardContent className="pt-5">
          <form
            method="GET"
            action="/runs"
            className="flex flex-col md:flex-row gap-3"
          >
            {/* Structured Search */}
            <div className="flex-1">
              <label
                htmlFor="search-input"
                className="block text-[11px] font-semibold text-zinc-600 mb-1"
              >
                SEARCH
              </label>
              <input
                id="search-input"
                name="q"
                defaultValue={searchQuery}
                placeholder="Search owner/repo#123, 40-char SHA, or run_id..."
                className="w-full h-8 px-3 text-xs bg-white border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-950 font-mono"
              />
            </div>

            {/* Verdict Filter */}
            <div className="w-full md:w-40">
              <label
                htmlFor="verdict-select"
                className="block text-[11px] font-semibold text-zinc-600 mb-1"
              >
                VERDICT
              </label>
              <select
                id="verdict-select"
                name="verdict"
                defaultValue={verdict}
                className="w-full h-8 px-2.5 text-xs bg-white border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-950"
              >
                <option value="">All Verdicts</option>
                <option value="APPROVE">Approve</option>
                <option value="REQUEST_CHANGES">Request Changes</option>
                <option value="COMMENT">Comment</option>
              </select>
            </div>

            {/* Terminal State Filter */}
            <div className="w-full md:w-40">
              <label
                htmlFor="state-select"
                className="block text-[11px] font-semibold text-zinc-600 mb-1"
              >
                STATE
              </label>
              <select
                id="state-select"
                name="state"
                defaultValue={terminalState}
                className="w-full h-8 px-2.5 text-xs bg-white border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-950"
              >
                <option value="">All States</option>
                <option value="completed">Completed</option>
                <option value="failed_terminal">Failed Terminal</option>
                <option value="obsolete">Obsolete</option>
              </select>
            </div>

            {/* Period Filter */}
            <div className="w-full md:w-32">
              <label
                htmlFor="period-select"
                className="block text-[11px] font-semibold text-zinc-600 mb-1"
              >
                PERIOD
              </label>
              <select
                id="period-select"
                name="period"
                defaultValue={period}
                className="w-full h-8 px-2.5 text-xs bg-white border border-zinc-300 rounded-md focus:outline-none focus:ring-2 focus:ring-zinc-950"
              >
                <option value="24h">Last 24h</option>
                <option value="7d">Last 7d</option>
                <option value="30d">Last 30d</option>
              </select>
            </div>

            {/* Submit & Reset */}
            <div className="flex items-end gap-2">
              <button
                type="submit"
                className="h-8 px-4 text-xs font-medium bg-zinc-900 text-white rounded-md hover:bg-zinc-800 transition-colors"
              >
                Filter
              </button>
              {hasActiveFilters && (
                <a
                  href="/runs"
                  className="h-8 px-3 inline-flex items-center text-xs font-medium text-zinc-600 hover:text-zinc-950 underline"
                >
                  Clear
                </a>
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
                    <a
                      href="/runs"
                      className="px-3 py-1.5 text-xs font-medium bg-zinc-100 text-zinc-900 rounded-md hover:bg-zinc-200 transition-colors"
                    >
                      Reset all filters
                    </a>
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
                      <TableCell className="text-xs text-zinc-500">
                        {new Date(run.terminal_at).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <a
                          href={`/runs/${encodeURIComponent(run.run_id)}`}
                          className="text-xs font-semibold text-zinc-900 hover:text-zinc-700 underline underline-offset-2"
                        >
                          Inspect &rarr;
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Keyset Pagination Controls */}
              {nextCursor && (
                <div className="mt-4 pt-4 border-t border-zinc-100 flex items-center justify-end">
                  <a
                    href={`/runs?period=${encodeURIComponent(period)}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}${verdict ? `&verdict=${encodeURIComponent(verdict)}` : ""}${terminalState ? `&state=${encodeURIComponent(terminalState)}` : ""}&cursor=${encodeURIComponent(nextCursor)}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-zinc-900 text-white rounded-md hover:bg-zinc-800 transition-colors shadow-xs"
                  >
                    Next Page &rarr;
                  </a>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </Layout>
  );
};
