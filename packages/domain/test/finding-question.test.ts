import { expect, it } from "vitest";

import { parseFindingQuestion } from "../src/index.js";

it("recognizes a question addressed to the installed bot in a finding reply", () => {
  expect(
    parseFindingQuestion(
      "@holon-review[bot] Esta validação já evita o problema?",
      "holon-review",
    ),
  ).toBe("Esta validação já evita o problema?");
  expect(
    parseFindingQuestion("@holon Em qual cenário ocorre?", "holon-review"),
  ).toBe("Em qual cenário ocorre?");
  expect(
    parseFindingQuestion(
      "/holon ask Mostre o caminho de execução.",
      "holon-review",
    ),
  ).toBe("Mostre o caminho de execução.");
  for (const body of [
    "Discussão normal",
    "> @holon pergunta",
    "```\n@holon pergunta\n```",
    "@holon-other pergunta",
    "@holon",
    "/holon dismiss false-positive",
    `@holon ${"x".repeat(4001)}`,
  ])
    expect(parseFindingQuestion(body, "holon-review")).toBeUndefined();
});
