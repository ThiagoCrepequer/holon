import type { ComponentPropsWithRef } from "react";

import { cn } from "./classes.js";

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
      aria-busy={busy || undefined}
      className={cn(
        "holon-button inline-flex items-center justify-center gap-2",
        `holon-button-${variant}`,
        className,
      )}
    />
  );
}
