import { describe, expect, it } from "vitest";

import type {
  FindingWithFingerprint,
  TrackedFinding,
} from "../src/lifecycle.js";
import { reconcileFindings } from "../src/lifecycle.js";

describe("lifecycle", () => {
  const prKey = "github:100:pr:42" as const;
  const runId1 =
    "github:100:pr:42:head:1111111111111111111111111111111111111111" as const;
  const runId2 =
    "github:100:pr:42:head:2222222222222222222222222222222222222222" as const;
  const sha1 = "1111111111111111111111111111111111111111";
  const sha2 = "2222222222222222222222222222222222222222";

  const finding1: FindingWithFingerprint = {
    confidence: 0.95,
    diagnostic: "SQL injection vulnerability in query builder.",
    evidence: [
      {
        excerpt: "db.query(rawSql)",
        path: "src/db.ts",
        reason: "Unsafe SQL formatting",
        startLine: 20,
      },
    ],
    fingerprint:
      "fp:1111111111111111111111111111111111111111111111111111111111111111",
    location: {
      line: 20,
      path: "src/db.ts",
      side: "RIGHT",
    },
    severity: "high",
  };

  const finding2: FindingWithFingerprint = {
    confidence: 0.9,
    diagnostic: "Missing authentication check on protected route.",
    evidence: [
      {
        excerpt: "app.post('/admin', handler)",
        path: "src/admin.ts",
        reason: "Missing auth middleware",
        startLine: 15,
      },
    ],
    fingerprint:
      "fp:2222222222222222222222222222222222222222222222222222222222222222",
    location: {
      line: 15,
      path: "src/admin.ts",
      side: "RIGHT",
    },
    severity: "critical",
  };

  it("classifies findings as NEW on first review run", () => {
    const result = reconcileFindings({
      baselineFindings: [],
      currentFindings: [finding1],
      currentHeadSha: sha1,
      currentRunId: runId1,
      prFiles: ["src/db.ts"],
      prKey,
      timestamp: "2026-09-02T10:00:00.000Z",
    });

    expect(result.summary).toEqual({
      newCount: 1,
      obsoleteCount: 0,
      persistentCount: 0,
      reintroducedCount: 0,
      resolvedCount: 0,
      totalActiveCount: 1,
    });

    expect(result.activeFindings).toHaveLength(1);
    expect(result.activeFindings[0]?.status).toBe("new");
    expect(result.activeFindings[0]?.firstSeenHeadSha).toBe(sha1);
    expect(result.activeFindings[0]?.previousCommentId).toBeUndefined();

    expect(result.updatedTrackedFindings).toHaveLength(1);
    expect(result.updatedTrackedFindings[0]?.status).toBe("new");
    expect(result.updatedTrackedFindings[0]?.firstSeenHeadSha).toBe(sha1);
    expect(result.updatedTrackedFindings[0]?.firstSeenRunId).toBe(runId1);
  });

  it("classifies unfixed finding as PERSISTENT on subsequent commit and preserves commentId", () => {
    const tracked1: TrackedFinding = {
      diagnostic: finding1.diagnostic,
      filePath: finding1.location.path,
      fingerprint: finding1.fingerprint,
      firstSeenHeadSha: sha1,
      firstSeenRunId: runId1,
      githubCommentId: 9999,
      lastSeenHeadSha: sha1,
      lastSeenRunId: runId1,
      line: 20,
      prKey,
      severity: finding1.severity,
      status: "new",
      updatedAt: "2026-09-02T10:00:00.000Z",
    };

    // On commit 2, finding1 moved to line 25, but same fingerprint
    const finding1Moved: FindingWithFingerprint = {
      ...finding1,
      location: { ...finding1.location, line: 25 },
    };

    const result = reconcileFindings({
      baselineFindings: [tracked1],
      currentFindings: [finding1Moved],
      currentHeadSha: sha2,
      currentRunId: runId2,
      prFiles: ["src/db.ts"],
      prKey,
      timestamp: "2026-09-02T11:00:00.000Z",
    });

    expect(result.summary).toEqual({
      newCount: 0,
      obsoleteCount: 0,
      persistentCount: 1,
      reintroducedCount: 0,
      resolvedCount: 0,
      totalActiveCount: 1,
    });

    expect(result.activeFindings[0]?.status).toBe("persistent");
    expect(result.activeFindings[0]?.previousCommentId).toBe(9999);
    expect(result.activeFindings[0]?.firstSeenHeadSha).toBe(sha1);
    expect(result.activeFindings[0]?.location.line).toBe(25);

    expect(result.updatedTrackedFindings[0]?.status).toBe("persistent");
    expect(result.updatedTrackedFindings[0]?.lastSeenHeadSha).toBe(sha2);
    expect(result.updatedTrackedFindings[0]?.line).toBe(25);
    expect(result.updatedTrackedFindings[0]?.githubCommentId).toBe(9999);
  });

  it("classifies missing finding as RESOLVED if file is still touched by PR", () => {
    const tracked1: TrackedFinding = {
      diagnostic: finding1.diagnostic,
      filePath: finding1.location.path,
      fingerprint: finding1.fingerprint,
      firstSeenHeadSha: sha1,
      firstSeenRunId: runId1,
      githubCommentId: 9999,
      lastSeenHeadSha: sha1,
      lastSeenRunId: runId1,
      line: 20,
      prKey,
      severity: finding1.severity,
      status: "new",
      updatedAt: "2026-09-02T10:00:00.000Z",
    };

    // On commit 2, finding1 is fixed (no current findings), but src/db.ts is still modified in PR
    const result = reconcileFindings({
      baselineFindings: [tracked1],
      currentFindings: [],
      currentHeadSha: sha2,
      currentRunId: runId2,
      prFiles: ["src/db.ts"],
      prKey,
      timestamp: "2026-09-02T11:00:00.000Z",
    });

    expect(result.summary).toEqual({
      newCount: 0,
      obsoleteCount: 0,
      persistentCount: 0,
      reintroducedCount: 0,
      resolvedCount: 1,
      totalActiveCount: 0,
    });

    expect(result.activeFindings).toHaveLength(0);
    expect(result.resolvedFindings).toHaveLength(1);
    expect(result.resolvedFindings[0]?.fingerprint).toBe(finding1.fingerprint);
    expect(result.resolvedFindings[0]?.status).toBe("resolved");
    expect(result.resolvedFindings[0]?.githubCommentId).toBe(9999);
  });

  it("classifies missing finding as OBSOLETE if file is no longer touched by PR", () => {
    const tracked1: TrackedFinding = {
      diagnostic: finding1.diagnostic,
      filePath: finding1.location.path,
      fingerprint: finding1.fingerprint,
      firstSeenHeadSha: sha1,
      firstSeenRunId: runId1,
      githubCommentId: 9999,
      lastSeenHeadSha: sha1,
      lastSeenRunId: runId1,
      line: 20,
      prKey,
      severity: finding1.severity,
      status: "persistent",
      updatedAt: "2026-09-02T10:00:00.000Z",
    };

    // src/db.ts was removed from PR diff (e.g. reverted)
    const result = reconcileFindings({
      baselineFindings: [tracked1],
      currentFindings: [],
      currentHeadSha: sha2,
      currentRunId: runId2,
      prFiles: ["src/other.ts"],
      prKey,
      timestamp: "2026-09-02T11:00:00.000Z",
    });

    expect(result.summary).toEqual({
      newCount: 0,
      obsoleteCount: 1,
      persistentCount: 0,
      reintroducedCount: 0,
      resolvedCount: 0,
      totalActiveCount: 0,
    });

    expect(result.obsoleteFindings).toHaveLength(1);
    expect(result.obsoleteFindings[0]?.status).toBe("obsolete");
  });

  it("classifies previously RESOLVED finding as REINTRODUCED when it reappears", () => {
    const trackedResolved: TrackedFinding = {
      diagnostic: finding1.diagnostic,
      filePath: finding1.location.path,
      fingerprint: finding1.fingerprint,
      firstSeenHeadSha: sha1,
      firstSeenRunId: runId1,
      githubCommentId: 9999,
      lastSeenHeadSha: sha1,
      lastSeenRunId: runId1,
      line: 20,
      prKey,
      severity: finding1.severity,
      status: "resolved",
      updatedAt: "2026-09-02T10:30:00.000Z",
    };

    const result = reconcileFindings({
      baselineFindings: [trackedResolved],
      currentFindings: [finding1],
      currentHeadSha: sha2,
      currentRunId: runId2,
      prFiles: ["src/db.ts"],
      prKey,
      timestamp: "2026-09-02T11:00:00.000Z",
    });

    expect(result.summary).toEqual({
      newCount: 0,
      obsoleteCount: 0,
      persistentCount: 0,
      reintroducedCount: 1,
      resolvedCount: 0,
      totalActiveCount: 1,
    });

    expect(result.activeFindings[0]?.status).toBe("reintroduced");
    expect(result.activeFindings[0]?.previousCommentId).toBe(9999);
    expect(result.activeFindings[0]?.firstSeenHeadSha).toBe(sha1);
  });

  it("handles complex mixed batch: persistent, new, and resolved findings simultaneously", () => {
    const tracked1: TrackedFinding = {
      diagnostic: finding1.diagnostic,
      filePath: finding1.location.path,
      fingerprint: finding1.fingerprint,
      firstSeenHeadSha: sha1,
      firstSeenRunId: runId1,
      githubCommentId: 1001,
      lastSeenHeadSha: sha1,
      lastSeenRunId: runId1,
      line: 20,
      prKey,
      severity: finding1.severity,
      status: "persistent",
      updatedAt: "2026-09-02T10:00:00.000Z",
    };

    const oldFindingFingerprint =
      "fp:9999999999999999999999999999999999999999999999999999999999999999";
    const trackedOldFixed: TrackedFinding = {
      diagnostic: "Hardcoded credential in secret.ts.",
      filePath: "src/secret.ts",
      fingerprint: oldFindingFingerprint,
      firstSeenHeadSha: sha1,
      firstSeenRunId: runId1,
      githubCommentId: 1002,
      lastSeenHeadSha: sha1,
      lastSeenRunId: runId1,
      line: 5,
      prKey,
      severity: "critical",
      status: "persistent",
      updatedAt: "2026-09-02T10:00:00.000Z",
    };

    // Current has:
    // - finding1 (persistent)
    // - finding2 (new)
    // and trackedOldFixed is fixed in src/secret.ts (which is still in prFiles)
    const result = reconcileFindings({
      baselineFindings: [tracked1, trackedOldFixed],
      currentFindings: [finding1, finding2],
      currentHeadSha: sha2,
      currentRunId: runId2,
      prFiles: ["src/db.ts", "src/admin.ts", "src/secret.ts"],
      prKey,
      timestamp: "2026-09-02T11:00:00.000Z",
    });

    expect(result.summary).toEqual({
      newCount: 1,
      obsoleteCount: 0,
      persistentCount: 1,
      reintroducedCount: 0,
      resolvedCount: 1,
      totalActiveCount: 2,
    });

    expect(result.resolvedFindings).toHaveLength(1);
    expect(result.resolvedFindings[0]?.fingerprint).toBe(oldFindingFingerprint);

    const persistent = result.activeFindings.find(
      (f) => f.fingerprint === finding1.fingerprint,
    );
    expect(persistent?.status).toBe("persistent");
    expect(persistent?.previousCommentId).toBe(1001);

    const newFinding = result.activeFindings.find(
      (f) => f.fingerprint === finding2.fingerprint,
    );
    expect(newFinding?.status).toBe("new");
    expect(newFinding?.previousCommentId).toBeUndefined();
  });
});
