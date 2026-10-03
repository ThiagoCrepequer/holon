import { evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it } from "vitest";

import { ReviewGenerationBudgetStore } from "../src/review-generation-budget-store.js";
afterEach(() => reset());
const runId =
  `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as const;
async function ledgerForRun() {
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  await ledger.claimRun(
    {
      causalVersion: new Date().toISOString(),
      id: runId,
      prKey: "github:42:pr:7",
      createdAt: new Date().toISOString(),
      state: "queued",
      attempt: 0,
    },
    "budget-test",
  );
  return ledger;
}
it("bounds concurrent model calls across shards and eviction", async () => {
  const ledger = await ledgerForRun();
  const ids = await Promise.all(
    Array.from({ length: 65 }, () =>
      ledger.reserveModelGeneration(runId, { inputBytes: 1, outputTokens: 1 }),
    ),
  );
  expect(ids.filter((id) => id !== undefined)).toHaveLength(64);
  await evictDurableObject(ledger);
  expect(
    await ledger.reserveModelGeneration(runId, {
      inputBytes: 1,
      outputTokens: 1,
    }),
  ).toBeUndefined();
});
it("charges uncertain output and settles a successful reservation exactly once", async () => {
  const ledger = await ledgerForRun();
  const first = await ledger.reserveModelGeneration(runId, {
    inputBytes: 1,
    outputTokens: 120_000,
  });
  expect(first).toBeTypeOf("number");
  expect(
    await ledger.reserveModelGeneration(runId, {
      inputBytes: 1,
      outputTokens: 1,
    }),
  ).toBeUndefined();
  await ledger.settleModelGeneration(runId, first!, 10);
  await ledger.settleModelGeneration(runId, first!, 0);
  expect(
    await ledger.reserveModelGeneration(runId, {
      inputBytes: 1,
      outputTokens: 119_990,
    }),
  ).toBeTypeOf("number");
  expect(
    await ledger.reserveModelGeneration(runId, {
      inputBytes: 1,
      outputTokens: 1,
    }),
  ).toBeUndefined();
});
it("bounds cumulative serialized input and rejects invalid reservations", async () => {
  const ledger = await ledgerForRun();
  expect(
    await ledger.reserveModelGeneration(runId, {
      inputBytes: 4_000_000,
      outputTokens: 1,
    }),
  ).toBeTypeOf("number");
  expect(
    await ledger.reserveModelGeneration(runId, {
      inputBytes: 1,
      outputTokens: 1,
    }),
  ).toBeUndefined();
  await runInDurableObject(ledger, (object) => {
    expect(() =>
      object.reserveModelGeneration(runId, { inputBytes: -1, outputTokens: 1 }),
    ).toThrow();
  });
});

it.each([
  {
    dimension: "calls",
    initial: { inputBytes: 1, outputTokens: 1 },
    count: 64,
    request: { inputBytes: 1, outputTokens: 1 },
    current: 64,
    requested: 1,
    limit: 64,
  },
  {
    dimension: "input_bytes",
    initial: { inputBytes: 4_000_000, outputTokens: 1 },
    count: 1,
    request: { inputBytes: 1, outputTokens: 1 },
    current: 4_000_000,
    requested: 1,
    limit: 4_000_000,
  },
  {
    dimension: "output_tokens",
    initial: { inputBytes: 1, outputTokens: 120_000 },
    count: 1,
    request: { inputBytes: 1, outputTokens: 1 },
    current: 120_000,
    requested: 1,
    limit: 120_000,
  },
] as const)("logs the exact $dimension admission rule", async (scenario) => {
  const ledger = await ledgerForRun();
  for (let index = 0; index < scenario.count; index++)
    await ledger.reserveModelGeneration(runId, scenario.initial);
  const events = await runInDurableObject(ledger, (_object, state) => {
    const captured: unknown[] = [];
    const store = new ReviewGenerationBudgetStore(state.storage.sql, {
      emit(event, fields) {
        captured.push({ event, ...fields });
      },
    });
    expect(store.reserve(runId, scenario.request)).toBeUndefined();
    return captured;
  });
  expect(events).toEqual([
    {
      event: "model.budget_rejected",
      severity: "error",
      runId,
      rule: scenario.dimension,
      current: scenario.current,
      requested: scenario.requested,
      limit: scenario.limit,
      callsCurrent: scenario.dimension === "calls" ? 64 : 1,
      callsExceeded: scenario.dimension === "calls",
      callsLimit: 64,
      callsRequested: 1,
      inputBytesCurrent:
        scenario.dimension === "input_bytes"
          ? 4_000_000
          : scenario.dimension === "calls"
            ? 64
            : 1,
      inputBytesExceeded: scenario.dimension === "input_bytes",
      inputBytesLimit: 4_000_000,
      inputBytesRequested: 1,
      outputTokensCurrent:
        scenario.dimension === "output_tokens"
          ? 120_000
          : scenario.dimension === "calls"
            ? 64
            : 1,
      outputTokensExceeded: scenario.dimension === "output_tokens",
      outputTokensLimit: 120_000,
      outputTokensRequested: 1,
    },
  ]);
});
