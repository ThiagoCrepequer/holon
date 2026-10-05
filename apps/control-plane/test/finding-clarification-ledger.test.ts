import { reset, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";

import {
  admission,
  clarificationLedger,
  prKey,
} from "./clarification-fixtures.js";
afterEach(() => reset());
it("admits one investigation for a question comment across concurrent deliveries and eviction", async () => {
  const ledger = await clarificationLedger();
  const questions = await Promise.all([
    ledger.admitClarification(admission),
    ledger.admitClarification({
      ...admission,
      event: { ...admission.event, deliveryId: "github:redelivery" },
    }),
  ]);
  expect(questions[0]).toMatchObject({
    state: "pending",
    question: admission.question,
    finding: { githubCommentId: 101 },
  });
  expect(questions[1]).toEqual(questions[0]);
  await evictDurableObject(ledger);
  expect(await ledger.loadClarification(202)).toEqual(questions[0]);
  expect(await ledger.isClarificationAuthorized(202)).toBe(true);
  expect(
    await ledger.admitClarification({
      ...admission,
      event: { ...admission.event, commentId: 203 },
    }),
  ).toMatchObject({ state: "answered" });
  expect(await ledger.loadLatestReviewDecision(prKey)).toMatchObject({
    headSha: admission.headSha,
  });
});

it("validates evidence before retracting and preserves the correction across retries", async () => {
  const ledger = await clarificationLedger();
  await ledger.admitClarification(admission);
  expect(await ledger.reserveClarificationRead(202)).toBe(true);
  await ledger.recordClarificationRead(202, {
    path: "src/input.ts",
    startLine: 2,
    content: "if (!input) return;",
  });
  const answer = {
    outcome: "refuted",
    confidence: 0.95,
    explanation: "A validação já impede o cenário descrito.",
    scenario: "A entrada vazia retorna antes da chamada.",
    evidence: [
      {
        path: "src/input.ts",
        startLine: 2,
        endLine: 2,
        excerpt: "if (!input) return;",
      },
    ],
  };
  const result = await ledger.answerClarification(202, answer);
  expect(result).toMatchObject({
    state: "answered",
    correctionApplied: true,
    answer: { outcome: "refuted" },
  });
  expect(await ledger.loadPrFindings(prKey)).toMatchObject([
    { status: "dismissed" },
  ]);
  expect(
    await ledger.answerClarification(202, { outcome: "confirmed" }),
  ).toEqual(result);
  expect(await ledger.isClarificationAuthorized(202)).toBe(false);
  expect(await ledger.canPublishClarification(202)).toBe(true);
  await ledger.completeClarification(202, 303);
  expect(await ledger.loadClarification(202)).toMatchObject({
    state: "published",
    replyCommentId: 303,
  });
  expect(await ledger.canPublishClarification(202)).toBe(false);
});

it("bounds tool and generation reservations durably, charging uncertain generations", async () => {
  const ledger = await clarificationLedger();
  await ledger.admitClarification(admission);
  const reads = await Promise.all(
    Array.from({ length: 9 }, () => ledger.reserveClarificationRead(202)),
  );
  expect(reads.filter(Boolean)).toHaveLength(8);
  const first = await ledger.reserveClarificationGeneration(202, {
    phase: "finding_clarification",
    inputBytes: 100,
    outputTokens: 16000,
  });
  expect(first).toMatchObject({ accepted: true });
  expect(
    await ledger.reserveClarificationGeneration(202, {
      phase: "finding_clarification",
      inputBytes: 100,
      outputTokens: 1,
    }),
  ).toMatchObject({ accepted: false, reason: "output_tokens" });
  if (first?.accepted)
    await ledger.settleClarificationGeneration(202, first.id, 20);
  await evictDurableObject(ledger);
  expect(
    await ledger.reserveClarificationGeneration(202, {
      phase: "finding_clarification",
      inputBytes: 300000,
      outputTokens: 1,
    }),
  ).toMatchObject({ accepted: false, reason: "input_bytes" });
  await runInDurableObject(ledger, async (instance) => {
    await expect(
      instance.reserveClarificationGeneration(202, {
        phase: "investigation",
        inputBytes: 100,
        outputTokens: 1,
      }),
    ).rejects.toThrow("phase");
  });
});

it("makes an answer obsolete when a new review supersedes its head", async () => {
  const ledger = await clarificationLedger();
  await ledger.admitClarification(admission);
  const now = new Date(Date.now() + 1000).toISOString();
  await ledger.claimRun(
    {
      id: `${prKey}:head:${"e".repeat(40)}:base:${admission.baseSha}`,
      prKey,
      createdAt: now,
      causalVersion: now,
      state: "queued",
      attempt: 0,
    },
    "new-review",
  );
  expect(await ledger.reserveClarificationRead(202)).toBe(false);
  expect(await ledger.answerClarification(202, {})).toMatchObject({
    state: "obsolete",
    correctionApplied: false,
  });
  expect(await ledger.canPublishClarification(202)).toBe(false);
  expect(await ledger.loadPrFindings(prKey)).toMatchObject([{ status: "new" }]);
  expect(
    await ledger.admitClarification({
      ...admission,
      event: { ...admission.event, commentId: 203 },
    }),
  ).toBeUndefined();
});

it("charges generation call count after settlement and rejects oversized read evidence", async () => {
  const ledger = await clarificationLedger();
  await ledger.admitClarification(admission);
  for (let i = 0; i < 8; i++) {
    const reservation = await ledger.reserveClarificationGeneration(202, {
      phase: "finding_clarification",
      inputBytes: 100,
      outputTokens: 1,
    });
    if (reservation?.accepted)
      await ledger.settleClarificationGeneration(202, reservation.id, 0);
  }
  expect(
    await ledger.reserveClarificationGeneration(202, {
      phase: "finding_clarification",
      inputBytes: 100,
      outputTokens: 1,
    }),
  ).toMatchObject({ accepted: false, reason: "calls" });
  expect(
    await ledger.recordClarificationRead(202, {
      path: "src/input.ts",
      startLine: 1,
      content: "x".repeat(65536),
    }),
  ).toBe(true);
  expect(
    await ledger.recordClarificationRead(202, {
      path: "src/input.ts",
      startLine: 1,
      content: "x",
    }),
  ).toBe(false);
});

it("answers a concurrent question with an explicit budget notice without admitting another model", async () => {
  const ledger = await clarificationLedger();
  await ledger.admitClarification(admission);
  const busy = await ledger.admitClarification({
    ...admission,
    event: { ...admission.event, commentId: 203 },
  });
  expect(busy).toMatchObject({
    state: "answered",
    answer: {
      outcome: "inconclusive",
      explanation: expect.stringContaining("investigação"),
    },
  });
  expect(
    await ledger.reserveClarificationGeneration(203, {
      phase: "finding_clarification",
      inputBytes: 100,
      outputTokens: 1,
    }),
  ).toBeUndefined();
});

it("expires unread or abandoned investigations and removes their evidence durably", async () => {
  const ledger = await clarificationLedger();
  const record = await ledger.admitClarification(admission);
  await ledger.reserveClarificationRead(202);
  await ledger.recordClarificationRead(202, {
    path: "src/input.ts",
    startLine: 2,
    content: "if (!input) return;",
  });
  const { vi } = await import("vitest");
  const { runDurableObjectAlarm } = await import("cloudflare:test");
  vi.spyOn(Date, "now").mockReturnValue(record!.deadlineAt + 1);
  await runDurableObjectAlarm(ledger);
  expect(await ledger.loadClarification(202)).toMatchObject({
    state: "answered",
    answer: { outcome: "inconclusive" },
    correctionApplied: false,
  });
  expect(await ledger.reserveClarificationRead(202)).toBe(false);
});

it("retains only the last two published exchanges for the same finding and head", async () => {
  const ledger = await clarificationLedger();
  const answer = {
    outcome: "inconclusive",
    confidence: 0,
    explanation: "Ainda falta verificar o caller desse caminho.",
    scenario: "Caminho não confirmado.",
    evidence: [],
  };
  for (const id of [202, 203, 204]) {
    await ledger.admitClarification({
      ...admission,
      question: `Pergunta ${id}`,
      event: { ...admission.event, commentId: id },
    });
    await ledger.answerClarification(id, answer);
    await ledger.completeClarification(id, id + 100);
  }
  await ledger.admitClarification({
    ...admission,
    event: { ...admission.event, commentId: 205 },
  });
  await evictDurableObject(ledger);
  expect(await ledger.clarificationHistory(205)).toEqual([
    {
      question: "Pergunta 203",
      outcome: answer.outcome,
      explanation: answer.explanation,
      scenario: answer.scenario,
    },
    {
      question: "Pergunta 204",
      outcome: answer.outcome,
      explanation: answer.explanation,
      scenario: answer.scenario,
    },
  ]);
  expect(await ledger.clarificationHistory(999)).toEqual([]);
});
