import {
  modelReviewOutputSchema,
  type ModelReviewOutput,
  type ReviewShardContext,
} from "@holon/contracts";
import {
  createFinding,
  isChangedLine,
  type Finding,
  type FindingCandidate,
  type FindingEvidence,
} from "@holon/domain";

const hunkHeaderPattern = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u;

/** Canonical selection shared by the production adapter and the real-model harness. */
export function prepareCausalCandidates(
  draft: ModelReviewOutput,
  context: ReviewShardContext,
) {
  const verification = verifyFindingsWithCanonicalEvidence(
    draft.findings,
    context,
  );
  return {
    candidates: modelReviewOutputSchema.parse({
      ...draft,
      findings: verification.findings,
      ...(verification.rejections.length
        ? {
            isDegraded: true,
            outputLimitations: [
              ...new Set([
                ...(draft.outputLimitations ?? []),
                "evidence_rejected",
              ]),
            ],
          }
        : {}),
    }),
    rejections: verification.rejections,
  };
}

interface CanonicalFile {
  readonly lines: Map<number, string>;
  readonly conflicts: Set<number>;
}

/** Fragments may overlap; only identical content at the same coordinate agrees. */
function indexCanonicalFiles(
  context: ReviewShardContext,
): ReadonlyMap<string, CanonicalFile> {
  const files = new Map<string, CanonicalFile>();
  for (const fragment of context.files) {
    let file = files.get(fragment.path);
    if (file === undefined) {
      file = { lines: new Map(), conflicts: new Set() };
      files.set(fragment.path, file);
    }
    let next: number | undefined;
    let end = 0;
    for (const line of fragment.patch.replaceAll("\r\n", "\n").split("\n")) {
      const hunk = hunkHeaderPattern.exec(line);
      if (hunk?.[1] !== undefined) {
        next = Number(hunk[1]);
        end = next + Number(hunk[2] ?? 1);
        continue;
      }
      if (next === undefined || next >= end) continue;
      if (
        line.startsWith("\\ No newline at end of file") ||
        line.startsWith("-")
      )
        continue;
      if (line.startsWith("+") || line.startsWith(" ")) {
        const content = line.slice(1);
        const previous = file.lines.get(next);
        if (previous !== undefined && previous !== content)
          file.conflicts.add(next);
        file.lines.set(next, content);
        next += 1;
      } else {
        next = undefined;
      }
    }
  }
  return files;
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
  | "canonical_content_conflict"
  | "finding_contract_invalid";

/** Positional identifiers only: never retain source paths, excerpts or diagnostics. */
export interface EvidenceRejection {
  readonly findingIndex: number;
  readonly evidenceIndex?: number;
  readonly reason: EvidenceRejectionReason;
}

function evidenceRejectionReason(
  evidence: FindingEvidence,
  files: ReadonlyMap<string, CanonicalFile>,
): EvidenceRejectionReason | undefined {
  const file = files.get(evidence.path);
  if (file === undefined) return "evidence_file_missing";
  const endLine = evidence.endLine ?? evidence.startLine;
  if (
    !Number.isSafeInteger(evidence.startLine) ||
    !Number.isSafeInteger(endLine) ||
    evidence.startLine < 1 ||
    endLine < evidence.startLine ||
    endLine - evidence.startLine > 500
  )
    return "evidence_range_too_large";
  const selected: string[] = [];
  for (let line = evidence.startLine; line <= endLine; line += 1) {
    if (file.conflicts.has(line)) return "canonical_content_conflict";
    const content = file.lines.get(line);
    if (content === undefined) return "evidence_range_missing";
    selected.push(content);
  }
  const excerpt = evidence.excerpt.replaceAll("\r\n", "\n");
  if (!excerpt.trim().length) return "evidence_excerpt_empty";
  return selected.join("\n").includes(excerpt)
    ? undefined
    : "evidence_excerpt_mismatch";
}

export function verifyFindingsWithCanonicalEvidence(
  candidates: readonly FindingCandidate[],
  context: ReviewShardContext,
): CanonicalEvidenceVerification {
  return createCanonicalEvidenceVerifier(context).verify(candidates);
}

export interface CanonicalEvidenceVerification {
  readonly findings: readonly Finding[];
  readonly rejections: readonly EvidenceRejection[];
}

/** One immutable snapshot index can validate multiple batches without reparsing. */
export function createCanonicalEvidenceVerifier(context: ReviewShardContext): {
  readonly changedLineExcerpts: () => readonly Pick<
    FindingEvidence,
    "path" | "startLine" | "endLine" | "excerpt"
  >[];
  readonly verify: (
    candidates: readonly FindingCandidate[],
  ) => CanonicalEvidenceVerification;
} {
  const files = indexCanonicalFiles(context);
  const changedLines = context.changedLines.map((line) => ({ ...line }));
  return {
    changedLineExcerpts() {
      const seen = new Set<string>();
      return changedLines.flatMap((line) => {
        const file = files.get(line.path);
        const excerpt = file?.lines.get(line.line);
        const key = JSON.stringify([line.path, line.line]);
        if (
          seen.has(key) ||
          excerpt === undefined ||
          file?.conflicts.has(line.line)
        )
          return [];
        seen.add(key);
        return [
          {
            path: line.path,
            startLine: line.line,
            endLine: line.line,
            excerpt,
          },
        ];
      });
    },
    verify(candidates) {
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
        const file = files.get(candidate.location.path);
        if (file === undefined) return reject("location_file_missing");
        const start = candidate.location.startLine ?? candidate.location.line;
        const end = candidate.location.line;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 1 ||
          end < start ||
          end - start > 500
        )
          return reject("finding_contract_invalid");
        for (let line = start; line <= end; line++) {
          if (file.conflicts.has(line))
            return reject("canonical_content_conflict");
          if (!file.lines.has(line)) return reject("location_outside_hunk");
        }

        for (const [evidenceIndex, evidence] of candidate.evidence.entries()) {
          const reason = evidenceRejectionReason(evidence, files);
          if (reason) return reject(reason, evidenceIndex);
        }
        if (!isChangedLine(candidate.location, changedLines))
          return reject("location_not_added");
        try {
          return [createFinding(candidate, changedLines)];
        } catch (error) {
          if (error instanceof TypeError)
            return reject("finding_contract_invalid");
          throw error;
        }
      });
      return { findings, rejections };
    },
  };
}
