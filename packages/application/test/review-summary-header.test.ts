import { describe, expect, it } from "vitest";

import { formatReviewSummaryHeader } from "../src/review-summary-header.js";

describe("review summary header", () => {
  const base = {
    activeFindingsCount: 0,
    scopeStatus: "complete" as const,
    shardsAnalyzed: 6,
    totalShards: 6,
  };

  it.each([
    ["APPROVE", "## ✅ Holon · Aprovado"],
    ["REQUEST_CHANGES", "## 🚩 Holon · Alterações solicitadas"],
    ["COMMENT", "## 💬 Holon · Comentário informativo"],
  ] as const)(
    "uses the same format for a complete %s review",
    (verdict, heading) => {
      expect(
        formatReviewSummaryHeader({
          ...base,
          verdict,
          language: "pt-BR",
          activeFindingsCount: verdict === "REQUEST_CHANGES" ? 1 : 0,
        }),
      ).toBe(
        `${heading}\n\n**${verdict === "REQUEST_CHANGES" ? "1 achado ativo" : "0 achados ativos"}** · revisão completa`,
      );
    },
  );

  it.each(["partial_by_policy", "partial_by_failure", "complete"] as const)(
    "shows incomplete coverage for %s",
    (scopeStatus) => {
      const formatted = formatReviewSummaryHeader({
        ...base,
        verdict: "COMMENT",
        language: "pt-BR",
        scopeStatus,
        isDegraded: scopeStatus === "complete",
        shardsAnalyzed: scopeStatus === "partial_by_failure" ? 5 : 6,
      });
      expect(formatted).toContain("## ⚠️ Holon · Revisão incompleta");
      expect(formatted).toContain(
        scopeStatus === "complete"
          ? "**0 achados verificados** · análise incompleta"
          : "**0 achados verificados** · cobertura parcial",
      );
      expect(formatted).toContain(
        scopeStatus === "partial_by_failure"
          ? "5/6 partes analisadas"
          : "6/6 partes analisadas",
      );
    },
  );

  it("distinguishes ineligible changes from an approved review", () => {
    expect(
      formatReviewSummaryHeader({
        ...base,
        verdict: "COMMENT",
        scopeStatus: "unsupported",
        shardsAnalyzed: 0,
        totalShards: 0,
        language: "es",
      }),
    ).toBe(
      "## 💬 Holon · Sin cambios elegibles\n\n**0 cambios elegibles** · revisión no aplicable",
    );
  });
});
