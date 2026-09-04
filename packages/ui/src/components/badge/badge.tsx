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
  neutral: "bg-zinc-100 text-zinc-700 border-zinc-200",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  danger: "bg-rose-50 text-rose-700 border-rose-200",
  info: "bg-blue-50 text-blue-700 border-blue-200",
};

const dotStyles: Record<BadgeVariant, string> = {
  neutral: "bg-zinc-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  info: "bg-blue-500",
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs",
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
          "inline-flex items-center gap-1.5 font-medium border rounded-full transition-colors",
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
