import { expect, it } from "vitest";

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
