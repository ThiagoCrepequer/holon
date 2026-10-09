import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

import { Button } from "./button.js";
import { Icon } from "./icons.js";

/** Native dialog owns top layer/inert/Escape; the explicit trigger restores focus across pointer policies. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  closeLabel: string;
  children: ReactNode;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
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
      className="holon-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClose={() => {
        if (!reference.current?.open) onOpenChange(false);
      }}
    >
      <div className="holon-dialog-heading">
        <h2 id={`${id}-title`}>{title}</h2>
        <Button
          variant="quiet"
          onClick={() => onOpenChange(false)}
          aria-label={closeLabel}
        >
          <Icon name="close" />
        </Button>
      </div>
      <p id={`${id}-description`} className="holon-hint">
        {description}
      </p>
      {children}
    </dialog>
  );
}
