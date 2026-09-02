import { describe, expect, it } from "vitest";

import { aggregateShardReviews, formatCheckRunOutput } from "../src/index.js";

describe("aggregateShardReviews", () => {
  const fileA = {
    mode: "structural" as const,
    patch:
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -10,1 +10,1 @@\n-old\n+const value = calculate();\n",
    path: "src/a.ts",
  };
  const fileB = {
    mode: "structural" as const,
    patch:
      "diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -20,1 +20,1 @@\n-old\n+const handler = process(item);\n",
    path: "src/b.ts",
  };

  const shard0 = {
    byteLength: 200,
    changedLines: [{ line: 10, path: "src/a.ts", side: "RIGHT" as const }],
    files: [fileA],
    id: "shard-0",
    index: 0,
    totalShards: 2,
  };

  const shard1 = {
    byteLength: 200,
    changedLines: [{ line: 20, path: "src/b.ts", side: "RIGHT" as const }],
    files: [fileB],
    id: "shard-1",
    index: 1,
    totalShards: 2,
  };

  const plan = {
    omissionReasons: [],
    schemaVersion: 2 as const,
    scopeStatus: "complete" as const,
    shards: [shard0, shard1],
    totalEligibleBytes: 400,
    totalEligibleFiles: 2,
    totalEligibleLines: 2,
    unsupportedFilesCount: 0,
  };

  it("handles unsupported review plans", () => {
    const unsupportedPlan = {
      omissionReasons: ["No supported files"],
      schemaVersion: 2 as const,
      scopeStatus: "unsupported" as const,
      shards: [],
      totalEligibleBytes: 0,
      totalEligibleFiles: 0,
      totalEligibleLines: 0,
      unsupportedFilesCount: 1,
    };

    const aggregated = aggregateShardReviews(unsupportedPlan, []);
    expect(aggregated.scopeStatus).toBe("unsupported");
    expect(aggregated.findings).toHaveLength(0);
    expect(aggregated.summary).toContain("No eligible changes were found");
    expect(aggregated.verdict).toBe("COMMENT");
  });

  it("aggregates and deduplicates findings from multiple shards", () => {
    const findingA = {
      confidence: 0.95,
      diagnostic: "Potential null pointer dereference on value calculation.",
      evidence: [
        {
          excerpt: "const value = calculate();",
          path: "src/a.ts",
          reason: "Assigned without check",
          startLine: 10,
        },
      ],
      location: { line: 10, path: "src/a.ts", side: "RIGHT" as const },
      severity: "high" as const,
    };

    const duplicateFindingA = {
      ...findingA,
      confidence: 0.85, // lower confidence duplicate
    };

    const findingB = {
      confidence: 0.9,
      diagnostic: "Handler does not validate input item before execution.",
      evidence: [
        {
          excerpt: "const handler = process(item);",
          path: "src/b.ts",
          reason: "Item is unchecked",
          startLine: 20,
        },
      ],
      location: { line: 20, path: "src/b.ts", side: "RIGHT" as const },
      severity: "medium" as const,
    };

    const shardResults = [
      {
        findings: [findingA, duplicateFindingA],
        shardId: "shard-0",
        shardIndex: 0,
        status: "success" as const,
        summary: "Analyzed module A.",
      },
      {
        findings: [findingB],
        shardId: "shard-1",
        shardIndex: 1,
        status: "success" as const,
        summary: "Analyzed module B.",
      },
    ];

    const aggregated = aggregateShardReviews(plan, shardResults);

    expect(aggregated.scopeStatus).toBe("complete");
    expect(aggregated.shardsAnalyzed).toBe(2);
    expect(aggregated.findings).toHaveLength(2);
    expect(aggregated.verdict).toBe("REQUEST_CHANGES");
    // Verified sorting: high severity findingA comes before medium severity findingB
    expect(aggregated.findings[0]!.diagnostic).toContain(
      "null pointer dereference",
    );
    expect(aggregated.findings[0]!.confidence).toBe(0.95);
    expect(aggregated.findings[1]!.diagnostic).toContain(
      "Handler does not validate",
    );
    expect(aggregated.summary).toContain(
      "Analyzed module A.\n\nAnalyzed module B.",
    );
    expect(aggregated.summary).toContain("Verdict: Changes requested");
  });

  it("handles shard failures with partial_by_failure status", () => {
    const findingA = {
      confidence: 0.95,
      diagnostic: "Potential null pointer dereference on value calculation.",
      evidence: [
        {
          excerpt: "const value = calculate();",
          path: "src/a.ts",
          reason: "Assigned without check",
          startLine: 10,
        },
      ],
      location: { line: 10, path: "src/a.ts", side: "RIGHT" as const },
      severity: "high" as const,
    };

    const shardResults = [
      {
        findings: [findingA],
        shardId: "shard-0",
        shardIndex: 0,
        status: "success" as const,
        summary: "Analyzed module A.",
      },
      {
        errorReason: "Gateway timeout",
        findings: [],
        shardId: "shard-1",
        shardIndex: 1,
        status: "failure" as const,
        summary: "",
      },
    ];

    const aggregated = aggregateShardReviews(plan, shardResults);

    expect(aggregated.scopeStatus).toBe("partial_by_failure");
    expect(aggregated.shardsAnalyzed).toBe(1);
    expect(aggregated.findings).toHaveLength(1);
    expect(aggregated.omissionReasons).toHaveLength(1);
    expect(aggregated.omissionReasons[0]).toContain(
      "Shard 2 (shard-1) failed during analysis: Gateway timeout",
    );
    expect(aggregated.verdict).toBe("COMMENT");
    expect(aggregated.summary).toContain(
      "Partial review: some changes could not be analyzed due to an execution failure.",
    );
    expect(aggregated.summary).toContain("Verdict: Informational Comment");
  });

  it("handles partial_by_policy, low severity observations, sorting by line, and empty summary", () => {
    const fileWithTwoLines = {
      mode: "structural" as const,
      patch:
        "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -10,2 +10,2 @@\n-old\n-old2\n+const value = calculate();\n+const other = 123;\n",
      path: "src/a.ts",
    };
    const policyPlan = {
      ...plan,
      scopeStatus: "partial_by_policy" as const,
      shards: [
        {
          byteLength: 200,
          changedLines: [
            { line: 10, path: "src/a.ts", side: "RIGHT" as const },
            { line: 11, path: "src/a.ts", side: "RIGHT" as const },
          ],
          files: [fileWithTwoLines],
          id: "shard-0",
          index: 0,
          totalShards: 2,
        },
        shard1,
      ],
    };

    const lowFinding1 = {
      confidence: 0.8,
      diagnostic: "Minor typo identified in comment on line 10 of module",
      evidence: [
        {
          excerpt: "const value = calculate();",
          path: "src/a.ts",
          reason: "Comment typo",
          startLine: 10,
        },
      ],
      location: { line: 10, path: "src/a.ts", side: "RIGHT" as const },
      severity: "low" as const,
    };

    const lowFinding2 = {
      confidence: 0.8,
      diagnostic: "Minor typo identified in comment on line 11 of module",
      evidence: [
        {
          excerpt: "const other = 123;",
          path: "src/a.ts",
          reason: "Comment typo",
          startLine: 11,
        },
      ],
      location: { line: 11, path: "src/a.ts", side: "RIGHT" as const },
      severity: "low" as const,
    };

    const shardResults = [
      {
        findings: [lowFinding2, lowFinding1],
        shardId: "shard-0",
        shardIndex: 0,
        status: "success" as const,
        summary: "",
      },
      {
        findings: [],
        shardId: "shard-1",
        shardIndex: 1,
        status: "success" as const,
        summary: "",
      },
    ];

    const aggregated = aggregateShardReviews(policyPlan, shardResults);

    expect(aggregated.scopeStatus).toBe("partial_by_policy");
    expect(aggregated.findings).toHaveLength(2);
    expect(aggregated.findings[0]!.location.line).toBe(10);
    expect(aggregated.findings[1]!.location.line).toBe(11);
    expect(aggregated.summary).toContain("Low-severity observations:");
    expect(aggregated.summary).toContain(
      "Partial review: at least one eligible patch or context section was omitted by a deterministic host budget.",
    );
  });

  it("truncates summary exceeding character limit", () => {
    const longSummary = "x".repeat(5000);
    const shardResults = [
      {
        findings: [],
        shardId: "shard-0",
        shardIndex: 0,
        status: "success" as const,
        summary: longSummary,
      },
    ];

    const aggregated = aggregateShardReviews(plan, shardResults);
    expect(aggregated.summary.length).toBeLessThanOrEqual(4000);
    expect(aggregated.summary.endsWith("…")).toBe(true);
  });

  it("formats check run output for various scopeStatus configurations", () => {
    const formattedPartial = formatCheckRunOutput({
      fileCount: 2,
      findings: [],
      scopeStatus: "partial_by_failure",
      shardsAnalyzed: 1,
      summary: "Some failure.",
      totalShards: 2,
    });
    expect(formattedPartial.title).toBe(
      "Holon Review — Partial review completed",
    );
    expect(formattedPartial.summary).toContain(
      "Scope**: Partial (some changes could not be analyzed due to an execution failure)",
    );

    const formattedUnsupported = formatCheckRunOutput({
      findings: [],
      scopeStatus: "unsupported",
      summary: "Unsupported.",
    });
    expect(formattedUnsupported.title).toBe("Holon Review — No eligible files");
  });

  it("formats check run output with file counts and scope details", () => {
    const formatted = formatCheckRunOutput({
      fileCount: 2,
      findings: [],
      scopeStatus: "complete",
      shardsAnalyzed: 2,
      summary: "All changes completed.",
      totalShards: 2,
    });

    expect(formatted.title).toBe("Holon Review — No regressions found");
    expect(formatted.summary).not.toContain("- **Batches (Shards)**");
    expect(formatted.summary).toContain("- **Files analyzed**: 2");
    expect(formatted.summary).toContain("- **Findings identified**: 0");
  });

  it("emits APPROVE verdict on clean PR with all shards passing", () => {
    const shardResults = [
      {
        findings: [],
        shardId: "shard-0",
        shardIndex: 0,
        status: "success" as const,
        summary: "Clean shard 0.",
      },
      {
        findings: [],
        shardId: "shard-1",
        shardIndex: 1,
        status: "success" as const,
        summary: "Clean shard 1.",
      },
    ];

    const aggregated = aggregateShardReviews(plan, shardResults);
    expect(aggregated.scopeStatus).toBe("complete");
    expect(aggregated.shardsAnalyzed).toBe(2);
    expect(aggregated.findings).toHaveLength(0);
    expect(aggregated.verdict).toBe("APPROVE");
    expect(aggregated.summary).toContain("Verdict: Approved");
  });
});
