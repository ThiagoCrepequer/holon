import { cva } from "class-variance-authority";
import type { ComponentPropsWithRef } from "react";

import { cn } from "./classes.js";

// Adapted from shadcn/ui Button (MIT); see packages/ui/README.md.
const buttonVariants = cva(
  "holon-button inline-flex min-h-control max-w-full shrink-0 items-center justify-center gap-2 rounded-md border border-transparent px-4 py-2 text-small font-semibold whitespace-normal wrap-anywhere focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:bg-disabled disabled:text-disabled-foreground [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "holon-button-primary bg-primary text-primary-foreground enabled:hover:bg-primary-hover enabled:active:bg-primary-pressed",
        secondary:
          "holon-button-secondary border-input bg-card text-foreground enabled:hover:bg-muted",
        quiet:
          "holon-button-quiet bg-transparent text-link enabled:hover:bg-muted",
        danger:
          "holon-button-danger bg-danger text-danger-foreground enabled:hover:border-danger-foreground",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  busy?: boolean;
}
export function Button({
  variant = "primary",
  busy = false,
  disabled,
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || props["aria-busy"]}
      data-slot="button"
      className={cn(buttonVariants({ variant }), className)}
    />
  );
}
