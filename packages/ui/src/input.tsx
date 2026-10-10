import type { ComponentPropsWithRef } from "react";

import { cn } from "./classes.js";

// Adapted from shadcn/ui Input (MIT); see packages/ui/README.md.
export function Input({
  className,
  type,
  ...props
}: ComponentPropsWithRef<"input">) {
  return (
    <input
      {...props}
      type={type}
      data-slot="input"
      className={cn(
        "min-h-control w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-body text-foreground transition-[border-color] duration-(--holon-motion-fast) enabled:hover:border-secondary placeholder:text-muted-foreground selection:bg-selected selection:text-selected-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:bg-disabled disabled:text-disabled-foreground aria-invalid:border-danger-foreground aria-invalid:enabled:hover:border-danger-foreground motion-reduce:transition-none",
        className,
      )}
    />
  );
}
