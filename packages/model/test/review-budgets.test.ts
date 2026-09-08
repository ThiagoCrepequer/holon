import { expect, it, vi } from "vitest";

import {
  createPartitionedRepositoryToolRunner,
  generationTimeout,
} from "../src/review-budgets.js";
it("reserves tools for every shard without exceeding the run budget", async () => {
  const run = vi.fn(async () => ({ content: "ok", truncated: false }));
  const budget = createPartitionedRepositoryToolRunner({ run }, 12);
  const counts: number[] = [];
  for (let index = 0; index < 5; index++) {
    budget.beginShard(index, 5);
    let count = 0;
    while (true) {
      try {
        await budget.runner.run({
          name: "read_file",
          arguments: { path: "src/a.ts" },
        });
        count++;
      } catch {
        break;
      }
    }
    counts.push(count);
    expect(budget.exceeded()).toBe(true);
  }
  expect(counts).toEqual([3, 3, 2, 2, 2]);
  expect(run).toHaveBeenCalledTimes(12);
});
it("reserves time for finalization and recovery and rejects an expired deadline", () => {
  expect(generationTimeout(100_000, "investigation", 0).totalMs).toBe(60_000);
  expect(generationTimeout(100_000, "finalization", 60_000).totalMs).toBe(
    20_000,
  );
  expect(generationTimeout(100_000, "recovery", 80_000).totalMs).toBe(20_000);
  expect(() => generationTimeout(100_000, "investigation", 100_000)).toThrow();
});

it("propagates durable budget exhaustion even after a local runner is recreated", async () => {
  const { RepositoryToolBudgetExceededError } =
    await import("../src/reviewer.js");
  const budget = createPartitionedRepositoryToolRunner(
    {
      run: async () => {
        throw new RepositoryToolBudgetExceededError(12);
      },
    },
    12,
  );
  budget.beginShard(0, 5);
  await expect(
    budget.runner.run({ name: "read_file", arguments: { path: "src/a.ts" } }),
  ).rejects.toBeInstanceOf(RepositoryToolBudgetExceededError);
  expect(budget.exceeded()).toBe(true);
  expect(() => budget.beginShard(5, 5)).toThrow("Invalid shard");
  expect(() =>
    createPartitionedRepositoryToolRunner({ run: vi.fn() }, 0),
  ).toThrow("Invalid tool budget");
});
