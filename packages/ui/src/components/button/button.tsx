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
    "bg-zinc-900 text-white hover:bg-zinc-800 active:bg-zinc-950 focus-visible:ring-zinc-950 disabled:bg-zinc-300 disabled:text-zinc-500",
  secondary:
    "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 active:bg-zinc-300 focus-visible:ring-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-400",
  outline:
    "border border-zinc-300 bg-transparent text-zinc-900 hover:bg-zinc-50 active:bg-zinc-100 focus-visible:ring-zinc-950 disabled:border-zinc-200 disabled:text-zinc-400",
  ghost:
    "bg-transparent text-zinc-700 hover:bg-zinc-100 active:bg-zinc-200 focus-visible:ring-zinc-950 disabled:text-zinc-400",
  danger:
    "bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 focus-visible:ring-rose-600 disabled:bg-rose-300 disabled:text-rose-100",
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
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
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
