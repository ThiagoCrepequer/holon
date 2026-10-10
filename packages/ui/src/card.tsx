import type { ComponentPropsWithRef } from "react";

import { cn } from "./classes.js";

// Adapted from shadcn/ui Card (MIT); native elements keep Holon's composition explicit.
export function Card({
  className,
  ...props
}: ComponentPropsWithRef<"section">) {
  return (
    <section
      {...props}
      data-slot="card"
      className={cn(
        "min-w-0 rounded-xl border border-border bg-card p-6 text-card-foreground",
        className,
      )}
    />
  );
}
export function CardHeader({
  className,
  ...props
}: ComponentPropsWithRef<"div">) {
  return (
    <div
      {...props}
      data-slot="card-header"
      className={cn(
        "mb-6 flex flex-wrap items-start justify-between gap-4",
        className,
      )}
    />
  );
}
export function CardTitle({
  className,
  ...props
}: ComponentPropsWithRef<"h2">) {
  return (
    <h2
      {...props}
      data-slot="card-title"
      className={cn(
        "text-title-sm leading-tight font-semibold tracking-tight",
        className,
      )}
    />
  );
}
