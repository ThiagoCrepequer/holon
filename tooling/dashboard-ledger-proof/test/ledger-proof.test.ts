import {
  abortAllDurableObjects,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { retryDelay } from "../src/ledger-proof.js";
import type { ProofLedger, TaskSnapshot } from "../src/ledger-proof.js";

const initialTime = Date.UTC(2099, 0, 1);
const due = initialTime + 100;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(initialTime);
});
afterEach(async () => {
  await reset();
  vi.useRealTimers();
});

function ledger() {
  return env.PROOF_LEDGERS.get(env.PROOF_LEDGERS.newUniqueId());
}
async function persisted(stub: DurableObjectStub<ProofLedger>) {
  return runInDurableObject(stub, async (_object, state) => {
    const current = state.storage.sql
      .exec("SELECT revision, payload FROM ledger")
      .one();
    const tasks = state.storage.sql
      .exec(
        "SELECT kind, target_revision, due_at, attempts FROM tasks ORDER BY kind",
      )
      .toArray();
    const outcomes = state.storage.sql
      .exec("SELECT kind, target_revision, result FROM outcomes ORDER BY id")
      .toArray();
    const alarm = await state.storage.getAlarm();
    return { current, tasks, outcomes, alarm };
  });
}

it("commits revision, obligation and wake-up together in real SQLite storage", async () => {
  const stub = ledger();
  await stub.mutateAtomic("synthetic-current", due);
  expect(await persisted(stub)).toEqual({
    current: { revision: 1, payload: "synthetic-current" },
    tasks: [
      { kind: "projection", target_revision: 1, due_at: due, attempts: 0 },
    ],
    outcomes: [],
    alarm: due,
  });
});

async function installEffect(
  stub: DurableObjectStub<ProofLedger>,
  effect: (task: TaskSnapshot, state: DurableObjectState) => Promise<void>,
) {
  await runInDurableObject(stub, (object: ProofLedger, state) => {
    object.effect = (task) => effect(task, state);
  });
}

it.each(["before-alarm", "after-alarm"] as const)(
  "rolls back both SQL and replacement alarm on %s",
  async (fault) => {
    const stub = ledger();
    await stub.mutateAtomic("committed", initialTime + 500);
    expect(
      await runInDurableObject(stub, async (object: ProofLedger) => {
        try {
          await object.mutateAtomic("uncommitted", due, fault);
          return "unexpected-success";
        } catch (error) {
          return error instanceof Error ? error.message : "unexpected-error";
        }
      }),
    ).toBe(`injected-${fault}`);
    expect(await persisted(env.PROOF_LEDGERS.get(stub.id))).toEqual({
      current: { revision: 1, payload: "committed" },
      tasks: [
        {
          kind: "projection",
          target_revision: 1,
          due_at: initialTime + 500,
          attempts: 0,
        },
      ],
      outcomes: [],
      alarm: initialTime + 500,
    });
  },
);

it.each(["after-commit"] as const)(
  "preserves the committed obligation after %s and instance teardown",
  async (fault) => {
    const stub = ledger();
    expect(
      await runInDurableObject(stub, async (object: ProofLedger) => {
        try {
          await object.mutateAtomic("committed-without-reply", due, fault);
          return "unexpected-success";
        } catch (error) {
          return error instanceof Error ? error.message : "unexpected-error";
        }
      }),
    ).toBe("injected-after-commit");
    await abortAllDurableObjects();
    expect(await persisted(env.PROOF_LEDGERS.get(stub.id))).toEqual({
      current: { revision: 1, payload: "committed-without-reply" },
      tasks: [
        { kind: "projection", target_revision: 1, due_at: due, attempts: 0 },
      ],
      outcomes: [],
      alarm: due,
    });
  },
);

it("transactionSync rolls SQL back when its synchronous callback throws", async () => {
  const stub = ledger();
  expect(
    await runInDurableObject(stub, async (object: ProofLedger) => {
      try {
        await object.mutateSplitSync("uncommitted", due, "inside-sql");
        return "unexpected-success";
      } catch (error) {
        return error instanceof Error ? error.message : "unexpected-error";
      }
    }),
  ).toBe("injected-inside-sql");
  expect(await persisted(stub)).toEqual({
    current: { revision: 0, payload: "" },
    tasks: [],
    outcomes: [],
    alarm: null,
  });
});

it("exposes the lost wake-up window of transactionSync followed by setAlarm", async () => {
  const stub = ledger();
  expect(
    await runInDurableObject(stub, async (object: ProofLedger) => {
      try {
        await object.mutateSplitSync(
          "committed-without-alarm",
          due,
          "before-alarm",
        );
        return "unexpected-success";
      } catch (error) {
        return error instanceof Error ? error.message : "unexpected-error";
      }
    }),
  ).toBe("injected-sync-before-alarm");
  await abortAllDurableObjects();
  expect(await persisted(env.PROOF_LEDGERS.get(stub.id))).toEqual({
    current: { revision: 1, payload: "committed-without-alarm" },
    tasks: [
      { kind: "projection", target_revision: 1, due_at: due, attempts: 0 },
    ],
    outcomes: [],
    alarm: null,
  });
  expect(await runDurableObjectAlarm(env.PROOF_LEDGERS.get(stub.id))).toBe(
    false,
  );
});

it("shows split SQL/alarm succeeds on the happy path without claiming atomicity", async () => {
  const stub = ledger();
  await stub.mutateSplitSync("synthetic", due);
  expect((await persisted(stub)).alarm).toBe(due);
});

it("shares the single alarm across four deadlines without postponing earlier tasks", async () => {
  const stub = ledger();
  const calls: string[] = [];
  await installEffect(stub, (task) => {
    calls.push(task.kind);
    return Promise.resolve();
  });
  await stub.mutateAtomic("synthetic", initialTime + 400);
  await stub.scheduleMaintenance("cleanup", initialTime + 100);
  await stub.scheduleMaintenance("checks", initialTime + 300);
  await stub.scheduleMaintenance("supersession", initialTime + 200);
  expect((await persisted(stub)).alarm).toBe(initialTime + 100);
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect(calls).toEqual([]);
  expect((await persisted(stub)).alarm).toBe(initialTime + 100);
  for (const offset of [100, 200, 300, 400]) {
    vi.setSystemTime(initialTime + offset);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await persisted(stub)).alarm).toBe(
      offset === 400 ? null : initialTime + offset + 100,
    );
  }
  expect(calls).toEqual(["cleanup", "supersession", "checks", "projection"]);
  expect((await persisted(stub)).tasks).toEqual([]);
  expect(await runDurableObjectAlarm(stub)).toBe(false);
});

it("keeps maintenance generations distinct when a kind is rescheduled", async () => {
  const stub = ledger();
  await stub.scheduleMaintenance("cleanup", initialTime + 300);
  await stub.scheduleMaintenance("cleanup", initialTime + 100);
  await stub.scheduleMaintenance("cleanup", initialTime + 500);
  expect((await persisted(stub)).tasks).toEqual([
    {
      kind: "cleanup",
      target_revision: 3,
      due_at: initialTime + 100,
      attempts: 0,
    },
  ]);
  expect((await persisted(stub)).alarm).toBe(initialTime + 100);
});

it("rearms durably before effects and projection failure does not block maintenance", async () => {
  const stub = ledger();
  await stub.mutateAtomic("synthetic", due);
  for (const kind of ["cleanup", "checks", "supersession"] as const)
    await stub.scheduleMaintenance(kind, due);
  const calls: string[] = [];
  const observed: Array<{ alarm: number | null; attempts: unknown }> = [];
  await installEffect(stub, async (task, state) => {
    calls.push(task.kind);
    const attempts = state.storage.sql
      .exec("SELECT attempts FROM tasks WHERE kind=?", task.kind)
      .one().attempts;
    observed.push({ alarm: await state.storage.getAlarm(), attempts });
    if (task.kind === "projection")
      throw new Error("controlled-projection-outage");
  });
  vi.setSystemTime(due);
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect(calls).toEqual(["checks", "cleanup", "projection", "supersession"]);
  expect(observed).toEqual(
    Array.from({ length: 4 }, () => ({ alarm: due + retryDelay, attempts: 1 })),
  );
  expect((await persisted(stub)).tasks).toEqual([
    {
      kind: "projection",
      target_revision: 1,
      due_at: due + retryDelay,
      attempts: 1,
    },
  ]);
  expect((await persisted(stub)).outcomes).toEqual([
    { kind: "checks", target_revision: 1, result: "succeeded" },
    { kind: "cleanup", target_revision: 1, result: "succeeded" },
    { kind: "projection", target_revision: 1, result: "failed" },
    { kind: "supersession", target_revision: 1, result: "succeeded" },
  ]);
});

it("preserves wake-up across teardown after seven failures and recovers without a new business request", async () => {
  let stub = ledger();
  await stub.mutateAtomic("synthetic", due);
  let attempts = 0;
  const effect = () => {
    attempts += 1;
    return attempts <= 7
      ? Promise.reject(new Error("controlled-outage"))
      : Promise.resolve();
  };
  await installEffect(stub, effect);
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    vi.setSystemTime(due + (attempt - 1) * retryDelay);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const state = await persisted(stub);
    expect(state.alarm).toBe(attempt === 8 ? null : due + attempt * retryDelay);
    if (attempt <= 7)
      expect(state.tasks).toEqual([
        {
          kind: "projection",
          target_revision: 1,
          due_at: due + attempt * retryDelay,
          attempts: attempt,
        },
      ]);
    if (attempt === 7) {
      await abortAllDurableObjects();
      stub = env.PROOF_LEDGERS.get(stub.id);
      expect(await persisted(stub)).toEqual(state);
      // Reinstall only the external effect control after recreating the DO.
      // Neither this fixture nor the constructor schedules or repairs a wake-up.
      await installEffect(stub, effect);
    }
  }
  expect(attempts).toBe(8);
  const state = await persisted(stub);
  expect(state.tasks).toEqual([]);
  expect(state.outcomes.map((row) => row.result)).toEqual([
    "failed",
    "failed",
    "failed",
    "failed",
    "failed",
    "failed",
    "failed",
    "succeeded",
  ]);
});

it("does not let an old snapshot acknowledgement erase a revision committed during I/O", async () => {
  const stub = ledger();
  await stub.mutateAtomic("first", due);
  const gate = env.EFFECT_GATES.get(env.EFFECT_GATES.newUniqueId());
  const snapshots: TaskSnapshot[] = [];
  const failed = Promise.withResolvers<void>();
  await installEffect(stub, async (task) => {
    snapshots.push(task);
    if (task.target_revision === 1) {
      try {
        await env.EFFECT_GATES.get(gate.id).hold();
      } catch (error) {
        failed.reject(error);
        throw error;
      }
    }
  });
  vi.setSystemTime(due);
  const dispatch = runDurableObjectAlarm(stub);
  try {
    await Promise.race([gate.waitForEntry(), failed.promise]);
    expect((await persisted(stub)).alarm).toBe(due + retryDelay);
    await stub.mutateAtomic("second", due + 100);
  } finally {
    await gate.finish();
  }
  expect(await dispatch).toBe(true);
  expect(snapshots).toEqual([
    { kind: "projection", target_revision: 1, attempts: 1, payload: "first" },
  ]);
  expect((await persisted(stub)).tasks).toEqual([
    { kind: "projection", target_revision: 2, due_at: due + 100, attempts: 1 },
  ]);
  expect((await persisted(stub)).alarm).toBe(due + 100);
  vi.setSystemTime(due + 100);
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect(snapshots[1]).toEqual({
    kind: "projection",
    target_revision: 2,
    attempts: 2,
    payload: "second",
  });
  expect((await persisted(stub)).tasks).toEqual([]);
  expect((await persisted(stub)).current).toEqual({
    revision: 2,
    payload: "second",
  });
});

it("keeps unconfigured external effects pending instead of silently completing", async () => {
  const stub = ledger();
  await stub.mutateAtomic("synthetic", due);
  vi.setSystemTime(due);
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect((await persisted(stub)).tasks).toEqual([
    {
      kind: "projection",
      target_revision: 1,
      due_at: due + retryDelay,
      attempts: 1,
    },
  ]);
});

it("does not start any effect when the claim/rearm transaction aborts after setAlarm", async () => {
  const stub = ledger();
  let effects = 0;
  await stub.mutateAtomic("synthetic", due);
  await installEffect(stub, () => {
    effects += 1;
    return Promise.resolve();
  });
  vi.setSystemTime(due);
  expect(
    await runInDurableObject(stub, async (object: ProofLedger) => {
      object.abortClaimTransaction = true;
      try {
        await object.alarm();
        return "unexpected-success";
      } catch (error) {
        return error instanceof Error ? error.message : "unexpected-error";
      } finally {
        object.abortClaimTransaction = false;
      }
    }),
  ).toBe("injected-claim-transaction-abort");
  expect(effects).toBe(0);
  expect((await persisted(stub)).tasks).toEqual([
    { kind: "projection", target_revision: 1, due_at: due, attempts: 0 },
  ]);
  expect((await persisted(stub)).alarm).toBe(due);
  expect((await persisted(stub)).outcomes).toEqual([]);
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect(effects).toBe(1);
  expect((await persisted(stub)).tasks).toEqual([]);
});
