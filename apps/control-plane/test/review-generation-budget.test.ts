import { evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it } from "vitest";
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
