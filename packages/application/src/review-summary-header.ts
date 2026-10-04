import type { ReviewScopeStatus } from "@holon/contracts";
import {
  reviewText,
  type ReviewLanguage,
  type ReviewVerdict,
} from "@holon/domain";

export interface ReviewSummaryHeader {
  readonly verdict: ReviewVerdict;
  readonly activeFindingsCount: number;
  readonly scopeStatus: ReviewScopeStatus;
  readonly isDegraded?: boolean | undefined;
  readonly shardsAnalyzed: number;
  readonly totalShards: number;
  readonly language?: ReviewLanguage | undefined;
}

/** Keep the review and feedback-refresh summaries on the same status vocabulary. */
export function formatReviewSummaryHeader(input: ReviewSummaryHeader): string {
  const text = (en: string, pt: string, es: string) =>
    reviewText(input.language ?? "en", en, pt, es);

  if (input.scopeStatus === "unsupported") {
    return text(
      "## 💬 Holon · No eligible changes\n\n**0 eligible changes** · review not applicable",
      "## 💬 Holon · Sem alterações elegíveis\n\n**0 alterações elegíveis** · revisão não aplicável",
      "## 💬 Holon · Sin cambios elegibles\n\n**0 cambios elegibles** · revisión no aplicable",
    );
  }

  if (input.scopeStatus !== "complete" || input.isDegraded === true) {
    const count = input.activeFindingsCount;
    const coverage =
      input.totalShards > 0
        ? ` (${text(
            `${input.shardsAnalyzed}/${input.totalShards} shards analyzed`,
            `${input.shardsAnalyzed}/${input.totalShards} partes analisadas`,
            `${input.shardsAnalyzed}/${input.totalShards} partes analizadas`,
          )})`
        : "";
    return `${text("## ⚠️ Holon · Incomplete review", "## ⚠️ Holon · Revisão incompleta", "## ⚠️ Holon · Revisión incompleta")}\n\n${text(
      `**${count} verified finding${count === 1 ? "" : "s"}**`,
      `**${count} achado${count === 1 ? "" : "s"} verificado${count === 1 ? "" : "s"}**`,
      `**${count} hallazgo${count === 1 ? "" : "s"} verificado${count === 1 ? "" : "s"}**`,
    )} · ${text("partial coverage", "cobertura parcial", "cobertura parcial")}${coverage}`;
  }

  const heading =
    input.verdict === "APPROVE"
      ? text(
          "## ✅ Holon · Approved",
          "## ✅ Holon · Aprovado",
          "## ✅ Holon · Aprobado",
        )
      : input.verdict === "REQUEST_CHANGES"
        ? text(
            "## 🚩 Holon · Changes requested",
            "## 🚩 Holon · Alterações solicitadas",
            "## 🚩 Holon · Cambios solicitados",
          )
        : text(
            "## 💬 Holon · Informational comment",
            "## 💬 Holon · Comentário informativo",
            "## 💬 Holon · Comentario informativo",
          );
  const count = input.activeFindingsCount;
  const findings = text(
    `**${count} active finding${count === 1 ? "" : "s"}**`,
    `**${count} achado${count === 1 ? "" : "s"} ativo${count === 1 ? "" : "s"}**`,
    `**${count} hallazgo${count === 1 ? "" : "s"} activo${count === 1 ? "" : "s"}**`,
  );
  return `${heading}\n\n${findings} · ${text("complete review", "revisão completa", "revisión completa")}`;
}
