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
      ledger.reserveModelGeneration(runId, {
        shardIndex: 0,
        shardCount: 1,
        phase: "finalization",
        inputBytes: 1,
        outputTokens: 1,
      }),
    ),
  );
  expect(ids.filter((id) => id.accepted)).toHaveLength(64);
  await evictDurableObject(ledger);
  expect(
    await ledger.reserveModelGeneration(runId, {
      shardIndex: 0,
      shardCount: 1,
      phase: "finalization",
      inputBytes: 1,
      outputTokens: 1,
    }),
  ).toMatchObject({ accepted: false });
});
it("charges uncertain output and settles a successful reservation exactly once", async () => {
  const ledger = await ledgerForRun();
  const first = await ledger.reserveModelGeneration(runId, {
    shardIndex: 0,
    shardCount: 1,
    phase: "finalization",
    inputBytes: 1,
    outputTokens: 120_000,
  });
  expect(first).toMatchObject({ accepted: true });
  expect(
    await ledger.reserveModelGeneration(runId, {
      shardIndex: 0,
      shardCount: 1,
      phase: "finalization",
      inputBytes: 1,
      outputTokens: 1,
    }),
  ).toMatchObject({ accepted: false });
  await ledger.settleModelGeneration(runId, first.accepted ? first.id : 0, 10);
  await ledger.settleModelGeneration(runId, first.accepted ? first.id : 0, 0);
  expect(
    await ledger.reserveModelGeneration(runId, {
      shardIndex: 0,
      shardCount: 1,
      phase: "finalization",
      inputBytes: 1,
      outputTokens: 119_990,
    }),
  ).toMatchObject({ accepted: true });
  expect(
    await ledger.reserveModelGeneration(runId, {
      shardIndex: 0,
      shardCount: 1,
      phase: "finalization",
      inputBytes: 1,
      outputTokens: 1,
    }),
  ).toMatchObject({ accepted: false });
});
it("bounds cumulative serialized input and rejects invalid reservations", async () => {
  const ledger = await ledgerForRun();
  expect(
    await ledger.reserveModelGeneration(runId, {
      shardIndex: 0,
      shardCount: 1,
      phase: "finalization",
      inputBytes: 4_000_000,
      outputTokens: 1,
    }),
  ).toMatchObject({ accepted: true });
  expect(
    await ledger.reserveModelGeneration(runId, {
      shardIndex: 0,
      shardCount: 1,
      phase: "finalization",
      inputBytes: 1,
      outputTokens: 1,
    }),
  ).toMatchObject({ accepted: false });
  await runInDurableObject(ledger, (object) => {
    expect(() =>
      object.reserveModelGeneration(runId, {
        shardIndex: 0,
        shardCount: 1,
        phase: "finalization",
        inputBytes: -1,
        outputTokens: 1,
      }),
    ).toThrow();
  });
});

it("protects finalization and later shards when the first wave consumes its investigation allocation", async () => {
  const ledger = await ledgerForRun();
  for (let shardIndex = 0; shardIndex < 5; shardIndex++) {
    for (let round = 0; round < 10; round++) {
      const allocation = await ledger.reserveModelGeneration(runId, {
        inputBytes: 80_000,
        outputTokens: 12_000,
        shardIndex,
        shardCount: 8,
        phase: "investigation",
      });
      if (!allocation.accepted) break;
      await ledger.settleModelGeneration(runId, allocation.id, 500);
    }
  }
  await evictDurableObject(ledger);
  for (let shardIndex = 0; shardIndex < 8; shardIndex++) {
    expect(
      await ledger.reserveModelGeneration(runId, {
        inputBytes: 64_000,
        outputTokens: 8192,
        shardIndex,
        shardCount: 8,
        phase: "finalization",
      }),
    ).toMatchObject({ accepted: true });
  }
});

it("reports the exhausted dimension and refuses a changed plan", async () => {
  const ledger = await ledgerForRun();
  const request = {
    shardIndex: 0,
    shardCount: 8,
    phase: "investigation" as const,
    inputBytes: 372_001,
    outputTokens: 8192,
  };
  expect(await ledger.reserveModelGeneration(runId, request)).toEqual({
    accepted: false,
    reason: "input_bytes",
    limit: 372_000,
    consumed: 0,
    requested: 372_001,
  });
  const admitted = await ledger.reserveModelGeneration(runId, {
    ...request,
    inputBytes: 1,
  });
  expect(admitted).toMatchObject({ accepted: true, outputTokens: 6808 });
  expect(
    await ledger.reserveModelGeneration(runId, { ...request, inputBytes: 1 }),
  ).toEqual({
    accepted: false,
    reason: "output_tokens",
    limit: 6808,
    consumed: 6808,
    requested: 8192,
  });
  await runInDurableObject(ledger, (object) => {
    expect(() =>
      object.reserveModelGeneration(runId, { ...request, shardCount: 7 }),
    ).toThrow("plan changed");
    expect(() =>
      object.reserveModelGeneration(runId, { ...request, shardIndex: 8 }),
    ).toThrow("Invalid model shard");
  });
});

it("preserves pre-migration charges conservatively instead of resetting an in-flight run", async () => {
  const ledger = await ledgerForRun();
  await runInDurableObject(ledger, (_object, state) => {
    state.storage.sql.exec(
      "INSERT INTO model_generation_reservations(run_id,input_bytes,output_tokens) VALUES (?,?,?)",
      runId,
      500_000,
      1,
    );
  });
  expect(
    await ledger.reserveModelGeneration(runId, {
      shardIndex: 7,
      shardCount: 8,
      phase: "finalization",
      inputBytes: 1,
      outputTokens: 1,
    }),
  ).toMatchObject({
    accepted: false,
    reason: "input_bytes",
    consumed: 500_000,
  });
});
