import * as React from "react";

import { cn } from "../../utils/cn.js";

export type BadgeVariant =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info";
export type BadgeSize = "sm" | "md";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  neutral:
    "bg-[var(--surface-hover)] text-[var(--text-secondary)] border-[var(--border)]",
  success:
    "bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]",
  warning:
    "bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-border)]",
  danger:
    "bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-border)]",
  info: "bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info-border)]",
};

const dotStyles: Record<BadgeVariant, string> = {
  neutral: "bg-[var(--text-muted)]",
  success: "bg-[var(--success)]",
  warning: "bg-[var(--warning)]",
  danger: "bg-[var(--danger)]",
  info: "bg-[var(--info)]",
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "px-1.5 py-0.5 text-[11px]",
  md: "px-2.5 py-1 text-xs",
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      variant = "neutral",
      size = "sm",
      dot = false,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1.5 font-medium border rounded-md transition-colors",
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        {dot && (
          <span
            aria-hidden="true"
            className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              dotStyles[variant],
            )}
          />
        )}
        {children}
      </span>
    );
  },
);

Badge.displayName = "Badge";
