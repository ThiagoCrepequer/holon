import { expect, it } from "vitest";

import {
  formatCiEvidenceMarkdown,
  formatLineIntervals,
} from "../src/ci-evidence.js";
import { reviewMessage, reviewMessages } from "../src/review-messages.js";

const parameters = (text: string) =>
  [...text.matchAll(/\{([a-zA-Z]+)\}/gu)]
    .map((match) => match[1])
    .toSorted((a, b) => String(a).localeCompare(String(b)));

it("provides every host message and identical parameter names in each locale", () => {
  for (const translations of Object.values(reviewMessages)) {
    for (const locale of ["en", "pt-BR", "es"] as const) {
      expect(translations[locale].trim()).not.toBe("");
      expect(parameters(translations[locale])).toEqual(
        parameters(translations.en),
      );
    }
  }
  expect(reviewMessage("pt-BR", "resolved", { sha: "abc1234" })).toBe(
    "✅ Defeito resolvido no commit `abc1234`.",
  );
});
it.each(["en", "pt-BR", "es"] as const)(
  "renders complete CI sections in %s while preserving test identifiers",
  (language) => {
    const evidence = {
      status: "available" as const,
      tests: {
        passed: 0,
        failed: 6,
        skipped: 0,
        total: 6,
        failures: Array.from({ length: 6 }, (_, index) => ({
          testName: `test_${index}`,
          message: "literal evidence",
          filePath: "src/test.ts",
          line: 2,
        })),
      },
      workflowRunId: 1,
    };
    const coverage = {
      coveragePercentage: 0,
      coveredLinesCount: 0,
      uncoveredLinesCount: 6,
      totalChangedLines: 6,
      uncoveredByFile: Array.from({ length: 6 }, (_, index) => ({
        path: `src/f${index}.ts`,
        lines: [1, 3, 5, 7, 9, 11, 13],
      })),
    };
    const text = formatCiEvidenceMarkdown(evidence, coverage, language);
    expect(text).toContain(reviewMessage(language, "ciTitle"));
    expect(text).toContain(
      reviewMessage(language, "ciMoreFailed", { count: 1 }),
    );
    expect(text).toContain(
      reviewMessage(language, "ciMoreFiles", { count: 1 }),
    );
    expect(text).toContain("**test_0** (`src/test.ts:2`): literal evidence");
    expect(formatLineIntervals([1, 3, 5], 1, language)).toContain(
      reviewMessage(language, "ciMoreLines", { count: 2 }),
    );
    expect(
      formatCiEvidenceMarkdown(
        { status: "not_available" },
        undefined,
        language,
      ),
    ).toContain(reviewMessage(language, "ciUnavailable"));
  },
);
