import { Menu } from "@base-ui/react/menu";
import type { ComponentProps } from "react";

import { cn } from "./classes.js";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

/** shadcn Base UI composition; Base UI owns keyboard navigation and dismissal. */
export function DropdownMenuContent({
  className,
  align = "start",
  side = "bottom",
  ...props
}: ComponentProps<typeof Menu.Popup> &
  Pick<ComponentProps<typeof Menu.Positioner>, "align" | "side">) {
  return (
    <Menu.Portal>
      <Menu.Positioner
        side={side}
        align={align}
        sideOffset={6}
        className="isolate z-50 outline-none"
      >
        <Menu.Popup
          className={cn(
            "max-h-[var(--available-height)] min-w-[var(--anchor-width)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border bg-raised p-1.5 text-foreground shadow-[var(--holon-shadow-float)] outline-none",
            className,
          )}
          {...props}
        />
      </Menu.Positioner>
    </Menu.Portal>
  );
}
const item =
  "flex min-h-control cursor-default items-center gap-3 rounded-md px-3 py-2 text-small font-medium outline-none select-none data-highlighted:bg-selected data-highlighted:text-selected-foreground data-disabled:pointer-events-none data-disabled:text-disabled-foreground";
export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof Menu.Item>) {
  return <Menu.Item className={cn(item, className)} {...props} />;
}
export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem
      closeOnClick
      className={cn(item, "justify-between", className)}
      {...props}
    >
      <span className="min-w-0 wrap-anywhere">{children}</span>
      <Menu.RadioItemIndicator
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-current"
      />
    </Menu.RadioItem>
  );
}
export function DropdownMenuSeparator() {
  return <Menu.Separator className="my-1.5 h-px bg-border" />;
}
