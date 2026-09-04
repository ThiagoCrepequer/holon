import { Drawer as BaseDrawer } from "@base-ui/react";
import * as React from "react";

import { cn } from "../../utils/cn.js";

export const Drawer = BaseDrawer.Root;
export const DrawerTrigger = BaseDrawer.Trigger;
export const DrawerPortal = BaseDrawer.Portal;
export const DrawerClose = BaseDrawer.Close;

export const DrawerBackdrop = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseDrawer.Backdrop>
>(({ className, ...props }, ref) => (
  <BaseDrawer.Backdrop
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/40 backdrop-blur-xs transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
      className,
    )}
    {...props}
  />
));
DrawerBackdrop.displayName = "DrawerBackdrop";

export const DrawerPopup = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseDrawer.Popup>
>(({ className, children, ...props }, ref) => (
  <BaseDrawer.Portal>
    <DrawerBackdrop />
    <BaseDrawer.Popup
      ref={ref}
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex flex-col w-full max-w-2xl bg-white border-l border-zinc-200 shadow-2xl",
        "transition-transform data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full",
        className,
      )}
      {...props}
    >
      {children}
    </BaseDrawer.Popup>
  </BaseDrawer.Portal>
));
DrawerPopup.displayName = "DrawerPopup";

export const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex items-center justify-between p-5 border-b border-zinc-100",
      className,
    )}
    {...props}
  />
);
DrawerHeader.displayName = "DrawerHeader";

export const DrawerTitle = React.forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof BaseDrawer.Title>
>(({ className, ...props }, ref) => (
  <BaseDrawer.Title
    ref={ref}
    className={cn("text-sm font-semibold text-zinc-950", className)}
    {...props}
  />
));
DrawerTitle.displayName = "DrawerTitle";

export const DrawerDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof BaseDrawer.Description>
>(({ className, ...props }, ref) => (
  <BaseDrawer.Description
    ref={ref}
    className={cn("text-xs text-zinc-500", className)}
    {...props}
  />
));
DrawerDescription.displayName = "DrawerDescription";

export const DrawerBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex-1 overflow-y-auto p-5 space-y-4", className)}
    {...props}
  />
);
DrawerBody.displayName = "DrawerBody";

export const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex items-center justify-end p-4 border-t border-zinc-100 gap-2 bg-zinc-50",
      className,
    )}
    {...props}
  />
);
DrawerFooter.displayName = "DrawerFooter";
