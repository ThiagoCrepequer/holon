import { Select as BaseSelect } from "@base-ui/react";
import * as React from "react";

import { cn } from "../../utils/cn.js";

export const Select = BaseSelect.Root;
export const SelectPortal = BaseSelect.Portal;
export const SelectGroup = BaseSelect.Group;
export const SelectList = BaseSelect.List;

export const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Trigger>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Trigger
    ref={ref}
    className={cn(
      "inline-flex h-8 items-center justify-between gap-2 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-900 shadow-xs transition-colors select-none",
      "hover:bg-zinc-50 active:bg-zinc-100",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-1",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
  </BaseSelect.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectValue = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Value>
>(({ className, ...props }, ref) => (
  <BaseSelect.Value
    ref={ref}
    className={cn(
      "truncate text-left text-zinc-900 data-[placeholder]:text-zinc-400",
      className,
    )}
    {...props}
  />
));
SelectValue.displayName = "SelectValue";

export const SelectIcon = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Icon>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Icon
    ref={ref}
    className={cn("text-zinc-500 shrink-0", className)}
    {...props}
  >
    {children ?? (
      <svg
        aria-hidden="true"
        className="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M19 9l-7 7-7-7"
        />
      </svg>
    )}
  </BaseSelect.Icon>
));
SelectIcon.displayName = "SelectIcon";

export const SelectPositioner = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Positioner>
>(({ className, ...props }, ref) => (
  <BaseSelect.Positioner
    ref={ref}
    className={cn("z-50 outline-none", className)}
    {...props}
  />
));
SelectPositioner.displayName = "SelectPositioner";

export const SelectPopup = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Popup>
>(({ className, ...props }, ref) => (
  <BaseSelect.Popup
    ref={ref}
    className={cn(
      "min-w-[8rem] max-h-60 overflow-auto rounded-md border border-zinc-200 bg-white p-1 text-zinc-950 shadow-md",
      "transition-all data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
      className,
    )}
    {...props}
  />
));
SelectPopup.displayName = "SelectPopup";

export const SelectItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Item>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-xs py-1.5 pl-2 pr-7 text-xs text-zinc-900 outline-none transition-colors",
      "data-[highlighted]:bg-zinc-100 data-[highlighted]:text-zinc-900",
      "data-[selected]:font-medium",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
      className,
    )}
    {...props}
  >
    {children}
  </BaseSelect.Item>
));
SelectItem.displayName = "SelectItem";

export const SelectItemText = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.ItemText>
>(({ className, ...props }, ref) => (
  <BaseSelect.ItemText
    ref={ref}
    className={cn("truncate", className)}
    {...props}
  />
));
SelectItemText.displayName = "SelectItemText";

export const SelectItemIndicator = React.forwardRef<
  HTMLSpanElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.ItemIndicator>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.ItemIndicator
    ref={ref}
    className={cn(
      "absolute right-2 flex items-center justify-center text-zinc-900",
      className,
    )}
    {...props}
  >
    {children ?? (
      <svg
        aria-hidden="true"
        className="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
          d="M5 13l4 4L19 7"
        />
      </svg>
    )}
  </BaseSelect.ItemIndicator>
));
SelectItemIndicator.displayName = "SelectItemIndicator";

export const SelectGroupLabel = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.GroupLabel>
>(({ className, ...props }, ref) => (
  <BaseSelect.GroupLabel
    ref={ref}
    className={cn(
      "py-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400",
      className,
    )}
    {...props}
  />
));
SelectGroupLabel.displayName = "SelectGroupLabel";

export const SelectSeparator = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseSelect.Separator>
>(({ className, ...props }, ref) => (
  <BaseSelect.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-zinc-100", className)}
    {...props}
  />
));
SelectSeparator.displayName = "SelectSeparator";
