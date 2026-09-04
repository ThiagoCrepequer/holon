import * as React from "react";

import { cn } from "../../utils/cn.js";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "circle" | "text";
}

export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, variant = "default", ...props }, ref) => {
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cn(
          "bg-[var(--surface-subtle)]/80 animate-pulse",
          variant === "default" && "rounded-md",
          variant === "circle" && "rounded-full",
          variant === "text" && "h-4 rounded",
          className,
        )}
        {...props}
      />
    );
  },
);

Skeleton.displayName = "Skeleton";
