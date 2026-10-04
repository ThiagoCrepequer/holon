import { expect, it } from "vitest";

import { determineReviewVerdict } from "../src/verdict.js";

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
  },
);
