import { useEffect, useId, useRef, type ReactNode } from "react";

import { Button } from "./button.js";
import { Icon } from "./icons.js";

/** Native dialog owns top layer, inert siblings, Escape and return of focus. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const reference = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = reference.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
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
      onClose={() => onOpenChange(false)}
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
