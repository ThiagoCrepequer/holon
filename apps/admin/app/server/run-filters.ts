import { adminRunsFilterParamsSchema } from "@holon/contracts";

export interface ParsedRunFilters {
  readonly cursor?: string | undefined;
  readonly order: "asc" | "desc";
  readonly pageSize: 20 | 50 | 100;
  readonly period: "24h" | "7d" | "30d";
  readonly repositoryId?: number | undefined;
  readonly searchQuery?: string | undefined;
  readonly terminalState?:
    | "completed"
    | "failed_terminal"
    | "obsolete"
    | undefined;
  readonly verdict?: "APPROVE" | "REQUEST_CHANGES" | "COMMENT" | undefined;
}

export function parseRunFilters(
  searchParams: URLSearchParams,
): ParsedRunFilters {
  const raw: Record<string, unknown> = {};
  const copy = (target: string, source = target) => {
    const value = searchParams.get(source);
    if (value !== null && value !== "") raw[target] = value;
  };
  copy("period");
  copy("order");
  copy("terminalState", "state");
  copy("verdict");
  copy("searchQuery", "q");

  const pageSize = searchParams.get("pageSize");
  if (pageSize !== null && pageSize !== "") raw.pageSize = Number(pageSize);
  const repositoryId = searchParams.get("repositoryId");
  if (repositoryId !== null && repositoryId !== "") {
    raw.repositoryId = Number(repositoryId);
  }

  const filters = adminRunsFilterParamsSchema.parse(raw);
  const cursor = searchParams.get("cursor")?.trim();
  if (cursor !== undefined && cursor.length > 4096) {
    throw new Error("Invalid run filters");
  }
  return { ...filters, cursor: cursor || undefined };
}
