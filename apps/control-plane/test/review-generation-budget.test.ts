import { evictDurableObject, reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it } from "vitest";

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

it("shares the output ceiling across shards without renewing their budget", async () => {
  const ledger = await ledgerForRun();
  expect(
    await ledger.reserveModelGeneration(runId, {
      shardIndex: 0,
      shardCount: 2,
      phase: "investigation",
      inputBytes: 1,
      outputTokens: 120_000,
    }),
  ).toMatchObject({ accepted: true });
  expect(
    await ledger.reserveModelGeneration(runId, {
      shardIndex: 1,
      shardCount: 2,
      phase: "investigation",
      inputBytes: 1,
      outputTokens: 1,
    }),
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
      500_000,
      1,
    );
  });
  expect(
    await ledger.reserveModelGeneration(runId, {
      shardIndex: 1,
      shardCount: 2,
      phase: "investigation",
      inputBytes: 3_500_000,
      outputTokens: 1,
    }),
  ).toMatchObject({ accepted: true });
  expect(
    await ledger.reserveModelGeneration(runId, {
      shardIndex: 0,
      shardCount: 2,
      phase: "investigation",
      inputBytes: 1,
      outputTokens: 1,
    }),
  ).toMatchObject({
    accepted: false,
    reason: "input_bytes",
    consumed: 4_000_000,
  });
});
