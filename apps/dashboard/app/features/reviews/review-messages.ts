import type { I18n } from "@lingui/core";
export function reviewStateMessages(i18n: I18n) {
  return {
    awaiting_review: i18n._({
      id: "reviews.state.awaiting",
      message: "Awaiting review",
    }),
    metadata_conflict: i18n._({
      id: "reviews.state.conflict",
      message: "Metadata needs reconciliation",
    }),
    queued: i18n._({ id: "reviews.state.queued", message: "Queued" }),
    running: i18n._({ id: "reviews.state.running", message: "Reviewing" }),
    publishing: i18n._({
      id: "reviews.state.publishing",
      message: "Publishing",
    }),
    completed: i18n._({ id: "reviews.state.completed", message: "Completed" }),
    failed_retryable: i18n._({
      id: "reviews.state.retryable",
      message: "Retry pending",
    }),
    failed_terminal: i18n._({ id: "reviews.state.failed", message: "Failed" }),
    obsolete: i18n._({ id: "reviews.state.obsolete", message: "Superseded" }),
  };
}
