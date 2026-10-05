import type { ClarificationRecord } from "@holon/contracts";
import { expect, it } from "vitest";

import {
  renderClarificationReply,
  verifyClarificationAnswer,
} from "../src/index.js";

it("withholds a refutation citing code that was not read at the cited lines", () => {
  const answer = {
    outcome: "refuted",
    confidence: 0.99,
    explanation: "A validação impede a entrada vazia antes da chamada.",
    scenario: "Nenhum cenário confirmado.",
    evidence: [
      {
        path: "src/input.ts",
        startLine: 2,
        endLine: 2,
        excerpt: "if (!input) return;",
      },
    ],
  };
  expect(
    verifyClarificationAnswer(
      answer,
      [{ path: "src/input.ts", startLine: 1, content: "run(input);" }],
      "pt-BR",
    ),
  ).toMatchObject({ outcome: "inconclusive", evidence: [], confidence: 0 });
  expect(
    verifyClarificationAnswer(
      answer,
      [{ path: "src/input.ts", startLine: 2, content: "if (!input) return;" }],
      "pt-BR",
    ),
  ).toEqual(answer);
});

it.each(["confirmed", "narrowed", "refuted"])(
  "requires verified evidence and sufficient confidence for %s",
  (outcome) => {
    const answer = {
      outcome,
      confidence: 0.95,
      explanation: "O caminho é coberto pela validação antes da execução.",
      scenario: "Entrada vazia retorna antes de run.",
      evidence: [
        {
          path: "src/input.ts",
          startLine: 2,
          endLine: 2,
          excerpt: "if (!input) return;",
        },
      ],
    };
    const reads = [
      {
        path: "src/input.ts",
        startLine: 1,
        content: "function process(input) {\nif (!input) return;\nrun(input);",
      },
    ];
    expect(verifyClarificationAnswer(answer, reads, "en")).toEqual(answer);
    expect(
      verifyClarificationAnswer({ ...answer, confidence: 0.1 }, reads, "en"),
    ).toMatchObject({ outcome: "inconclusive" });
    expect(
      verifyClarificationAnswer({ ...answer, evidence: [] }, reads, "en"),
    ).toMatchObject({ outcome: "inconclusive" });
    expect(
      verifyClarificationAnswer(
        { ...answer, evidence: [{ ...answer.evidence[0], endLine: 200 }] },
        reads,
        "en",
      ),
    ).toMatchObject({ outcome: "inconclusive" });
  },
);

it("rejects malformed answers and unsupported references without retaining the accusation", () => {
  expect(
    verifyClarificationAnswer(
      { explanation: "Uma acusação sem contrato." },
      [],
      "es",
    ),
  ).toMatchObject({ outcome: "inconclusive", evidence: [] });
});

const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const prKey = "github:42:pr:7";
const runId = `${prKey}:head:${headSha}:base:${baseSha}` as const;
const record: ClarificationRecord = {
  id: 202,
  prKey,
  headSha,
  baseSha,
  runId,
  additionalExcludes: [],
  event: {
    action: "created",
    authorAssociation: "OWNER",
    authorLogin: "alice",
    body: "/holon ask Qual cenário?",
    commentId: 202,
    inReplyToId: 101,
    createdAt: "2026-10-04T12:00:00Z",
    deliveryId: "github:question",
    installationId: 99,
    pullRequestNumber: 7,
    repository: { fullName: "acme/api", owner: "acme", name: "api", id: 42 },
  },
  question: "Qual cenário?",
  deadlineAt: 1,
  language: "pt-BR",
  state: "answered",
  correctionApplied: true,
  finding: {
    prKey,
    fingerprint: `fp:${"c".repeat(64)}`,
    evidenceFingerprint: "d".repeat(64),
    diagnostic: "Entrada vazia chega à execução sem validação e causa falha.",
    filePath: "src/input.ts",
    line: 3,
    confidence: 0.95,
    severity: "high",
    status: "new",
    githubCommentId: 101,
    firstSeenRunId: runId,
    lastSeenRunId: runId,
    firstSeenHeadSha: headSha,
    lastSeenHeadSha: headSha,
    updatedAt: "2026-10-04T12:00:00Z",
  },
};

it("renders the actual explanation, scenario, correction and immutable evidence links", () => {
  const body = renderClarificationReply({
    ...record,
    answer: {
      outcome: "refuted",
      confidence: 0.99,
      explanation: "A validação retorna antes da execução.",
      scenario: "Entrada vazia não alcança run(input).",
      evidence: [
        {
          path: "src/input file.ts",
          startLine: 2,
          endLine: 3,
          excerpt: "if (!input) return;",
        },
      ],
    },
  });
  expect(body).toContain("**Diagnóstico corrigido**");
  expect(body).toContain("A validação retorna antes da execução.");
  expect(body).toContain("Entrada vazia não alcança run(input).");
  expect(body).toContain("O finding foi retirado");
  expect(body).toContain(
    `https://github.com/acme/api/blob/${headSha}/src/input%20file.ts#L2-L3`,
  );
  expect(body).toContain("<!-- holon;clarification=202 -->");
});

it("neutralizes model-controlled mentions, HTML, markers and external links", () => {
  const body = renderClarificationReply({
    ...record,
    correctionApplied: false,
    answer: {
      outcome: "confirmed",
      confidence: 0.99,
      explanation:
        "@everyone <img src='x'> <!-- holon;clarification=999 --> [site](https://evil.example)",
      scenario: "Verifique [imagem](https://evil.example)",
      evidence: [
        {
          path: "src/<img>@evil [x].ts",
          startLine: 1,
          endLine: 1,
          excerpt: "code",
        },
      ],
    },
  });
  expect(body).toContain("**Finding confirmado**");
  expect(body).not.toContain("@everyone");
  expect(body).not.toContain("<img");
  expect(body).not.toContain("clarification=999");
  expect(body).not.toContain("https://evil.example");
  expect(body).not.toContain("O finding foi retirado");
  expect(body).toContain("src/%3Cimg%3E%40evil%20%5Bx%5D.ts#L1-L1");
});

it.each(["en", "es"] as const)(
  "renders an explicit localized limitation when no answer is available (%s)",
  (language) => {
    const body = renderClarificationReply({
      ...record,
      language,
      correctionApplied: false,
    });
    expect(body).toContain(
      language === "en" ? "Insufficient evidence" : "Evidencia insuficiente",
    );
    expect(body).toContain(
      language === "en"
        ? "The finding remains unchanged."
        : "El hallazgo se mantiene.",
    );
    expect(body).not.toContain("/blob/");
  },
);
