import * as React from "react";

import { cn } from "../../utils/cn.js";
import { Button } from "../button/button.js";
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
  emptyTitle?: string;
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
      emptyTitle = "No data",
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
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleTable}
                className="shrink-0"
                aria-expanded={showTable}
              >
                {showTable ? "View chart" : "View data table"}
              </Button>
            )}
          </div>
          {insight && (
            <div className="mt-2 text-xs font-medium text-[var(--text-secondary)] bg-[var(--surface-muted)] border border-[var(--border)] rounded px-2.5 py-1.5">
              {insight}
            </div>
          )}
        </CardHeader>

        <CardContent className="flex-1 flex flex-col justify-center">
          {loading ? (
            <div
              style={{ height }}
              aria-hidden="true"
              className="w-full bg-[var(--surface-hover)] animate-pulse rounded-md flex items-center justify-center text-xs text-[var(--text-disabled)]"
            >
              Loading chart...
            </div>
          ) : empty ? (
            <div
              style={{ minHeight: height }}
              className="flex items-center justify-center"
            >
              <EmptyState
                title={emptyTitle}
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
              style={{ height: height === "full" ? "100%" : height }}
              role="region"
              aria-labelledby={titleId}
              aria-describedby={description ? descId : undefined}
              className="w-full flex-1 flex flex-col"
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
