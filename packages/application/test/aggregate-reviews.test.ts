import { describe, expect, it } from "vitest";

import {
  aggregateShardReviews,
  formatCheckRunOutput,
  formatReconciliationSection,
  formatStructuralImpactSection,
} from "../src/index.js";

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
    scopeStatus: "complete" as const,
    shards: [shard0, shard1],
    totalEligibleBytes: 400,
    totalEligibleFiles: 2,
    totalEligibleLines: 2,
    unsupportedFilesCount: 0,
  };

  it.each(["partial_by_policy", "partial_by_failure", "degraded"] as const)(
    "does not publish a model's global all-clear for an incomplete review: %s",
    (mode) => {
      const result = aggregateShardReviews(
        {
          ...plan,
          scopeStatus: mode === "partial_by_policy" ? mode : "complete",
        },
        [
          {
            findings: [],
            shardId: "shard-0",
            shardIndex: 0,
            status: "success",
            summary: "No regressions exist anywhere in this PR.",
            isDegraded: mode === "degraded",
          },
          {
            findings: [],
            shardId: "shard-1",
            shardIndex: 1,
            status: mode === "partial_by_failure" ? "failure" : "success",
            summary: "The whole PR is safe.",
          },
        ],
        {
          unifiedSummary:
            "All changes are documentation only and safe to merge.",
        },
      );
      expect(result.summary).not.toContain("safe to merge");
      expect(result.summary).not.toContain("No regressions exist");
      expect(result.summary).toContain("incomplete");
      expect(result.summary).toContain("0 verified finding");
      expect(result.verdict).toBe("COMMENT");
    },
  );

  it("handles unsupported review plans", () => {
    const unsupportedPlan = {
      omissionReasons: [{ code: "unsupported" as const }],
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

  it("preserves failure coverage regardless of shard order when context is also omitted", () => {
    const results = [
      {
        findings: [],
        summary: "",
        status: "failure" as const,
        shardId: "shard-0",
        shardIndex: 0,
      },
      {
        findings: [],
        summary: "Partial context",
        status: "success" as const,
        shardId: "shard-1",
        shardIndex: 1,
        outputLimitations: ["input_context_omitted" as const],
      },
    ];
    for (const shards of [results, results.toReversed()]) {
      expect(aggregateShardReviews(plan, shards).scopeStatus).toBe(
        "partial_by_failure",
      );
    }
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
    const longSummary = "x".repeat(20_000);
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
    expect(aggregated.summary.length).toBeLessThanOrEqual(16_000);
    expect(aggregated.summary).toContain("publication budget");
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

  describe("reconciliation formatting", () => {
    it("formats reconciliation summary section correctly", () => {
      const summary = {
        dismissedCount: 0,
        newCount: 1,
        obsoleteCount: 0,
        persistentCount: 2,
        reintroducedCount: 1,
        resolvedCount: 3,
        totalActiveCount: 4,
      };

      const section = formatReconciliationSection(summary);
      expect(section).toContain("Finding Lifecycle (Re-review)");
      expect(section).toContain("✅ **3** issue(s) resolved");
      expect(section).toContain("⚠️ **2** issue(s) persistent");
      expect(section).toContain("🆕 **1** new issue(s) detected");
      expect(section).toContain("🔁 **1** issue(s) reintroduced");
    });

    it("returns empty string when all counts are 0", () => {
      const summary = {
        dismissedCount: 0,
        newCount: 0,
        obsoleteCount: 0,
        persistentCount: 0,
        reintroducedCount: 0,
        resolvedCount: 0,
        totalActiveCount: 0,
      };
      expect(formatReconciliationSection(summary)).toBe("");
    });

    it("formats dismissed count in reconciliation summary section", () => {
      const summary = {
        dismissedCount: 2,
        newCount: 0,
        obsoleteCount: 0,
        persistentCount: 0,
        reintroducedCount: 0,
        resolvedCount: 0,
        totalActiveCount: 0,
      };
      const section = formatReconciliationSection(summary);
      expect(section).toContain(
        "🚫 **2** issue(s) dismissed by human feedback",
      );
    });

    it("injects reconciliation section into aggregated summary when provided", () => {
      const shardResults = [
        {
          findings: [],
          shardId: "shard-0",
          shardIndex: 0,
          status: "success" as const,
          summary: "Shard 0 clean.",
        },
      ];

      const reconciliation = {
        dismissedCount: 0,
        newCount: 0,
        obsoleteCount: 0,
        persistentCount: 0,
        reintroducedCount: 0,
        resolvedCount: 2,
        totalActiveCount: 0,
      };

      const aggregated = aggregateShardReviews(plan, shardResults, {
        reconciliation,
      });

      expect(aggregated.reconciliation).toEqual(reconciliation);
      expect(aggregated.summary).toContain("Finding Lifecycle (Re-review)");
      expect(aggregated.summary).toContain("✅ **2** issue(s) resolved");
    });
  });

  describe("formatStructuralImpactSection", () => {
    it("formats all parts of structural impact report cleanly", () => {
      const report = {
        changedSymbols: [
          {
            change: "modified" as const,
            isExported: true,
            kind: "function" as const,
            line: 10,
            name: "updateUser",
            path: "src/user.ts",
          },
        ],
        contractBreaks: [
          {
            description: "Exported function 'deleteUser' was removed",
            kind: "exported_symbol_removed" as const,
            line: 5,
            path: "src/user.ts",
            severity: "critical" as const,
          },
        ],
        downstreamReferences: [
          {
            callerLine: 30,
            callerPath: "src/api.ts",
            excerpt: "updateUser(data)",
            symbolName: "updateUser",
            targetPath: "src/user.ts",
          },
        ],
        securitySurfaces: [],
        testGaps: [
          {
            expectedTestPathPattern: "src/user.test.ts",
            reason: "no_test_file_modified" as const,
            sourcePath: "src/user.ts",
          },
        ],
        totalDownstreamReferencesCount: 1,
      };

      const formatted = formatStructuralImpactSection(report);
      expect(formatted).toContain("### 🏛️ Structural Impact Analysis");
      expect(formatted).toContain("Contract Investigation Leads");
      expect(formatted).toContain("Exported symbol removed (src/user.ts:5)");
      expect(formatted).toContain("Symbols Modified");
      expect(formatted).toContain("Downstream Impact Radius");
      expect(formatted).toContain("Test Gaps");
    });

    it("returns empty string when report has no impactful changes", () => {
      const emptyReport = {
        changedSymbols: [],
        contractBreaks: [],
        downstreamReferences: [],
        securitySurfaces: [],
        testGaps: [],
        totalDownstreamReferencesCount: 0,
      };
      expect(formatStructuralImpactSection(emptyReport)).toBe("");
    });

    it("makes an incomplete repository scan explicit", () => {
      const formatted = formatStructuralImpactSection({
        changedSymbols: [],
        contractBreaks: [],
        downstreamReferences: [],
        repositoryScanTruncated: true,
        securitySurfaces: [],
        testGaps: [],
      });

      expect(formatted).toContain("Repository Scan");
      expect(formatted).toContain("absence of references is inconclusive");
    });

    it("injects structural impact section into aggregated summary when provided", () => {
      const shardResults = [
        {
          findings: [],
          shardId: "shard-0",
          shardIndex: 0,
          status: "success" as const,
          summary: "Clean review.",
        },
      ];

      const report = {
        changedSymbols: [
          {
            change: "added" as const,
            isExported: true,
            kind: "function" as const,
            line: 1,
            name: "init",
            path: "src/init.ts",
          },
        ],
        contractBreaks: [],
        downstreamReferences: [],
        securitySurfaces: [],
        testGaps: [],
      };

      const aggregated = aggregateShardReviews(plan, shardResults, {
        structuralImpact: report,
      });

      expect(aggregated.summary).toContain("Structural Impact Analysis");
      expect(aggregated.summary).toContain("Symbols Modified");
    });

    it("handles unexported symbols and fallback downstream references count", () => {
      const report = {
        changedSymbols: [
          {
            change: "modified" as const,
            isExported: false,
            kind: "variable" as const,
            line: 5,
            name: "localVal",
            path: "src/local.ts",
          },
        ],
        contractBreaks: [],
        downstreamReferences: [
          {
            callerLine: 10,
            callerPath: "src/b.ts",
            excerpt: "ref",
            symbolName: "sym",
            targetPath: "src/a.ts",
          },
        ],
        securitySurfaces: [],
        testGaps: [],
      };

      const formatted = formatStructuralImpactSection(report);
      expect(formatted).toContain("exported: 0");
      expect(formatted).toContain(
        "1 reference(s) across repository outside PR",
      );

      const emptyReport = {
        changedSymbols: [],
        contractBreaks: [],
        downstreamReferences: [],
        securitySurfaces: [],
        testGaps: [],
      };
      const aggregatedWithEmpty = aggregateShardReviews(
        plan,
        [
          {
            findings: [],
            shardId: "s0",
            shardIndex: 0,
            status: "success",
            summary: "",
          },
        ],
        { structuralImpact: emptyReport },
      );
      expect(aggregatedWithEmpty.summary).not.toContain(
        "Structural Impact Analysis",
      );
    });

    it("propagates isDegraded and sets verdict to COMMENT with notice instead of APPROVE", () => {
      const shardResults = [
        {
          findings: [],
          isDegraded: true,
          shardId: "shard-0",
          shardIndex: 0,
          status: "success" as const,
          summary: "Investigation notes...",
        },
      ];

      const singleShardPlan = { ...plan, shards: [plan.shards[0]!] };
      const aggregated = aggregateShardReviews(singleShardPlan, shardResults);

      expect(aggregated.isDegraded).toBe(true);
      expect(aggregated.verdict).toBe("COMMENT");
      expect(aggregated.summary).toContain("Verdict: Informational Comment");
      expect(aggregated.summary).toContain(
        "The model analysis completed without structured output",
      );
      expect(aggregated.summary).not.toContain("All reviewed files clean");
    });

    it("derives the final verdict only from lifecycle-active findings", () => {
      const rawFinding = {
        confidence: 0.95,
        diagnostic:
          "This verified defect should be removed by lifecycle state.",
        evidence: [
          {
            excerpt: "const value = calculate();",
            path: "src/a.ts",
            reason: "The changed value violates the contract",
            startLine: 10,
          },
        ],
        location: { line: 10, path: "src/a.ts", side: "RIGHT" as const },
        severity: "high" as const,
      };
      const shardResults = [
        {
          findings: [rawFinding],
          shardId: "shard-0",
          shardIndex: 0,
          status: "success" as const,
          summary: "A finding was reviewed.",
        },
        {
          findings: [],
          shardId: "shard-1",
          shardIndex: 1,
          status: "success" as const,
          summary: "The second shard was reviewed.",
        },
      ];

      const aggregated = aggregateShardReviews(plan, shardResults, {
        canonicalFindings: [],
      });

      expect(aggregated.findings).toEqual([]);
      expect(aggregated.verdict).toBe("APPROVE");
    });
  });
});
