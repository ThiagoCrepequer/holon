import type { ReviewContext, ShardReviewGuidance } from "@holon/application";
import type {
  ProjectIdentificationResult,
  ReviewShard,
  StructuralImpactReport,
} from "@holon/contracts";
import type { TrackedFinding } from "@holon/domain";
import { selectStructuralImpact } from "@holon/domain";

/** One projection shared by preflight and execution; no repository reads or inference. */
export function buildShardReviewContext(
  shard: ReviewShard,
  structuralImpact: StructuralImpactReport | undefined,
  baseline: readonly TrackedFinding[],
  identification: ProjectIdentificationResult | undefined,
  inputTruncated: boolean,
  repositoryGuidance?: ShardReviewGuidance,
  deadlineAt?: number,
): ReviewContext {
  return {
    repositoryGuidance,
    deadlineAt,
    priorFindings: baseline
      .filter(
        (f) =>
          ["new", "persistent", "reintroduced"].includes(f.status) &&
          shard.files.some((file) => file.path === f.filePath),
      )
      .map(({ fingerprint, diagnostic, filePath, severity }) => ({
        fingerprint,
        diagnostic,
        filePath,
        severity,
      })),
    projectIdentification: identification
      ? {
          ...identification,
          projects: identification.projects.filter((project) =>
            shard.files.some(
              (file) =>
                (project.root === "." ||
                  file.path.startsWith(project.root + "/")) &&
                !identification.projects.some(
                  (other) =>
                    other.root !== project.root &&
                    (project.root === "." ||
                      other.root.startsWith(project.root + "/")) &&
                    file.path.startsWith(other.root + "/"),
                ),
            ),
          ),
        }
      : undefined,
    changedLines: shard.changedLines,
    files: shard.files,
    structuralImpact: structuralImpact
      ? selectStructuralImpact(
          structuralImpact,
          shard.files.map((file) => file.path),
        )
      : undefined,
    surface: shard.surface,
    truncated: inputTruncated,
  };
}
