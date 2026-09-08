import { describe, expect, it } from "vitest";

import {
  computeEvidenceFingerprint,
  computeStableFingerprint,
} from "../src/fingerprint.js";
import {
  reconcileFindings,
  type FindingWithFingerprint,
  type TrackedFinding,
} from "../src/lifecycle.js";

const prKey = "github:100:pr:42" as const;
const sha = "1".repeat(40);
const runId = `${prKey}:head:${sha}` as const;
const evidence = [
  {
    excerpt: "return user.name;",
    path: "src/user.ts",
    startLine: 12,
    reason: "User can be null",
  },
];
async function finding(diagnostic: string): Promise<FindingWithFingerprint> {
  return {
    confidence: 0.95,
    diagnostic,
    evidence,
    fingerprint: await computeStableFingerprint({
      diagnostic,
      excerpt: evidence[0]!.excerpt,
      path: "src/user.ts",
    }),
    evidenceFingerprint: await computeEvidenceFingerprint(
      "src/user.ts",
      evidence,
    ),
    location: { path: "src/user.ts", line: 12, side: "RIGHT" },
    severity: "high",
  };
}
function reconcile(
  currentFindings: readonly FindingWithFingerprint[],
  baselineFindings: readonly TrackedFinding[],
  confirmedResolvedFingerprints: readonly string[] = [],
) {
  return reconcileFindings({
    currentFindings,
    baselineFindings,
    currentHeadSha: sha,
    currentRunId: runId,
    prKey,
    coverage: {
      isComplete: true,
      reviewedFiles: ["src/user.ts"],
      pullRequestFiles: ["src/user.ts"],
      confirmedResolvedFingerprints,
    },
  });
}
describe("re-review evidence and human decisions", () => {
  it("retains identity and dismissal across a unique evidence match with reworded prose", async () => {
    const original = await finding(
      "A null user causes this property access to throw.",
    );
    const baseline = reconcile([original], []).updatedTrackedFindings.map(
      (f) => ({ ...f, status: "dismissed" as const, githubCommentId: 99 }),
    );
    const paraphrase = await finding(
      "Reading this property crashes when the user is null.",
    );
    const result = reconcile([paraphrase], baseline);
    expect(result.activeFindings).toHaveLength(0);
    expect(result.dismissedFindings[0]?.fingerprint).toBe(original.fingerprint);
    expect(result.updatedTrackedFindings[0]?.githubCommentId).toBe(99);
    expect(result.resolvedFindings).toHaveLength(0);
  });
  it("does not claim resolution from silence or ambiguous evidence", async () => {
    const original = await finding(
      "A null user causes this property access to throw.",
    );
    const baseline = reconcile([original], []).updatedTrackedFindings;
    const silent = reconcile([], baseline);
    expect(silent.resolvedFindings).toHaveLength(0);
    expect(silent.summary.unverifiedCount).toBe(1);
    const ambiguous = reconcile(
      [
        await finding(
          "Another defect at this evidence with a different cause.",
        ),
        await finding(
          "A third defect at this evidence with yet another cause.",
        ),
      ],
      baseline,
    );
    expect(ambiguous.summary.persistentCount).toBe(0);
    expect(ambiguous.summary.unverifiedCount).toBe(1);
  });
  it("resolves only a host-confirmed fingerprint from a successfully reviewed file", async () => {
    const original = await finding(
      "A null user causes this property access to throw.",
    );
    const baseline = reconcile([original], []).updatedTrackedFindings;
    expect(
      reconcile([], baseline, [original.fingerprint]).resolvedFindings,
    ).toHaveLength(1);
  });
});
