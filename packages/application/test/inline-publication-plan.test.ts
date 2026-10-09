import { describe, expect, it } from "vitest";

import {
  formatConfiguredFindings,
  formatInlineOverflow,
  planInlinePublications,
} from "../src/inline-publication-plan.js";

const finding = (fingerprint: string, extra = {}) => ({
  fingerprint,
  confidence: 0.9,
  severity: "high" as const,
  status: "new" as const,
  previousCommentId: undefined,
  ...extra,
});
describe("inline publication budget", () => {
  it("caps only eligible new comments while keeping every other finding", () => {
    const findings = [
      finding("persistent", { status: "persistent", previousCommentId: 12 }),
      finding("low", { severity: "low" }),
      finding("uncertain", { confidence: 0.7 }),
      finding("pending", { identityAmbiguous: true }),
      finding("first"),
      finding("second"),
    ];
    expect(planInlinePublications(findings, 1)).toEqual({
      inlineFingerprints: ["first"],
      overflowFingerprints: ["second"],
    });
    expect(findings).toHaveLength(6);
  });
  it("zero preserves eligible findings for the summary; replay is stable", () => {
    const findings = [finding("a"), finding("b")];
    expect(planInlinePublications(findings, 0)).toEqual({
      inlineFingerprints: [],
      overflowFingerprints: ["a", "b"],
    });
    expect(planInlinePublications(findings.toReversed(), 1)).toEqual({
      inlineFingerprints: ["a"],
      overflowFingerprints: ["b"],
    });
  });
  it("rejects invalid budgets", () => {
    for (const limit of [-1, 41, 0.5, NaN])
      expect(() => planInlinePublications([], limit)).toThrow(RangeError);
  });
  it("prioritizes severity before confidence and uses a stable tie break without mutating analysis order", () => {
    const findings = [
      finding("medium", { severity: "medium", confidence: 1 }),
      finding("high-b", { confidence: 0.9 }),
      finding("critical", { severity: "critical", confidence: 0.8 }),
      finding("high-a", { confidence: 0.9 }),
      finding("high-confident", { confidence: 0.99 }),
    ];
    expect(planInlinePublications(findings, 3)).toEqual({
      inlineFingerprints: ["critical", "high-confident", "high-a"],
      overflowFingerprints: ["high-b", "medium"],
    });
    expect(findings.map((item) => item.fingerprint)).toEqual([
      "medium",
      "high-b",
      "critical",
      "high-a",
      "high-confident",
    ]);
  });
  it("recovers a persistent finding whose previous comment is absent and accepts the maximum budget", () => {
    const findings = [finding("persistent", { status: "persistent" })];
    expect(planInlinePublications(findings, 40)).toEqual({
      inlineFingerprints: ["persistent"],
      overflowFingerprints: [],
    });
  });
});

describe("publication summary", () => {
  const findings = [
    {
      ...finding("inline"),
      diagnostic: "Inline defect",
      location: { path: "src/a.ts", line: 2 },
    },
    {
      ...finding("overflow", { severity: "medium" }),
      diagnostic: "Overflow defect",
      location: { path: "src/b.ts", line: 4 },
    },
    {
      ...finding("ambiguous", { identityAmbiguous: true }),
      diagnostic: "Ambiguous defect",
      location: { path: "src/c.ts", line: 6 },
    },
  ];

  it.each([
    [
      "en",
      "Findings retained in the summary because of the inline comment limit",
    ],
    [
      "pt-BR",
      "Achados mantidos no resumo devido ao limite de comentários inline",
    ],
    [
      "es",
      "Hallazgos conservados en el resumen por el límite de comentarios inline",
    ],
  ] as const)("shows the retained finding once in %s", (language, heading) => {
    expect(
      formatInlineOverflow(
        findings,
        ["overflow", "overflow", "unknown"],
        language,
      ),
    ).toBe(`${heading} (1):\n- src/b.ts:4 — Overflow defect`);
  });

  it("reports active counts and withholds ambiguous identity without losing its diagnostic", () => {
    const summary = formatConfiguredFindings(findings, {
      language: "pt-BR",
      maxInlineComments: 1,
    });
    expect(summary).toContain(
      "Achados: 3 ativos; 1 novos comentários inline elegíveis; 2 sem novo comentário inline.",
    );
    expect(summary).toContain("Revalidação de identidade pendente (1)");
    expect(summary).toContain(
      "Novos comentários inline e resoluções do grupo ambíguo foram suspensos.",
    );
    expect(summary).toContain("- src/c.ts:6 — Ambiguous defect");
    expect(summary).toContain("- src/b.ts:4 — Overflow defect");
    expect(summary).not.toContain("Inline defect");
  });

  it("omits empty sections and retains all eligible diagnostics when inline is disabled", () => {
    expect(formatInlineOverflow(findings, [], "en")).toBe("");
    expect(
      formatConfiguredFindings([], { language: "en", maxInlineComments: 0 }),
    ).toBe("");
    const summary = formatConfiguredFindings(findings.slice(0, 2), {
      language: "en",
      maxInlineComments: 0,
    });
    expect(summary).toContain(
      "Findings: 2 active; 0 eligible new inline comments; 2 without a new inline comment.",
    );
    expect(summary).toContain("src/a.ts:2 — Inline defect");
    expect(summary).toContain("src/b.ts:4 — Overflow defect");
    expect(summary).not.toContain("Identity revalidation pending");
  });
});
