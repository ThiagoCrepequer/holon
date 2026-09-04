import * as React from "react";

import { cn } from "../../utils/cn.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../card/card.js";
import { EmptyState } from "../empty-state/empty-state.js";

export interface ChartFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  insight?: React.ReactNode;
  accessibleTable?: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyMessage?: string;
  height?: number | string;
  showTable?: boolean;
  onToggleTable?: () => void;
}

export const ChartFrame = React.forwardRef<HTMLDivElement, ChartFrameProps>(
  (
    {
      title,
      description,
      insight,
      accessibleTable,
      loading = false,
      empty = false,
      emptyMessage = "No chart data available for the selected period",
      height = 240,
      showTable = false,
      onToggleTable,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const chartId = React.useId();
    const titleId = `${chartId}-title`;
    const descId = `${chartId}-desc`;

    return (
      <Card ref={ref} className={cn("flex flex-col", className)} {...props}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle id={titleId}>{title}</CardTitle>
              {description && (
                <CardDescription id={descId} className="mt-1">
                  {description}
                </CardDescription>
              )}
            </div>
            {accessibleTable && onToggleTable && (
              <button
                type="button"
                onClick={onToggleTable}
                className="text-xs font-medium text-zinc-600 hover:text-zinc-900 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 rounded px-1"
                aria-expanded={showTable}
              >
                {showTable ? "View chart" : "View data table"}
              </button>
            )}
          </div>
          {insight && (
            <div className="mt-2 text-xs font-medium text-zinc-700 bg-zinc-50 border border-zinc-200 rounded px-2.5 py-1.5">
              {insight}
            </div>
          )}
        </CardHeader>

        <CardContent className="flex-1 flex flex-col justify-center">
          {loading ? (
            <div
              style={{ height }}
              aria-hidden="true"
              className="w-full bg-zinc-100 animate-pulse rounded-md flex items-center justify-center text-xs text-zinc-400"
            >
              Loading chart...
            </div>
          ) : empty ? (
            <div
              style={{ minHeight: height }}
              className="flex items-center justify-center"
            >
              <EmptyState
                title="No data"
                description={emptyMessage}
                className="border-0 bg-transparent"
              />
            </div>
          ) : showTable && accessibleTable ? (
            <div style={{ minHeight: height }} className="overflow-auto py-2">
              {accessibleTable}
            </div>
          ) : (
            <div
              style={{ height }}
              role="region"
              aria-labelledby={titleId}
              aria-describedby={description ? descId : undefined}
              className="w-full"
            >
              {children}
            </div>
          )}
        </CardContent>
      </Card>
    );
  },
);

ChartFrame.displayName = "ChartFrame";
