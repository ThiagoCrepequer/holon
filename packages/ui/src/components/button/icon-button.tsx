import * as React from "react";

import { cn } from "../../utils/cn.js";
import {
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from "./button.js";

export interface IconButtonProps extends Omit<ButtonProps, "children"> {
  "aria-label": string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
}

const iconSizeStyles: Record<ButtonSize, string> = {
  sm: "w-8 h-8 p-0",
  md: "w-9 h-9 p-0",
  lg: "w-11 h-11 p-0",
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    { "aria-label": ariaLabel, size = "md", className, children, ...props },
    ref,
  ) => {
    return (
      <Button
        ref={ref}
        aria-label={ariaLabel}
        size={size}
        className={cn(iconSizeStyles[size], className)}
        {...props}
      >
        {children}
      </Button>
    );
  },
);

IconButton.displayName = "IconButton";
