export type CollaborationErrorCode =
  | "denied"
  | "reconnect_required"
  | "unavailable"
  | "command_unknown"
  | "conflict"
  | "rate_limited";
export class CollaborationError extends Error {
  constructor(readonly code: CollaborationErrorCode) {
    super(code);
    this.name = "CollaborationError";
  }
}
