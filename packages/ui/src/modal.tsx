import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

import { Button } from "./button.js";
import { cn } from "./classes.js";
import { Icon } from "./icons.js";

export type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  closeLabel: string;
  children: ReactNode;
  returnFocusRef: RefObject<HTMLElement | null>;
};

/** Dialog and Sheet share the native top layer, inert background and focus contract. */
export function Modal({
  className,
  ...props
}: ModalProps & { className: string }) {
  const {
    open,
    onOpenChange,
    title,
    description,
    closeLabel,
    children,
    returnFocusRef,
  } = props;
  const reference = useRef<HTMLDialogElement>(null);
  const wasOpen = useRef(false);
  const id = useId();
  useEffect(() => {
    const dialog = reference.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      wasOpen.current = true;
    } else if (wasOpen.current) {
      if (dialog.open) dialog.close();
      wasOpen.current = false;
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    }
  }, [open, returnFocusRef]);
  useEffect(() => {
    const dialog = reference.current;
    return () => {
      if (!dialog?.open) return;
      dialog.close();
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [returnFocusRef]);
  return (
    <dialog
      ref={reference}
      className={cn(
        "holon-dialog overflow-auto border border-border bg-raised p-6 text-foreground shadow-[var(--holon-shadow-float)]",
        className,
      )}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => {
        if (!reference.current?.open) onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onOpenChange(false);
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 id={`${id}-title`} className="text-title-sm font-semibold">
          {title}
        </h2>
        <Button
          variant="quiet"
          onClick={() => onOpenChange(false)}
          aria-label={closeLabel}
        >
          <Icon name="close" />
        </Button>
      </div>
      <p id={`${id}-description`} className="mb-6 text-small text-secondary">
        {description}
      </p>
      {children}
    </dialog>
  );
}
