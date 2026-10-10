import { Modal, type ModalProps } from "./modal.js";

/** Right-hand shadcn Sheet layout with the same native lifecycle as Dialog. */
export function Sheet(props: ModalProps) {
  return (
    <Modal
      className="holon-sheet inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-[min(28rem,100vw)] max-w-full border-y-0 border-r-0 sm:rounded-l-xl"
      {...props}
    />
  );
}
