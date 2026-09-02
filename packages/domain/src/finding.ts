import type { FindingId, RunId } from "./identity.js";

export const findingSeverities = ["critical", "high", "medium", "low"] as const;
export type FindingSeverity = (typeof findingSeverities)[number];
export type DiffSide = "RIGHT";

export interface ChangedLine {
  readonly line: number;
  readonly path: string;
  readonly side: DiffSide;
}

export interface FindingLocation extends ChangedLine {
  readonly startLine?: number | undefined;
}

export interface FindingEvidence {
  readonly endLine?: number | undefined;
  readonly excerpt: string;
  readonly path: string;
  readonly reason: string;
  readonly startLine: number;
}

export interface FindingCandidate {
  readonly confidence: number;
  readonly diagnostic: string;
  readonly evidence: readonly FindingEvidence[];
  readonly location: FindingLocation;
  readonly severity: FindingSeverity;
  readonly suggestion?: string | undefined;
}

export type Finding = FindingCandidate;
export type FindingPublication = "inline" | "summary_only" | "discard";

function assertNonBlank(value: string, name: string, minimumLength = 1): void {
  if (value.trim().length < minimumLength) {
    throw new TypeError(
      `${name} must contain at least ${minimumLength} characters`,
    );
  }
}

function assertPositiveLine(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

export function isChangedLine(
  location: FindingLocation,
  changedLines: readonly ChangedLine[],
): boolean {
  return changedLines.some(
    (line) =>
      line.path === location.path &&
      line.line === location.line &&
      line.side === location.side,
  );
}

export function createFinding(
  candidate: FindingCandidate,
  changedLines: readonly ChangedLine[],
): Finding {
  if (
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    throw new TypeError("confidence must be between 0 and 1");
  }
  assertNonBlank(candidate.diagnostic, "diagnostic", 30);
  assertNonBlank(candidate.location.path, "location.path");
  assertPositiveLine(candidate.location.line, "location.line");
  if (candidate.location.startLine !== undefined) {
    assertPositiveLine(candidate.location.startLine, "location.startLine");
    if (candidate.location.startLine > candidate.location.line) {
      throw new TypeError("location.startLine must not follow location.line");
    }
  }
  if (!isChangedLine(candidate.location, changedLines)) {
    throw new TypeError(
      "finding location must belong to an added line in the current diff",
    );
  }
  if (candidate.evidence.length === 0) {
    throw new TypeError("finding must contain causal evidence");
  }
  for (const evidence of candidate.evidence) {
    assertNonBlank(evidence.path, "evidence.path");
    assertNonBlank(evidence.excerpt, "evidence.excerpt");
    assertNonBlank(evidence.reason, "evidence.reason");
    assertPositiveLine(evidence.startLine, "evidence.startLine");
    if (evidence.endLine !== undefined) {
      assertPositiveLine(evidence.endLine, "evidence.endLine");
    }
    if (
      evidence.endLine !== undefined &&
      evidence.endLine < evidence.startLine
    ) {
      throw new TypeError(
        "evidence.endLine must not precede evidence.startLine",
      );
    }
  }
  return candidate;
}

export function classifyFindingPublication(
  finding: Finding,
): FindingPublication {
  if (finding.confidence < 0.8) return "discard";
  if (finding.severity === "low") return "summary_only";
  return "inline";
}

export function buildPublicationMarker(
  runId: RunId,
  findingId: FindingId | "summary",
): string {
  return `<!-- holon:v1;run=${encodeURIComponent(runId)};finding=${encodeURIComponent(findingId)} -->`;
}

export function countFindingsBySeverity(
  findings: readonly Finding[],
): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = {
    critical: 0,
    high: 0,
    low: 0,
    medium: 0,
  };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}
