import {
  clarificationAnswerSchema,
  type ClarificationAnswer,
  type ClarificationRead,
  type ClarificationRecord,
  type ReviewLanguage,
} from "@holon/contracts";
import { redactSecrets, reviewText } from "@holon/domain";

export function unavailableClarification(
  language: ReviewLanguage,
): ClarificationAnswer {
  return {
    outcome: "inconclusive",
    confidence: 0,
    explanation: reviewText(
      language,
      "I could not verify this diagnosis within the available evidence and investigation limits. The finding remains unchanged.",
      "Não consegui verificar o diagnóstico com as evidências e os limites de investigação disponíveis. O finding foi mantido.",
      "No pude verificar el diagnóstico con las evidencias y los límites de investigación disponibles. El hallazgo se mantiene.",
    ),
    scenario: reviewText(
      language,
      "No scenario verified.",
      "Nenhum cenário verificado.",
      "Ningún escenario verificado.",
    ),
    evidence: [],
  };
}

/** A model assertion cannot cite a file or line it did not actually inspect. */
export function verifyClarificationAnswer(
  raw: unknown,
  reads: readonly ClarificationRead[],
  language: ReviewLanguage,
): ClarificationAnswer {
  const parsed = clarificationAnswerSchema.safeParse(raw);
  if (!parsed.success) return unavailableClarification(language);
  const answer = parsed.data;
  if (
    answer.outcome !== "inconclusive" &&
    (!answer.evidence.length ||
      answer.confidence < (answer.outcome === "refuted" ? 0.9 : 0.8))
  )
    return unavailableClarification(language);
  if (
    answer.evidence.some(
      (evidence) =>
        !reads.some((read) => {
          if (
            read.path !== evidence.path ||
            evidence.startLine < read.startLine
          )
            return false;
          const lines = read.content.split("\n");
          if (evidence.endLine >= read.startLine + lines.length) return false;
          return lines
            .slice(
              evidence.startLine - read.startLine,
              evidence.endLine - read.startLine + 1,
            )
            .join("\n")
            .includes(evidence.excerpt);
        }),
    )
  )
    return unavailableClarification(language);
  return {
    ...answer,
    explanation: redactSecrets(answer.explanation),
    scenario: redactSecrets(answer.scenario),
    evidence: answer.evidence.map((evidence) => ({
      ...evidence,
      excerpt: redactSecrets(evidence.excerpt),
    })),
  };
}

export function clarificationMarker(id: number): string {
  return `<!-- holon;clarification=${id} -->`;
}

function safeClarificationText(text: string): string {
  return redactSecrets(text)
    .replace(/<!--[^]*?-->/gu, "")
    .replace(/</gu, "&lt;")
    .replace(/@/gu, "&#64;")
    .replace(/https?:\/\//giu, "https&#58;//")
    .replace(/[[\]]/gu, (character) => `\\${character}`);
}

/** Host-owned links and labels; repository/model text cannot choose the reply target. */
export function renderClarificationReply(record: ClarificationRecord): string {
  const answer = record.answer ?? unavailableClarification(record.language);
  const labels = {
    confirmed: reviewText(
      record.language,
      "Finding confirmed",
      "Finding confirmado",
      "Hallazgo confirmado",
    ),
    narrowed: reviewText(
      record.language,
      "Scenario narrowed",
      "Cenário delimitado",
      "Escenario delimitado",
    ),
    refuted: reviewText(
      record.language,
      "Diagnosis corrected",
      "Diagnóstico corrigido",
      "Diagnóstico corregido",
    ),
    inconclusive: reviewText(
      record.language,
      "Insufficient evidence",
      "Evidência insuficiente",
      "Evidencia insuficiente",
    ),
  };
  const refs = answer.evidence.map((evidence) => {
    const path = evidence.path.split("/").map(encodeURIComponent).join("/");
    return `- [${safeClarificationText(evidence.path).replace(/`/gu, "\\`")}:${evidence.startLine}–${evidence.endLine}](https://github.com/${record.event.repository.fullName}/blob/${record.headSha}/${path}#L${evidence.startLine}-L${evidence.endLine})`;
  });
  const corrected = record.correctionApplied
    ? reviewText(
        record.language,
        "The finding was retracted after this investigation; the original discussion is preserved.",
        "O finding foi retirado após esta investigação; a discussão original foi preservada.",
        "El hallazgo se retiró tras esta investigación; se conserva la conversación original.",
      )
    : "";
  return [
    `**${labels[answer.outcome]}**`,
    safeClarificationText(answer.explanation),
    safeClarificationText(answer.scenario),
    refs.join("\n"),
    corrected,
    `SHA: \`${record.headSha}\``,
    clarificationMarker(record.id),
  ]
    .filter(Boolean)
    .join("\n\n");
}
