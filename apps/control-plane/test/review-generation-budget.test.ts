import { createReviewBudgetPlan } from "@holon/contracts";
import { evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it } from "vitest";

import { applyLedgerMigrations } from "../src/ledger/ledger-migrations.js";
import { ReviewGenerationBudgetStore } from "../src/ledger/review-generation-budget-store.js";
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
  await ledger.transition(
    runId,
    "queued",
    "running",
    new Date().toISOString(),
    "budget-test:start",
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
  expect(ids.filter((id) => id?.accepted)).toHaveLength(64);
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
  if (!first?.accepted) throw new Error("Expected generation admission");
  expect(
    await ledger.reserveModelGeneration(runId, {
      shardIndex: 0,
      shardCount: 1,
      phase: "finalization",
      inputBytes: 1,
      outputTokens: 1,
    }),
  ).toMatchObject({ accepted: false });
  await ledger.settleModelGeneration(runId, first.id, 10);
  await ledger.settleModelGeneration(runId, first.id, 0);
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
    await ledger.reserveModelGeneration(runId, {
      ...scenario.initial,
      shardIndex: 0,
      shardCount: 1,
      phase: "finalization",
    });
  const events = await runInDurableObject(ledger, (_object, state) => {
    const captured: unknown[] = [];
    const store = new ReviewGenerationBudgetStore(state.storage.sql, {
      emit(event, fields) {
        captured.push({ event, ...fields });
      },
    });
    expect(
      store.reserve(runId, {
        ...scenario.request,
        shardIndex: 0,
        shardCount: 1,
        phase: "finalization",
      }),
    ).toMatchObject({ accepted: false, reason: scenario.dimension });
    return captured;
  });
  expect(events).toEqual([
    {
      event: "model.budget_rejected",
      severity: "error",
      runId,
      shardIndex: 0,
      shardCount: 1,
      phase: "finalization",
      rule: scenario.dimension,
      current: scenario.current,
      requested: scenario.requested,
      limit: scenario.limit,
      callsCurrent: scenario.dimension === "calls" ? 64 : 1,
      callsLimit: 64,
      callsRequested: 1,
      inputBytesCurrent:
        scenario.dimension === "input_bytes"
          ? 4_000_000
          : scenario.dimension === "calls"
            ? 64
            : 1,
      inputBytesLimit: 4_000_000,
      inputBytesRequested: 1,
      outputTokensCurrent:
        scenario.dimension === "output_tokens"
          ? 120_000
          : scenario.dimension === "calls"
            ? 64
            : 1,
      outputTokensLimit: 120_000,
      outputTokensRequested: 1,
    },
  ]);
});

it("atomically refuses model and tool reservations after a newer head supersedes the run", async () => {
  const ledger = await ledgerForRun();
  const newerId =
    `github:42:pr:7:head:${"c".repeat(40)}:base:${"b".repeat(40)}` as const;
  const later = new Date(Date.now() + 1_000).toISOString();
  await ledger.claimRun(
    {
      attempt: 0,
      causalVersion: later,
      createdAt: later,
      id: newerId,
      prKey: "github:42:pr:7",
      state: "queued",
    },
    "new-head",
  );
  expect(
    await ledger.reserveModelGeneration(runId, {
      shardIndex: 0,
      shardCount: 1,
      phase: "investigation",
      inputBytes: 1,
      outputTokens: 1,
    }),
  ).toBeUndefined();
  expect(await ledger.reserveAnalysisToolCall(runId, 0, 1)).toBe(false);
  await runInDurableObject(ledger, (object) => {
    expect(() => object.loadModelGenerationStop(runId)).toThrow(
      "not authorized",
    );
  });
  await runInDurableObject(ledger, (_object, state) => {
    expect(
      state.storage.sql
        .exec(
          "SELECT COUNT(*) AS total FROM model_generation_reservations WHERE run_id = ?",
          runId,
        )
        .one().total,
    ).toBe(0);
    expect(
      state.storage.sql
        .exec(
          "SELECT COUNT(*) AS total FROM review_tool_budgets WHERE run_id = ?",
          runId,
        )
        .one().total,
    ).toBe(0);
  });
});

it("protects each shard's output allocation without renewing it on a peer admission", async () => {
  const ledger = await ledgerForRun();
  const request = {
    shardIndex: 0,
    shardCount: 2,
    phase: "investigation" as const,
    inputBytes: 1,
    outputTokens: 60_000,
  };
  expect(await ledger.reserveModelGeneration(runId, request)).toMatchObject({
    accepted: true,
  });
  expect(
    await ledger.reserveModelGeneration(runId, { ...request, outputTokens: 1 }),
  ).toMatchObject({
    accepted: false,
    reason: "shard_output_tokens",
    consumed: 60_000,
    limit: 60_000,
  });
  expect(await ledger.loadModelGenerationStop(runId)).toBeUndefined();
  expect(
    await ledger.reserveModelGeneration(runId, { ...request, shardIndex: 1 }),
  ).toMatchObject({ accepted: true });
  expect(
    await ledger.reserveModelGeneration(runId, { ...request, outputTokens: 1 }),
  ).toMatchObject({
    accepted: false,
    reason: "output_tokens",
    consumed: 120_000,
    limit: 120_000,
  });
});

it("counts historical reservations in the current aggregate ceiling", async () => {
  const ledger = await ledgerForRun();
  await runInDurableObject(ledger, (_object, state) => {
    state.storage.sql.exec(
      "INSERT INTO model_generation_reservations(run_id,input_bytes,output_tokens) VALUES (?,?,?)",
      runId,
      2_000_000,
      1,
    );
  });
  const request = {
    shardIndex: 0,
    shardCount: 1,
    phase: "investigation" as const,
    inputBytes: 2_000_000,
    outputTokens: 1,
  };
  expect(await ledger.reserveModelGeneration(runId, request)).toMatchObject({
    accepted: true,
  });
  expect(
    await ledger.reserveModelGeneration(runId, {
      ...request,
      shardIndex: 0,
      inputBytes: 1,
    }),
  ).toMatchObject({
    accepted: false,
    reason: "input_bytes",
    consumed: 4_000_000,
  });
});

it("persists the first denial across settlement, concurrent denials and eviction", async () => {
  const ledger = await ledgerForRun();
  expect(await ledger.loadModelGenerationStop(runId)).toBeUndefined();
  const request = {
    shardIndex: 0,
    shardCount: 1,
    phase: "investigation" as const,
    inputBytes: 1,
    outputTokens: 120_000,
  };
  const admitted = await ledger.reserveModelGeneration(runId, request);
  if (!admitted?.accepted) throw new Error("Expected reservation");
  const denied = await Promise.all(
    Array.from({ length: 4 }, () =>
      ledger.reserveModelGeneration(runId, { ...request, outputTokens: 1 }),
    ),
  );
  expect(denied.every((result) => result?.accepted === false)).toBe(true);
  expect(await ledger.loadModelGenerationStop(runId)).toBe("output_tokens");
  await ledger.settleModelGeneration(runId, admitted.id, 0);
  // Already admitted peers may continue inside the original ceilings. Settlement
  // never reopens admission of new shard waves, even if a different dimension denies.
  expect(
    await ledger.reserveModelGeneration(runId, {
      ...request,
      inputBytes: 3_999_999,
      outputTokens: 1,
    }),
  ).toMatchObject({ accepted: true });
  expect(
    await ledger.reserveModelGeneration(runId, { ...request, outputTokens: 1 }),
  ).toMatchObject({ accepted: false, reason: "input_bytes" });
  await evictDurableObject(ledger);
  expect(await ledger.loadModelGenerationStop(runId)).toBe("output_tokens");
  await runInDurableObject(ledger, (_object, state) => {
    expect(
      state.storage.sql
        .exec(
          "SELECT COUNT(*) AS count FROM model_generation_reservations WHERE run_id = ?",
          runId,
        )
        .one().count,
    ).toBe(2);
  });
});

it("upgrades a historical budget plan without changing its reservations", async () => {
  const ledger = await ledgerForRun();
  await ledger.reserveModelGeneration(runId, {
    shardIndex: 0,
    shardCount: 1,
    phase: "investigation",
    inputBytes: 123,
    outputTokens: 456,
  });
  await runInDurableObject(ledger, (_object, state) => {
    // Reproduce exactly the pre-22 table/marker, then exercise the real migration.
    state.storage.sql.exec(
      "ALTER TABLE model_generation_plans DROP COLUMN stop_reason",
    );
    state.storage.sql.exec("DELETE FROM schema_migrations WHERE version = 22");
    applyLedgerMigrations(state.storage);
    applyLedgerMigrations(state.storage);
    expect(
      state.storage.sql
        .exec(
          "SELECT shard_count, stop_reason FROM model_generation_plans WHERE run_id = ?",
          runId,
        )
        .one(),
    ).toEqual({ shard_count: 1, stop_reason: null });
    expect(
      state.storage.sql
        .exec(
          "SELECT input_bytes, output_tokens, shard_index FROM model_generation_reservations WHERE run_id = ?",
          runId,
        )
        .one(),
    ).toEqual({ input_bytes: 123, output_tokens: 456, shard_index: 0 });
    expect(() =>
      state.storage.sql.exec(
        "UPDATE model_generation_plans SET stop_reason = 'untrusted' WHERE run_id = ?",
        runId,
      ),
    ).toThrow();
  });
  expect(await ledger.loadModelGenerationStop(runId)).toBeUndefined();
});

it("refuses a budget-stop query for an invalid or terminal run", async () => {
  const ledger = await ledgerForRun();
  await runInDurableObject(ledger, (object) => {
    expect(() => object.loadModelGenerationStop("invalid")).toThrow();
  });
  await ledger.transition(
    runId,
    "running",
    "failed_retryable",
    new Date().toISOString(),
    "budget-test:failed",
  );
  await ledger.transition(
    runId,
    "failed_retryable",
    "failed_terminal",
    new Date().toISOString(),
    "budget-test:terminal",
  );
  await runInDurableObject(ledger, (object) => {
    expect(() => object.loadModelGenerationStop(runId)).toThrow(
      "not authorized",
    );
  });
});

it("protects later shards from an early shard's serialized history without stopping the run", async () => {
  const ledger = await ledgerForRun();
  const request = {
    shardIndex: 0,
    shardCount: 2,
    phase: "investigation" as const,
    inputBytes: 2_000_000,
    outputTokens: 1,
  };
  expect(await ledger.reserveModelGeneration(runId, request)).toMatchObject({
    accepted: true,
  });
  expect(
    await ledger.reserveModelGeneration(runId, { ...request, inputBytes: 1 }),
  ).toMatchObject({
    accepted: false,
    reason: "shard_input_bytes",
    limit: 2_000_000,
    consumed: 2_000_000,
  });
  await evictDurableObject(ledger);
  expect(await ledger.loadModelGenerationStop(runId)).toBeUndefined();
  expect(
    await ledger.reserveModelGeneration(runId, { ...request, shardIndex: 1 }),
  ).toMatchObject({ accepted: true });
});

it("protects future shard calls even when early outputs are settled and the aggregate still has capacity", async () => {
  const ledger = await ledgerForRun();
  const request = {
    shardIndex: 0,
    shardCount: 9,
    phase: "investigation" as const,
    inputBytes: 1,
    outputTokens: 1,
  };
  for (let index = 0; index < 7; index++) {
    const admission = await ledger.reserveModelGeneration(runId, request);
    if (!admission?.accepted) throw new Error("Expected shard allocation");
    await ledger.settleModelGeneration(runId, admission.id, 0);
  }
  expect(await ledger.reserveModelGeneration(runId, request)).toMatchObject({
    accepted: false,
    reason: "shard_calls",
    consumed: 7,
    limit: 7,
  });
  await evictDurableObject(ledger);
  expect(await ledger.loadModelGenerationStop(runId)).toBeUndefined();
  for (let shardIndex = 1; shardIndex < 9; shardIndex++)
    expect(
      await ledger.reserveModelGeneration(runId, { ...request, shardIndex }),
    ).toMatchObject({ accepted: true });
});

it("does not turn a request above the shard allocation into a global stop while peers still have capacity", async () => {
  const ledger = await ledgerForRun();
  const request = {
    shardIndex: 0,
    shardCount: 2,
    phase: "investigation" as const,
    inputBytes: 1,
    outputTokens: 1,
  };
  expect(await ledger.reserveModelGeneration(runId, request)).toMatchObject({
    accepted: true,
  });
  expect(
    await ledger.reserveModelGeneration(runId, {
      ...request,
      inputBytes: 4_000_000,
    }),
  ).toMatchObject({
    accepted: false,
    reason: "shard_input_bytes",
    limit: 2_000_000,
  });
  expect(await ledger.loadModelGenerationStop(runId)).toBeUndefined();
  expect(
    await ledger.reserveModelGeneration(runId, {
      ...request,
      shardIndex: 1,
      inputBytes: 2_000_000,
    }),
  ).toMatchObject({ accepted: true });
});

it.each([19, 24, 64])(
  "funds investigation, optional causality and recovery of all %s parts",
  async (count) => {
    const ledger = await ledgerForRun();
    await ledger.configureReviewBudget(runId, createReviewBudgetPlan(count));
    for (let index = 0; index < count; index++) {
      for (const [phase, outputTokens] of [
        ["investigation", 1000],
        ["investigation", 1000],
        ["investigation", 1000],
        ["investigation", 5000],
        ["causal_verification", 1000],
        ["causal_verification", 2500],
        ["recovery", 1024],
      ] as const) {
        const admission = await ledger.reserveModelGeneration(runId, {
          shardIndex: index,
          shardCount: count,
          phase,
          inputBytes: 20_000,
          outputTokens,
        });
        expect(admission?.accepted).toBe(true);
      }
      await ledger.completeReviewBudgetShard(runId, index);
      if (index === 0) await evictDurableObject(ledger);
    }
    expect(await ledger.loadModelGenerationStop(runId)).toBeUndefined();
  },
);
it("freezes prompt profile and risk, releases completed surplus and preserves uncertain charges", async () => {
  const ledger = await ledgerForRun();
  const plan = createReviewBudgetPlan(2, 0, [4, 1]);
  await ledger.configureReviewBudget(runId, plan);
  await ledger.configureReviewBudget(runId, plan);
  await evictDurableObject(ledger);
  await runInDurableObject(ledger, (object) => {
    expect(() =>
      object.configureReviewBudget(runId, createReviewBudgetPlan(2)),
    ).toThrow("plan changed");
    expect(() => object.completeReviewBudgetShard(runId, 2)).toThrow();
  });
  const reserve = (index: number, inputBytes: number) =>
    ledger.reserveModelGeneration(runId, {
      shardIndex: index,
      shardCount: 2,
      phase: "investigation",
      inputBytes,
      outputTokens: 1,
    });
  expect(await reserve(0, 2_360_000)).toMatchObject({ accepted: true });
  expect(await reserve(0, 1)).toMatchObject({
    accepted: false,
    reason: "shard_input_bytes",
  });
  expect(await reserve(1, 100)).toMatchObject({ accepted: true });
  await ledger.completeReviewBudgetShard(runId, 1);
  await ledger.completeReviewBudgetShard(runId, 1);
  await evictDurableObject(ledger);
  expect(await reserve(1, 1)).toMatchObject({ accepted: false });
  expect(await reserve(0, 1_639_900)).toMatchObject({ accepted: true });
  expect(await reserve(0, 1)).toMatchObject({
    accepted: false,
    reason: "input_bytes",
    consumed: 4_000_000,
  });
});
it("rejects budget configuration and completion for unauthorized runs without persisting a plan", async () => {
  const ledger = await ledgerForRun();
  await ledger.transition(
    runId,
    "running",
    "obsolete",
    new Date().toISOString(),
    "obsolete-budget",
  );
  await runInDurableObject(ledger, (object) => {
    expect(() =>
      object.configureReviewBudget(runId, createReviewBudgetPlan(1)),
    ).toThrow("not authorized");
    expect(() => object.completeReviewBudgetShard(runId, 0)).toThrow(
      "not authorized",
    );
  });
});
it("requires replanning a pre-migration budget without resetting its debt", async () => {
  const ledger = await ledgerForRun();
  await runInDurableObject(ledger, (_object, state) => {
    state.storage.sql.exec(
      "INSERT INTO model_generation_plans(run_id,shard_count) VALUES (?,1)",
      runId,
    );
    const store = new ReviewGenerationBudgetStore(state.storage.sql);
    expect(() =>
      store.reserve(runId, {
        shardIndex: 0,
        shardCount: 1,
        phase: "investigation",
        inputBytes: 1,
        outputTokens: 1,
      }),
    ).toThrow("replanning");
  });
});

it("replays a persisted completion after publication without reopening its budget", async () => {
  const ledger = await ledgerForRun();
  await ledger.configureReviewBudget(runId, createReviewBudgetPlan(1));
  await ledger.completeReviewBudgetShard(runId, 0);
  await ledger.transition(
    runId,
    "running",
    "publishing",
    new Date().toISOString(),
    "publish-budget",
  );
  await evictDurableObject(ledger);
  await expect(
    ledger.completeReviewBudgetShard(runId, 0),
  ).resolves.toBeUndefined();
  await expect(
    ledger.reserveModelGeneration(runId, {
      shardCount: 1,
      shardIndex: 0,
      phase: "investigation",
      inputBytes: 1,
      outputTokens: 1,
    }),
  ).resolves.toBeUndefined();
});
