import {
  reviewJobSchema,
  type ModelReviewOutput,
  type ReviewShardContext,
} from "@holon/contracts";
import { describe, expect, it } from "vitest";

import {
  composeReviewSummary,
  createReviewRun,
  renderFinding,
  selectValidFindings,
} from "../src/index.js";

const sha = "a".repeat(40);
const receivedAt = "2026-08-29T12:00:01.000Z";
const updatedAt = "2026-08-29T12:00:00.000Z";
const envelope = {
  action: "opened",
  deliveryId: "github:delivery-123",
  event: "pull_request",
  installationId: 99,
  receivedAt,
  repository: { fullName: "acme/api", id: 42, name: "api", owner: "acme" },
} as const;
const runId = `github:42:pr:7:head:${sha}:base:${"b".repeat(40)}`;
const job = reviewJobSchema.parse({
  envelope: {
    ...envelope,
    pullRequest: {
      baseSha: "b".repeat(40),
      headSha: sha,
      number: 7,
      updatedAt,
    },
  },
  runId,
});
const context: ReviewShardContext = {
  changedLines: [{ line: 10, path: "src/index.ts", side: "RIGHT" }],
  files: [
    {
      mode: "structural",
      patch: [
        "diff --git a/src/index.ts b/src/index.ts",
        "--- a/src/index.ts",
        "+++ b/src/index.ts",
        "@@ -9,0 +10,1 @@",
        "+return null;",
        "",
      ].join("\n"),
      path: "src/index.ts",
    },
  ],
  truncated: false,
};
const output: ModelReviewOutput = {
  findings: [
    {
      confidence: 0.95,
      diagnostic: "The caller dereferences this newly nullable result.",
      evidence: [
        {
          excerpt: "return null;",
          path: "src/index.ts",
          reason: "The changed implementation introduces the nullable value",
          startLine: 10,
        },
      ],
      location: { line: 10, path: "src/index.ts", side: "RIGHT" },
      severity: "high",
      suggestion: "Keep the result non-null or guard every caller.",
    },
  ],
  summary: "One nullable contract regression was found.",
};

describe("review application policies", () => {
  it("localizes labels and preserves evidence bytes", () => {
    const finding = {
      ...output.findings[0]!,
      evidence: [
        {
          ...output.findings[0]!.evidence[0]!,
          excerpt: "if (x) {\n  return null;\n}",
        },
      ],
    };
    expect(renderFinding(finding, "pt-BR")).toContain("Ação sugerida:");
    expect(renderFinding(finding, "es")).toContain("Evidencia:");
    expect(renderFinding(finding, "pt-BR")).toContain(
      finding.evidence[0]!.excerpt,
    );
  });
  it("uses the required GitHub causal timestamp", () => {
    expect(createReviewRun(job).causalVersion).toBe(updatedAt);
  });

  it("renders the diagnostic, suggestion and host-verified evidence", () => {
    const [finding] = selectValidFindings(output.findings, context);
    expect(finding).toBeDefined();
    expect(renderFinding(finding!)).toContain("Suggested action:");
    expect(renderFinding(finding!)).toContain("Evidence:");
    expect(renderFinding(finding!)).toContain("src/index.ts:10");
  });

  it("renders a valid finding without an optional suggestion", () => {
    const { suggestion: _suggestion, ...candidate } = output.findings[0]!;
    const [finding] = selectValidFindings([candidate], context);
    expect(renderFinding(finding!)).not.toContain("Suggested action:");
  });

  it("rejects a finding that is not anchored to a changed line", () => {
    const candidate = {
      ...output.findings[0]!,
      location: { line: 999, path: "src/index.ts", side: "RIGHT" as const },
    };
    expect(selectValidFindings([candidate], context)).toEqual([]);
  });

  it("rejects evidence absent from the canonical patch", () => {
    const candidate = {
      ...output.findings[0]!,
      evidence: [
        {
          excerpt: "result.id",
          path: "src/caller.ts",
          reason: "This text was present only in a tool response",
          startLine: 30,
        },
      ],
    };
    expect(selectValidFindings([candidate], context)).toEqual([]);
  });

  it("requires every evidence line to be present within a bounded canonical range", () => {
    const candidate = output.findings[0]!;
    expect(
      selectValidFindings(
        [
          {
            ...candidate,
            evidence: [
              {
                ...candidate.evidence[0]!,
                endLine: 511,
              },
            ],
          },
        ],
        context,
      ),
    ).toEqual([]);
    expect(
      selectValidFindings(
        [
          {
            ...candidate,
            evidence: [{ ...candidate.evidence[0]!, excerpt: "   " }],
          },
        ],
        context,
      ),
    ).toEqual([]);
  });

  it("moves valid low-severity findings to a bounded partial summary", () => {
    const [finding] = selectValidFindings(output.findings, context);
    const summary = composeReviewSummary(
      "Review completed.",
      [{ ...finding!, severity: "low" }],
      true,
    );
    expect(summary).toContain("Partial review:");
    expect(summary).toContain("Low-severity observations:");
    expect(Array.from(summary).length).toBeLessThanOrEqual(4_000);
  });

  it("limits summaries by Unicode code points", () => {
    const summary = composeReviewSummary("😀".repeat(12_000), [], false);
    expect(summary.length).toBeLessThanOrEqual(16_000);
    expect(summary.isWellFormed()).toBe(true);
    expect(summary).toContain("publication budget");
  });
});
