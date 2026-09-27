import type { Finding } from "./finding.js";
import type {
  FindingFingerprint,
  FindingStatus,
  PrKey,
  RunId,
} from "./identity.js";

export interface TrackedFinding {
  readonly identityAmbiguous?: boolean | undefined;
  readonly evidenceFingerprint: string;
  readonly confidence: number;
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
  readonly identityAmbiguous?: boolean | undefined;
  readonly evidenceFingerprint: string;
  readonly fingerprint: FindingFingerprint;
  readonly firstSeenHeadSha?: string | undefined;
  readonly previousCommentId?: number | undefined;
  readonly status: FindingStatus;
}

export interface ReconciliationSummary {
  readonly unverifiedCount?: number | undefined;
  readonly dismissedCount: number;
  readonly newCount: number;
  readonly obsoleteCount: number;
  readonly persistentCount: number;
  readonly reintroducedCount: number;
  readonly resolvedCount: number;
  readonly totalActiveCount: number;
}

export interface FindingWithFingerprint extends Finding {
  readonly evidenceFingerprint: string;
  readonly fingerprint: FindingFingerprint;
}

export interface ReconcileFindingsInput {
  readonly baselineFindings: readonly TrackedFinding[];
  readonly coverage: {
    readonly confirmedResolvedFingerprints?: readonly string[] | undefined;
    readonly isComplete: boolean;
    readonly pullRequestFiles: readonly string[];
    readonly reviewedFiles: readonly string[];
  };
  readonly currentFindings: readonly FindingWithFingerprint[];
  readonly currentHeadSha: string;
  readonly currentRunId: RunId;
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
  const currentIds = new Set(input.currentFindings.map((f) => f.fingerprint));
  const confirmedResolved = new Set(
    input.coverage.confirmedResolvedFingerprints ?? [],
  );
  let unverifiedCount = 0;
  const ambiguousBaselineIds = new Set<FindingFingerprint>();

  // 1. Process current findings against baseline
  for (const candidate of input.currentFindings) {
    const evidenceMatches = input.baselineFindings.filter(
      (previous) =>
        previous.evidenceFingerprint === candidate.evidenceFingerprint &&
        previous.filePath === candidate.location.path,
    );
    const uniqueCandidate =
      input.currentFindings.filter(
        (f) => f.evidenceFingerprint === candidate.evidenceFingerprint,
      ).length === 1;
    const evidenceMatch =
      evidenceMatches.length === 1 && uniqueCandidate
        ? evidenceMatches[0]
        : undefined;
    const exact = baselineMap.get(candidate.fingerprint);
    if (
      (exact === undefined || exact.identityAmbiguous === true) &&
      evidenceMatches.length > 0 &&
      (evidenceMatch === undefined ||
        (evidenceMatch.fingerprint !== candidate.fingerprint &&
          currentIds.has(evidenceMatch.fingerprint)))
    ) {
      for (const match of evidenceMatches)
        ambiguousBaselineIds.add(match.fingerprint);
      const tracked: TrackedFinding = {
        ...exact,
        identityAmbiguous: true,
        evidenceFingerprint: candidate.evidenceFingerprint,
        confidence: candidate.confidence,
        diagnostic: candidate.diagnostic,
        filePath: candidate.location.path,
        fingerprint: candidate.fingerprint,
        firstSeenHeadSha: exact?.firstSeenHeadSha ?? input.currentHeadSha,
        firstSeenRunId: exact?.firstSeenRunId ?? input.currentRunId,
        lastSeenHeadSha: input.currentHeadSha,
        lastSeenRunId: input.currentRunId,
        line: candidate.location.line,
        prKey: input.prKey,
        severity: candidate.severity,
        status: exact?.status ?? "new",
        updatedAt: now,
      };
      updatedTrackedMap.set(candidate.fingerprint, tracked);
      handledFingerprints.add(candidate.fingerprint);
      activeFindings.push({
        ...candidate,
        identityAmbiguous: true,
        status: tracked.status,
        previousCommentId: exact?.githubCommentId,
      });
      continue;
    }
    const current =
      !baselineMap.has(candidate.fingerprint) &&
      evidenceMatch !== undefined &&
      !currentIds.has(evidenceMatch.fingerprint)
        ? { ...candidate, fingerprint: evidenceMatch.fingerprint }
        : candidate;
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
        identityAmbiguous: undefined,
        evidenceFingerprint: current.evidenceFingerprint,
        confidence: current.confidence,
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
        identityAmbiguous: undefined,
        evidenceFingerprint: current.evidenceFingerprint,
        confidence: current.confidence,
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
        identityAmbiguous: undefined,
        evidenceFingerprint: current.evidenceFingerprint,
        confidence: current.confidence,
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
        evidenceFingerprint: current.evidenceFingerprint,
        confidence: current.confidence,
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
  const reviewedFiles = new Set(input.coverage.reviewedFiles);
  const pullRequestFiles = new Set(input.coverage.pullRequestFiles);

  for (const existing of input.baselineFindings) {
    if (handledFingerprints.has(existing.fingerprint)) {
      continue;
    }

    if (ambiguousBaselineIds.has(existing.fingerprint)) {
      updatedTrackedMap.set(existing.fingerprint, existing);
      if (["new", "persistent", "reintroduced"].includes(existing.status))
        unverifiedCount += 1;
      continue;
    }
    if (
      existing.status === "new" ||
      existing.status === "persistent" ||
      existing.status === "reintroduced"
    ) {
      if (
        reviewedFiles.has(existing.filePath) &&
        confirmedResolved.has(existing.fingerprint)
      ) {
        // Silence is not proof of a fix: require a host-verified correction.
        const resolved: TrackedFinding = {
          ...existing,
          status: "resolved",
          updatedAt: now,
        };
        updatedTrackedMap.set(existing.fingerprint, resolved);
        resolvedFindings.push(resolved);
      } else if (
        input.coverage.isComplete &&
        !pullRequestFiles.has(existing.filePath)
      ) {
        // File is no longer in PR diff -> obsolete
        const obsolete: TrackedFinding = {
          ...existing,
          status: "obsolete",
          updatedAt: now,
        };
        updatedTrackedMap.set(existing.fingerprint, obsolete);
        obsoleteFindings.push(obsolete);
      } else {
        // A partial run has no authority to resolve or obsolete findings in
        // files it did not successfully review.
        updatedTrackedMap.set(existing.fingerprint, existing);
        unverifiedCount += 1;
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
    ...(unverifiedCount > 0 ? { unverifiedCount } : {}),
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
