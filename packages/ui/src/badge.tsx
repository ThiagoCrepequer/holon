import { cva } from "class-variance-authority";
import type { ComponentPropsWithRef } from "react";

import { cn } from "./classes.js";

// Adapted from shadcn/ui Badge (MIT).
const badgeVariants = cva(
  "inline-flex max-w-full items-center gap-2 rounded-full border border-transparent px-3 py-1 text-small leading-compact font-medium wrap-anywhere",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-secondary",
        success: "bg-success text-success-foreground",
        warning: "bg-warning text-warning-foreground",
        danger: "bg-danger text-danger-foreground",
        info: "bg-info text-info-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);
export function Badge({
  tone = "neutral",
  className,
  ...props
}: ComponentPropsWithRef<"span"> & {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  return (
    <span
      {...props}
      data-slot="badge"
      className={cn(badgeVariants({ tone }), className)}
    />
  );
}
