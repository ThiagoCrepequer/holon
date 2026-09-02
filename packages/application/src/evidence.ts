import type { ReviewContextV2 } from "@holon/contracts";
import {
  createFinding,
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

function evidenceAppearsInPatch(
  evidence: FindingEvidence,
  context: ReviewContextV2,
): boolean {
  const file = context.files.find(
    (candidate) => candidate.path === evidence.path,
  );
  if (file === undefined) return false;
  const lines = newFileLines(file.patch);
  const endLine = evidence.endLine ?? evidence.startLine;
  if (endLine - evidence.startLine > 500) return false;
  const selected: string[] = [];
  for (let line = evidence.startLine; line <= endLine; line += 1) {
    const content = lines.get(line);
    if (content === undefined) return false;
    selected.push(content);
  }
  const excerpt = normalizeEvidenceText(evidence.excerpt);
  return (
    excerpt.length > 0 &&
    normalizeEvidenceText(selected.join("\n")).includes(excerpt)
  );
}

/**
 * Validates candidate findings against the Host Evidence Verification Gate.
 * Ensures each evidence excerpt literally appears in the canonical diff patch
 * and the finding location belongs to an added line on the RIGHT side.
 */
export function selectFindingsWithCanonicalEvidence(
  candidates: readonly FindingCandidate[],
  context: ReviewContextV2,
): readonly Finding[] {
  return candidates.flatMap((candidate) => {
    if (
      !candidate.evidence.every((evidence) =>
        evidenceAppearsInPatch(evidence, context),
      )
    ) {
      return [];
    }
    try {
      return [createFinding(candidate, context.changedLines)];
    } catch (error) {
      if (error instanceof TypeError) return [];
      throw error;
    }
  });
}
