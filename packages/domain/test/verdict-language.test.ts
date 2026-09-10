import { expect, it } from "vitest";

import { determineReviewVerdict, formatVerdictBadge } from "../src/verdict.js";

it.each(["en", "pt-BR", "es"] as const)(
  "keeps verdict semantics while localizing %s",
  (language) => {
    const result = determineReviewVerdict({
      findings: [{ confidence: 0.95, severity: "critical" }],
      scopeStatus: "complete",
      language,
    });
    expect(result.verdict).toBe("REQUEST_CHANGES");
    expect(result.blockingFindingsCount).toBe(1);
    expect(result.reasons[0]).toContain(
      { en: "critical", "pt-BR": "crítico", es: "crítico" }[language],
    );
    expect(formatVerdictBadge("APPROVE", language)).toBe(
      {
        en: "### Verdict: Approved",
        "pt-BR": "### Veredito: Aprovado",
        es: "### Veredicto: Aprobado",
      }[language],
    );
  },
);
