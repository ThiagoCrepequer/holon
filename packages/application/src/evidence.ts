import type { ReviewShardContext } from "@holon/contracts";
import {
  createFinding,
  isChangedLine,
  type Finding,
  type FindingCandidate,
  type FindingEvidence,
} from "@holon/domain";

const hunkHeaderPattern = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u;

function newFileLines(patch: string): ReadonlyMap<number, string> {
  const lines = new Map<number, string>();
  let nextNewLine: number | undefined;
  for (const line of patch.split("\n")) {
    const hunk = hunkHeaderPattern.exec(line);
    if (hunk?.[1] !== undefined) {
      nextNewLine = Number.parseInt(hunk[1], 10);
      continue;
    }
    if (nextNewLine === undefined) continue;
    if (line.startsWith("\\ No newline at end of file")) continue;
    if (line.startsWith("-")) continue;
    if (line.startsWith("+") || line.startsWith(" ")) {
      lines.set(nextNewLine, line.slice(1));
      nextNewLine += 1;
      continue;
    }
    nextNewLine = undefined;
  }
  return lines;
}

function normalizeEvidenceText(value: string): string {
  return value.replaceAll(/\s+/gu, " ").trim();
}

export type EvidenceRejectionReason =
  | "location_file_missing"
  | "location_outside_hunk"
  | "location_not_added"
  | "evidence_file_missing"
  | "evidence_range_too_large"
  | "evidence_range_missing"
  | "evidence_excerpt_empty"
  | "evidence_excerpt_mismatch"
  | "finding_contract_invalid";

/** Positional identifiers only: never retain source paths, excerpts or diagnostics. */
export interface EvidenceRejection {
  readonly findingIndex: number;
  readonly evidenceIndex?: number;
  readonly reason: EvidenceRejectionReason;
}

function evidenceRejectionReason(
  evidence: FindingEvidence,
  context: ReviewShardContext,
): EvidenceRejectionReason | undefined {
  const file = context.files.find(
    (candidate) => candidate.path === evidence.path,
  );
  if (file === undefined) return "evidence_file_missing";
  const lines = newFileLines(file.patch);
  const endLine = evidence.endLine ?? evidence.startLine;
  if (endLine - evidence.startLine > 500) return "evidence_range_too_large";
  const selected: string[] = [];
  for (let line = evidence.startLine; line <= endLine; line += 1) {
    const content = lines.get(line);
    if (content === undefined) return "evidence_range_missing";
    selected.push(content);
  }
  const excerpt = normalizeEvidenceText(evidence.excerpt);
  if (!excerpt.length) return "evidence_excerpt_empty";
  return normalizeEvidenceText(selected.join("\n")).includes(excerpt)
    ? undefined
    : "evidence_excerpt_mismatch";
}

export function verifyFindingsWithCanonicalEvidence(
  candidates: readonly FindingCandidate[],
  context: ReviewShardContext,
): {
  readonly findings: readonly Finding[];
  readonly rejections: readonly EvidenceRejection[];
} {
  const rejections: EvidenceRejection[] = [];
  const findings = candidates.flatMap((candidate, findingIndex) => {
    const reject = (
      reason: EvidenceRejectionReason,
      evidenceIndex?: number,
    ): Finding[] => {
      rejections.push({
        findingIndex,
        reason,
        ...(evidenceIndex === undefined ? {} : { evidenceIndex }),
      });
      return [];
    };
    const patch = context.files.find(
      (file) => file.path === candidate.location.path,
    )?.patch;
    if (patch === undefined) return reject("location_file_missing");
    const start = candidate.location.startLine ?? candidate.location.line;
    const end = candidate.location.line;
    const rangeInHunk = patch?.split("\n").some((line) => {
      const hunk = hunkHeaderPattern.exec(line);
      if (!hunk?.[1]) return false;
      const first = Number(hunk[1]);
      const count = Number(hunk[2] ?? 1);
      return start >= first && end < first + count;
    });
    if (!rangeInHunk) return reject("location_outside_hunk");

    for (const [evidenceIndex, evidence] of candidate.evidence.entries()) {
      const reason = evidenceRejectionReason(evidence, context);
      if (reason) return reject(reason, evidenceIndex);
    }
    if (!isChangedLine(candidate.location, context.changedLines))
      return reject("location_not_added");
    try {
      return [createFinding(candidate, context.changedLines)];
    } catch (error) {
      if (error instanceof TypeError) return reject("finding_contract_invalid");
      throw error;
    }
  });
  return { findings, rejections };
}
