import * as React from "react";

import { cn } from "../../utils/cn.js";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ title, description, icon, action, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="status"
        className={cn(
          "flex flex-col items-center justify-center p-8 text-center rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50",
          className,
        )}
        {...props}
      >
        {icon && (
          <div
            aria-hidden="true"
            className="flex items-center justify-center w-10 h-10 mb-3 rounded-full bg-zinc-100 text-zinc-500"
          >
            {icon}
          </div>
        )}
        <h4 className="text-sm font-semibold text-zinc-900">{title}</h4>
        {description && (
          <p className="mt-1 text-xs text-zinc-500 max-w-sm">{description}</p>
        )}
        {action && <div className="mt-4">{action}</div>}
      </div>
    );
  },
);

EmptyState.displayName = "EmptyState";
