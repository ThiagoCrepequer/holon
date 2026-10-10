import { describe, expect, it } from "vitest";

import {
  parseModelReviewTransport,
  modelReviewTransportSchema,
  modelReviewOutputFromTransport,
  limitReviewText,
} from "../src/index.js";

const finding = () => ({
  confidence: 0.95,
  diagnostic: "A proven regression. ".repeat(60),
  evidence: [
    {
      excerpt: "source ".repeat(100),
      reason: "Causal explanation. ".repeat(20),
      path: "src/a.ts",
      startLine: 1,
      endLine: 3,
    },
  ],
  location: { line: 1, path: "src/a.ts", side: "RIGHT", startLine: null },
  severity: "high",
  suggestion: "Restore the guard. ".repeat(80),
});

describe("review output retention", () => {
  it("isolates an invalid resolution without resolving any finding on its behalf", () => {
    const valid = { ...finding(), fingerprint: `fp:${"a".repeat(64)}` };
    const {
      severity: _severity,
      suggestion: _suggestion,
      ...resolution
    } = valid;
    const parsed = parseModelReviewTransport({
      findings: [finding()],
      resolutions: [resolution, { ...resolution, fingerprint: "invented" }],
      summary: "A resolution still requires independent verification.",
    });
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.resolutions).toHaveLength(1);
    expect(parsed.resolutions?.[0]?.fingerprint).toBe(`fp:${"a".repeat(64)}`);
    expect(parsed.outputLimitations).toContain("candidate_rejected");
    expect(parsed.isDegraded).toBe(true);
  });

  it("keeps invalid envelopes and overflowing observations as schema failures", () => {
    const observation = {
      summary: "An independently useful repository observation.",
      path: "src/a.ts",
      line: 1,
      excerpt: "source",
    };
    expect(() =>
      parseModelReviewTransport({
        findings: [],
        summary: {},
        investigations: [observation],
      }),
    ).toThrow();
    expect(() =>
      parseModelReviewTransport({
        findings: [],
        summary: "Checked",
        investigations: Array.from({ length: 5 }, () => observation),
      }),
    ).toThrow();
  });
  it("retains valid candidates when a peer has an impossible location", () => {
    const retained = finding();
    const parsed = parseModelReviewTransport({
      findings: [
        {
          ...finding(),
          location: { line: -9007199254740991, path: "", side: "RIGHT" },
        },
        retained,
      ],
      summary: "The valid candidate still requires causal verification.",
    });
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.location.path).toBe("src/a.ts");
    expect(parsed.isDegraded).toBe(true);
    expect(parsed.outputLimitations).toContain("candidate_rejected");
  });
  it("retains useful text and findings beyond the former limits", () => {
    const raw = {
      findings: Array.from({ length: 4 }, finding),
      summary: "Review result. ".repeat(400),
    };
    const parsed = parseModelReviewTransport(raw);
    expect(parsed.findings).toHaveLength(4);
    expect(parsed.findings[0]?.diagnostic).toBe(
      raw.findings[0]?.diagnostic.trim(),
    );
    expect(parsed.findings[0]?.evidence[0]?.excerpt).toBe(
      raw.findings[0]?.evidence[0]?.excerpt,
    );
    expect(parsed.summary).toBe(raw.summary.trim());
  });
  it("reports every bounded loss, including normalization inside the SDK", () => {
    const large = finding();
    large.diagnostic = "😀".repeat(1_500);
    large.suggestion = "s".repeat(4_000);
    large.evidence = Array.from({ length: 5 }, () => ({
      ...large.evidence[0]!,
      excerpt: "e".repeat(1_500),
      reason: "r".repeat(700),
    }));
    const sdkOutput = modelReviewTransportSchema.parse({
      findings: Array.from({ length: 9 }, () => large),
      summary: "s".repeat(12_000),
    });
    const parsed = modelReviewOutputFromTransport(sdkOutput);
    expect(parsed.findings).toHaveLength(8);
    expect(parsed.findings[0]?.evidence).toHaveLength(4);
    expect(parsed.findings[0]?.diagnostic.isWellFormed()).toBe(true);
    expect(parsed.isDegraded).toBe(true);
    expect(parsed.outputLimitations).toEqual(
      expect.arrayContaining([
        "diagnostic_truncated",
        "suggestion_truncated",
        "excerpt_truncated",
        "reason_truncated",
        "summary_truncated",
        "findings_omitted",
        "evidence_omitted",
      ]),
    );
    expect(parsed.findings[0]?.evidence[0]?.excerpt).toBe("e".repeat(1_200));
  });
  it("does not fabricate a verification claim to pad a short diagnostic", () => {
    const output = parseModelReviewTransport({
      findings: [{ ...finding(), diagnostic: "Too short" }],
      summary: "Complete",
    });
    expect(output.findings).toEqual([]);
    expect(output.isDegraded).toBe(true);
    expect(output.outputLimitations).toContain("candidate_rejected");
    expect(output.summary).not.toContain("Too short");
    expect(limitReviewText("abc😀def", 5)).toBe("abc…");
  });
  it("discards an invalid auxiliary observation without losing a valid candidate", () => {
    const output = parseModelReviewTransport({
      findings: [finding()],
      investigations: [
        { summary: "Too short", path: "src/a.ts", line: 1, excerpt: "source" },
      ],
      summary: "The valid candidate still requires verification.",
    });
    expect(output.findings).toHaveLength(1);
    expect(output.investigations).toEqual([]);
    expect(output.isDegraded).toBe(true);
    expect(output.outputLimitations).toContain("investigation_rejected");
  });
});
