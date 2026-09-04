/// <reference lib="dom" />

export type DeliveryId = `github:${string}`;
export type PrKey = `github:${number}:pr:${number}`;
export type RunId = `${PrKey}:head:${string}`;
export type FindingId = `finding:${string}`;
export type PublicationId = `${RunId}:publication:${FindingId | "summary"}`;
export type FindingFingerprint = `fp:${string}`;
export type FindingStatus =
  | "new"
  | "persistent"
  | "resolved"
  | "obsolete"
  | "reintroduced"
  | "dismissed";

export type FeedbackLabel =
  | "helpful"
  | "false_positive"
  | "wrong_severity"
  | "duplicate"
  | "not_actionable"
  | "missed_defect"
  | "thread_resolved";

const safeIdentifier = /^[A-Za-z0-9._:-]+$/u;
const gitSha = /^[a-fA-F0-9]{40}$/u;

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

export function createDeliveryId(deliveryId: string): DeliveryId {
  if (!safeIdentifier.test(deliveryId)) {
    throw new TypeError("deliveryId contains unsupported characters");
  }
  return `github:${deliveryId}`;
}

export interface GitHubPullRequestCoordinates {
  readonly provider: "github";
  readonly pullRequestNumber: number;
  readonly repositoryId: number;
}

export function createPrKey(coordinates: GitHubPullRequestCoordinates): PrKey {
  assertPositiveInteger(coordinates.repositoryId, "repositoryId");
  assertPositiveInteger(coordinates.pullRequestNumber, "pullRequestNumber");
  return `github:${coordinates.repositoryId}:pr:${coordinates.pullRequestNumber}`;
}

export function createRunId(prKey: PrKey, headSha: string): RunId {
  if (!gitSha.test(headSha)) {
    throw new TypeError("headSha must be a 40-character Git object ID");
  }
  return `${prKey}:head:${headSha.toLowerCase()}`;
}

export function derivePrKeyFromRunId(runId: string): PrKey {
  const index = runId.lastIndexOf(":head:");
  if (index === -1) {
    throw new TypeError("runId must contain :head: separator");
  }
  const prKey = runId.slice(0, index);
  if (!/^github:[1-9]\d*:pr:[1-9]\d*$/u.test(prKey)) {
    throw new TypeError("runId does not contain a valid prKey");
  }
  return prKey as PrKey;
}

export interface FindingIdentityInput {
  readonly diagnostic: string;
  readonly endLine: number;
  readonly path: string;
  readonly startLine: number;
}

function normalizeDiagnostic(value: string): string {
  return value.trim().replaceAll(/\s+/gu, " ").toLowerCase();
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function createFindingId(
  runId: RunId,
  input: FindingIdentityInput,
): Promise<FindingId> {
  const canonical = JSON.stringify([
    runId,
    input.path,
    input.startLine,
    input.endLine,
    normalizeDiagnostic(input.diagnostic),
  ]);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return `finding:${bytesToHex(new Uint8Array(digest))}`;
}

export function createPublicationId(
  runId: RunId,
  findingId: FindingId | "summary",
): PublicationId {
  return `${runId}:publication:${findingId}`;
}
