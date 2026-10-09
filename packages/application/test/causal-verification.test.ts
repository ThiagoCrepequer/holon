import { modelReviewOutputSchema, reviewTextLimits } from "@holon/contracts";
import { expect, it } from "vitest";

import {
  applyCausalVerification,
  aggregateShardReviews,
  withholdUnverifiedFindings,
} from "../src/index.js";

const finding = {
  confidence: 0.95,
  diagnostic:
    "Returning null causes an unguarded caller to dereference the result.",
  evidence: [
    {
      excerpt: "return null;",
      path: "src/result.ts",
      reason: "A reachable branch returns null.",
      startLine: 10,
    },
  ],
  location: { line: 10, path: "src/result.ts", side: "RIGHT" as const },
  severity: "high" as const,
};
const draft = modelReviewOutputSchema.parse({
  findings: [finding],
  summary: "The caller will crash on null.",
});
const assessment = {
  basis: "patch" as const,
  evidenceReceiptIds: [],
  candidateIndex: 0,
  outcome: "confirmed" as const,
  confidence: 0.9,
  rationale:
    "The caller immediately dereferences the result on the reachable null branch without a guard.",
};

it("withholds malformed verifier output instead of accepting an unverified draft", () => {
  const result = applyCausalVerification(draft, {
    assessments: [{ ...assessment, finding }],
    summary: "A new finding should be published.",
  });
  expect(result.findings).toEqual([]);
  expect(result.isDegraded).toBe(true);
  expect(result.outputLimitations).toContain("causal_verification_incomplete");
  expect(result.summary).not.toContain("will crash");
});

it("keeps the explicit incomplete warning within the summary limit", () => {
  const result = applyCausalVerification(
    draft,
    {
      assessments: [{ ...assessment, outcome: "inconclusive" }],
      summary: "s".repeat(reviewTextLimits.summary),
    },
    "pt-BR",
  );
  expect(result.findings).toEqual([]);
  expect(result.summary.length).toBeLessThanOrEqual(reviewTextLimits.summary);
  expect(result.summary).toContain("verificação causal ficou incompleta");
  expect(result.outputLimitations).toContain("summary_truncated");
});

it("publishes only confirmed candidates while preserving their diagnostic, evidence and confidence ceiling", () => {
  const candidates = {
    ...draft,
    findings: [
      finding,
      { ...finding, diagnostic: "A second candidate has a guarded caller." },
    ],
  };
  const result = applyCausalVerification(candidates, {
    assessments: [
      { ...assessment, candidateIndex: 1, outcome: "refuted" },
      assessment,
    ],
    summary: "Only the first caller dereferences null without a guard.",
  });
  expect(result.findings).toEqual([{ ...finding, confidence: 0.9 }]);
  expect(result.isDegraded).not.toBe(true);
  expect(
    applyCausalVerification(draft, {
      assessments: [{ ...assessment, confidence: 0.99 }],
      summary: "Confirmed.",
    }).findings[0]?.confidence,
  ).toBe(finding.confidence);
});

it.each([
  { assessments: [] },
  { assessments: [assessment, assessment] },
  { assessments: [{ ...assessment, candidateIndex: 1 }] },
])(
  "withholds the whole draft when candidate matching is not exhaustive and unique: %j",
  ({ assessments }) => {
    const result = applyCausalVerification(draft, {
      assessments,
      summary: "All clear.",
    });
    expect(result.findings).toEqual([]);
    expect(result.isDegraded).toBe(true);
    expect(result.summary).not.toContain("All clear");
  },
);

it.each([
  { outcome: "inconclusive", confidence: 0.99 },
  { outcome: "confirmed", confidence: 0.79 },
  { outcome: "refuted", confidence: 0.79 },
])(
  "retains verified findings but marks uncertainty partial: %j",
  (uncertain) => {
    const result = applyCausalVerification(
      { ...draft, findings: [finding, finding] },
      {
        assessments: [
          assessment,
          { ...assessment, candidateIndex: 1, ...uncertain },
        ],
        summary:
          "The first candidate was confirmed; the second could not be established.",
      },
    );
    expect(result.findings).toEqual([{ ...finding, confidence: 0.9 }]);
    expect(result.isDegraded).toBe(true);
    expect(result.outputLimitations).toContain(
      "causal_verification_incomplete",
    );
  },
);

it("does not clear earlier limitations when every candidate is confidently refuted", () => {
  const result = applyCausalVerification(
    {
      ...draft,
      isDegraded: true,
      outputLimitations: ["input_context_omitted"],
    },
    {
      assessments: [{ ...assessment, outcome: "refuted" }],
      summary: "The inspected caller checks null before accessing properties.",
    },
  );
  expect(result.findings).toEqual([]);
  expect(result.isDegraded).toBe(true);
  expect(result.outputLimitations).toEqual(["input_context_omitted"]);
});

it.each(["en", "pt-BR", "es"] as const)(
  "explains withheld candidates in %s without duplicating limitations",
  (language) => {
    const result = withholdUnverifiedFindings(
      {
        ...draft,
        outputLimitations: ["causal_verification_incomplete"],
      },
      language,
    );
    expect(result.findings).toEqual([]);
    expect(result.outputLimitations).toEqual([
      "causal_verification_incomplete",
    ]);
    expect(result.summary).toContain(
      language === "en" ? "incomplete" : "incompleta",
    );
  },
);

it("cannot approve a complete diff with zero findings when causal verification is incomplete", () => {
  const result = withholdUnverifiedFindings(draft);
  const aggregated = aggregateShardReviews(
    {
      omissionReasons: [],
      scopeStatus: "complete",
      shards: [
        {
          byteLength: 100,
          changedLines: [{ ...finding.location }],
          files: [
            {
              path: "src/result.ts",
              mode: "structural",
              patch: "@@ -9,0 +10 @@\n+return null;",
            },
          ],
          id: "shard-0",
          index: 0,
          totalShards: 1,
        },
      ],
      totalEligibleBytes: 100,
      totalEligibleFiles: 1,
      totalEligibleLines: 1,
      unsupportedFilesCount: 0,
    },
    [{ ...result, shardId: "shard-0", shardIndex: 0, status: "success" }],
  );
  expect(aggregated.verdict).toBe("COMMENT");
  expect(aggregated.isDegraded).toBe(true);
  expect(aggregated.omissionReasons.join(" ")).toContain(
    "causal_verification_incomplete",
  );
});

const receipt = {
  id: "a".repeat(64),
  digest: "c".repeat(64),
  runId: `github:42:pr:7:head:${"d".repeat(40)}:base:${"e".repeat(40)}`,
  headSha: "d".repeat(40),
  path: "src/caller.ts",
  startLine: 1,
  endLine: 2,
  truncated: false,
};
const repositoryAnswer = {
  assessments: [
    { ...assessment, basis: "repository", evidenceReceiptIds: [receipt.id] },
  ],
  summary: "Inspected the caller.",
};
it("withholds a repository claim whose receipt was never inspected", () => {
  expect(applyCausalVerification(draft, repositoryAnswer).findings).toEqual([]);
  expect(
    applyCausalVerification(
      draft,
      {
        ...repositoryAnswer,
        assessments: [
          {
            ...repositoryAnswer.assessments[0],
            evidenceReceiptIds: ["b".repeat(64)],
          },
        ],
      },
      "en",
      [receipt],
    ).findings,
  ).toEqual([]);
});
it.each([
  { digest: "invalid" },
  { headSha: "invalid" },
  { path: "../outside.ts" },
  { startLine: 0 },
  { startLine: 2, endLine: 1 },
  { truncated: true },
])(
  "rejects selected receipts with invalid or incomplete host metadata: %j",
  (invalid) => {
    const result = applyCausalVerification(draft, repositoryAnswer, "en", [
      { ...receipt, ...invalid },
    ]);
    expect(result.findings).toEqual([]);
    expect(result.isDegraded).toBe(true);
  },
);
it("resolves the entire inspected window and shares one receipt across candidates", () => {
  const candidates = { ...draft, findings: [finding, finding] };
  const raw = {
    assessments: [0, 1].map((candidateIndex) => ({
      ...repositoryAnswer.assessments[0],
      candidateIndex,
    })),
    summary: "Both callers dereference the return without a guard.",
  };
  expect(
    applyCausalVerification(candidates, raw, "en", [receipt]).findings,
  ).toHaveLength(2);
  expect(
    applyCausalVerification(candidates, raw, "en", [
      { ...receipt, truncated: true },
    ]).isDegraded,
  ).toBe(true);
});
