import * as React from "react";

import { cn } from "../../utils/cn.js";

export type ButtonVariant =
  | "default"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  default:
    "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] active:bg-[var(--accent-hover)] focus-visible:ring-[var(--focus-ring)] disabled:bg-[var(--border-strong)] disabled:text-[var(--text-muted)]",
  secondary:
    "bg-[var(--surface-hover)] text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] active:bg-[var(--border-strong)] focus-visible:ring-[var(--focus-ring)] disabled:bg-[var(--surface-hover)] disabled:text-[var(--text-disabled)]",
  outline:
    "border border-[var(--border-strong)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--surface-muted)] active:bg-[var(--surface-hover)] focus-visible:ring-[var(--focus-ring)] disabled:border-[var(--border)] disabled:text-[var(--text-disabled)]",
  ghost:
    "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] active:bg-[var(--surface-subtle)] focus-visible:ring-[var(--focus-ring)] disabled:text-[var(--text-disabled)]",
  danger:
    "bg-[var(--danger)] text-white hover:bg-[var(--danger-text)] active:bg-[var(--danger-text)] focus-visible:ring-[var(--danger)] disabled:bg-[var(--danger-bg)] disabled:text-[var(--danger-text)]",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-md",
  md: "h-9 px-4 text-sm gap-2 rounded-md",
  lg: "h-11 px-5 text-base gap-2.5 rounded-lg",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "default",
      size = "md",
      loading = false,
      disabled = false,
      className,
      children,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading ? "true" : undefined}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors select-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ring-offset-[var(--surface)]",
          "disabled:cursor-not-allowed disabled:opacity-70",
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <svg
            aria-hidden="true"
            className="animate-spin -ml-0.5 w-4 h-4 text-current"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
