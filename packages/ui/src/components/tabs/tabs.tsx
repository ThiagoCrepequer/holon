import { Tabs as BaseTabs } from "@base-ui/react";
import * as React from "react";

import { cn } from "../../utils/cn.js";

export const Tabs = BaseTabs.Root;

export const TabsList = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseTabs.List>
>(({ className, ...props }, ref) => (
  <BaseTabs.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 text-[var(--text-muted)]",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTab = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof BaseTabs.Tab>
>(({ className, ...props }, ref) => (
  <BaseTabs.Tab
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all select-none",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[selected]:bg-[var(--accent)] data-[selected]:text-[var(--accent-contrast)] data-[selected]:shadow-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
      className,
    )}
    {...props}
  />
));
TabsTab.displayName = "TabsTab";

export const TabsPanel = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseTabs.Panel>
>(({ className, ...props }, ref) => (
  <BaseTabs.Panel
    ref={ref}
    className={cn(
      "mt-2 ring-offset-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
      className,
    )}
    {...props}
  />
));
TabsPanel.displayName = "TabsPanel";
