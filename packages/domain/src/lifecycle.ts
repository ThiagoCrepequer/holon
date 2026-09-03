import type { Finding } from "./finding.js";
import type {
  FindingFingerprint,
  FindingStatus,
  PrKey,
  RunId,
} from "./identity.js";

export interface TrackedFinding {
  readonly diagnostic: string;
  readonly filePath: string;
  readonly fingerprint: FindingFingerprint;
  readonly firstSeenHeadSha: string;
  readonly firstSeenRunId: RunId;
  readonly githubCommentId?: number | undefined;
  readonly lastSeenHeadSha: string;
  readonly lastSeenRunId: RunId;
  readonly line: number;
  readonly prKey: PrKey;
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly status: FindingStatus;
  readonly updatedAt: string;
}

export interface ReconciledFinding extends Finding {
  readonly fingerprint: FindingFingerprint;
  readonly firstSeenHeadSha?: string | undefined;
  readonly previousCommentId?: number | undefined;
  readonly status: FindingStatus;
}

export interface ReconciliationSummary {
  readonly dismissedCount: number;
  readonly newCount: number;
  readonly obsoleteCount: number;
  readonly persistentCount: number;
  readonly reintroducedCount: number;
  readonly resolvedCount: number;
  readonly totalActiveCount: number;
}

export interface FindingWithFingerprint extends Finding {
  readonly fingerprint: FindingFingerprint;
}

export interface ReconcileFindingsInput {
  readonly baselineFindings: readonly TrackedFinding[];
  readonly currentFindings: readonly FindingWithFingerprint[];
  readonly currentHeadSha: string;
  readonly currentRunId: RunId;
  readonly prFiles: readonly string[];
  readonly prKey: PrKey;
  readonly timestamp?: string | undefined;
}

export interface ReconciledLifecycleResult {
  readonly activeFindings: readonly ReconciledFinding[];
  readonly dismissedFindings: readonly ReconciledFinding[];
  readonly obsoleteFindings: readonly TrackedFinding[];
  readonly resolvedFindings: readonly TrackedFinding[];
  readonly summary: ReconciliationSummary;
  readonly updatedTrackedFindings: readonly TrackedFinding[];
}

export function reconcileFindings(
  input: ReconcileFindingsInput,
): ReconciledLifecycleResult {
  const now = input.timestamp ?? new Date().toISOString();
  const baselineMap = new Map<FindingFingerprint, TrackedFinding>(
    input.baselineFindings.map((f) => [f.fingerprint, f]),
  );

  const activeFindings: ReconciledFinding[] = [];
  const dismissedFindings: ReconciledFinding[] = [];
  const handledFingerprints = new Set<FindingFingerprint>();
  const updatedTrackedMap = new Map<FindingFingerprint, TrackedFinding>();

  // 1. Process current findings against baseline
  for (const current of input.currentFindings) {
    handledFingerprints.add(current.fingerprint);
    const existing = baselineMap.get(current.fingerprint);

    if (
      existing !== undefined &&
      (existing.status === "new" ||
        existing.status === "persistent" ||
        existing.status === "reintroduced")
    ) {
      // The issue is still active -> persistent
      const tracked: TrackedFinding = {
        ...existing,
        lastSeenHeadSha: input.currentHeadSha,
        lastSeenRunId: input.currentRunId,
        line: current.location.line,
        severity: current.severity,
        status: "persistent",
        updatedAt: now,
      };
      updatedTrackedMap.set(current.fingerprint, tracked);
      activeFindings.push({
        ...current,
        firstSeenHeadSha: existing.firstSeenHeadSha,
        previousCommentId: existing.githubCommentId,
        status: "persistent",
      });
    } else if (existing !== undefined && existing.status === "resolved") {
      // The issue was resolved before, but has been reintroduced
      const tracked: TrackedFinding = {
        ...existing,
        lastSeenHeadSha: input.currentHeadSha,
        lastSeenRunId: input.currentRunId,
        line: current.location.line,
        severity: current.severity,
        status: "reintroduced",
        updatedAt: now,
      };
      updatedTrackedMap.set(current.fingerprint, tracked);
      activeFindings.push({
        ...current,
        firstSeenHeadSha: existing.firstSeenHeadSha,
        previousCommentId: existing.githubCommentId,
        status: "reintroduced",
      });
    } else if (existing !== undefined && existing.status === "dismissed") {
      // Previously dismissed issue still matches: preserve dismissal without blocking
      const tracked: TrackedFinding = {
        ...existing,
        lastSeenHeadSha: input.currentHeadSha,
        lastSeenRunId: input.currentRunId,
        line: current.location.line,
        updatedAt: now,
      };
      updatedTrackedMap.set(current.fingerprint, tracked);
      dismissedFindings.push({
        ...current,
        firstSeenHeadSha: existing.firstSeenHeadSha,
        previousCommentId: existing.githubCommentId,
        status: "dismissed",
      });
    } else {
      // Entirely new issue
      const tracked: TrackedFinding = {
        diagnostic: current.diagnostic,
        filePath: current.location.path,
        fingerprint: current.fingerprint,
        firstSeenHeadSha: input.currentHeadSha,
        firstSeenRunId: input.currentRunId,
        githubCommentId: undefined,
        lastSeenHeadSha: input.currentHeadSha,
        lastSeenRunId: input.currentRunId,
        line: current.location.line,
        prKey: input.prKey,
        severity: current.severity,
        status: "new",
        updatedAt: now,
      };
      updatedTrackedMap.set(current.fingerprint, tracked);
      activeFindings.push({
        ...current,
        firstSeenHeadSha: input.currentHeadSha,
        status: "new",
      });
    }
  }

  // 2. Identify newly resolved and obsolete findings from baseline
  const resolvedFindings: TrackedFinding[] = [];
  const obsoleteFindings: TrackedFinding[] = [];
  const prFilesSet = new Set(input.prFiles);

  for (const existing of input.baselineFindings) {
    if (handledFingerprints.has(existing.fingerprint)) {
      continue;
    }

    if (
      existing.status === "new" ||
      existing.status === "persistent" ||
      existing.status === "reintroduced"
    ) {
      if (prFilesSet.has(existing.filePath)) {
        // File is still part of PR diff, but issue is gone -> resolved!
        const resolved: TrackedFinding = {
          ...existing,
          status: "resolved",
          updatedAt: now,
        };
        updatedTrackedMap.set(existing.fingerprint, resolved);
        resolvedFindings.push(resolved);
      } else {
        // File is no longer in PR diff -> obsolete
        const obsolete: TrackedFinding = {
          ...existing,
          status: "obsolete",
          updatedAt: now,
        };
        updatedTrackedMap.set(existing.fingerprint, obsolete);
        obsoleteFindings.push(obsolete);
      }
    } else {
      // Previously resolved or obsolete remains as is
      updatedTrackedMap.set(existing.fingerprint, existing);
    }
  }

  const newCount = activeFindings.filter((f) => f.status === "new").length;
  const persistentCount = activeFindings.filter(
    (f) => f.status === "persistent",
  ).length;
  const reintroducedCount = activeFindings.filter(
    (f) => f.status === "reintroduced",
  ).length;
  const resolvedCount = resolvedFindings.length;
  const obsoleteCount = obsoleteFindings.length;
  const totalActiveCount = activeFindings.length;

  const dismissedCount = dismissedFindings.length;

  const summary: ReconciliationSummary = {
    dismissedCount,
    newCount,
    obsoleteCount,
    persistentCount,
    reintroducedCount,
    resolvedCount,
    totalActiveCount,
  };

  return {
    activeFindings,
    dismissedFindings,
    obsoleteFindings,
    resolvedFindings,
    summary,
    updatedTrackedFindings: Array.from(updatedTrackedMap.values()),
  };
}
