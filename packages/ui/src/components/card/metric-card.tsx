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
  emphasis?: "standard" | "primary";
}

const toneValueStyles: Record<MetricTone, string> = {
  neutral: "text-[var(--text-primary)]",
  success: "text-[var(--success-text)]",
  warning: "text-[var(--warning-text)]",
  danger: "text-[var(--danger-text)]",
  info: "text-[var(--info-text)]",
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
      emphasis = "standard",
      className,
      ...props
    },
    ref,
  ) => {
    const labelId = React.useId();
    return (
      <Card
        ref={ref}
        role="group"
        aria-labelledby={labelId}
        className={cn("metric-card", className)}
        data-emphasis={emphasis}
        aria-busy={loading || undefined}
        {...props}
      >
        <CardHeader className="metric-card-header">
          <CardTitle id={labelId} className="metric-card-label">
            {label}
          </CardTitle>
          {icon && (
            <div aria-hidden="true" className="metric-card-icon">
              {icon}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2 py-1">
              <div
                aria-hidden="true"
                className="h-7 w-24 bg-[var(--surface-subtle)] animate-pulse rounded"
              />
              {subtitle && (
                <div
                  aria-hidden="true"
                  className="h-3 w-32 bg-[var(--surface-hover)] animate-pulse rounded"
                />
              )}
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "metric-card-value tabular-nums",
                  toneValueStyles[tone],
                )}
              >
                {value}
              </div>
              {subtitle && (
                <p className="metric-card-description">{subtitle}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    );
  },
);

MetricCard.displayName = "MetricCard";
