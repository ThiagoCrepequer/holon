import type { FindingId, PublicationId, RunId } from "./identity.js";

export type PublicationState = "publishing" | "published";

export interface PublicationRecord {
  readonly findingId: FindingId | "summary";
  readonly githubCommentId?: number;
  readonly id: PublicationId;
  readonly kind: "inline" | "summary";
  readonly marker: string;
  readonly runId: RunId;
  readonly state: PublicationState;
}
