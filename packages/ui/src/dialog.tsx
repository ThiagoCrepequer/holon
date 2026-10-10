import { Modal, type ModalProps } from "./modal.js";

export function Dialog(props: ModalProps) {
  return (
    <Modal
      className="m-auto max-h-[calc(100dvh-2.5rem)] w-[min(28rem,calc(100vw-2.5rem))] rounded-xl"
      {...props}
    />
  );
}
