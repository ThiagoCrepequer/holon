import * as React from "react";

import { cn } from "../../utils/cn.js";
import { Card, CardContent, CardHeader, CardTitle } from "./card.js";

export type MetricTone = "neutral" | "success" | "warning" | "danger" | "info";

export interface MetricCardProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  tone?: MetricTone;
  icon?: React.ReactNode;
  loading?: boolean;
}

const toneValueStyles: Record<MetricTone, string> = {
  neutral: "text-zinc-900",
  success: "text-emerald-700",
  warning: "text-amber-700",
  danger: "text-rose-700",
  info: "text-blue-700",
};

export const MetricCard = React.forwardRef<HTMLDivElement, MetricCardProps>(
  (
    {
      label,
      value,
      subtitle,
      tone = "neutral",
      icon,
      loading = false,
      className,
      ...props
    },
    ref,
  ) => {
    return (
      <Card ref={ref} className={cn("overflow-hidden", className)} {...props}>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
            {label}
          </CardTitle>
          {icon && (
            <div aria-hidden="true" className="text-zinc-400">
              {icon}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2 py-1">
              <div
                aria-hidden="true"
                className="h-7 w-24 bg-zinc-200 animate-pulse rounded"
              />
              {subtitle && (
                <div
                  aria-hidden="true"
                  className="h-3 w-32 bg-zinc-100 animate-pulse rounded"
                />
              )}
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "text-2xl font-bold font-mono tracking-tight tabular-nums",
                  toneValueStyles[tone],
                )}
              >
                {value}
              </div>
              {subtitle && (
                <p className="text-xs text-zinc-400 mt-1">{subtitle}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    );
  },
);

MetricCard.displayName = "MetricCard";
