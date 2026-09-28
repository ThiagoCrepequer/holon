import { expect, it, vi } from "vitest";

import {
  createPartitionedRepositoryToolRunner,
  generationDeadline,
  reviewTimeBudget,
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
it("reserves comfortable phase budgets and completion time within one deadline", () => {
  const deadline = reviewTimeBudget.analysisMs;
  expect(generationDeadline(deadline, "investigation", 0)).toBe(420_000);
  expect(generationDeadline(deadline, "finalization", 420_000)).toBe(600_000);
  expect(generationDeadline(deadline, "recovery", 600_000)).toBe(780_000);
  expect(generationDeadline(deadline, "synthesis", 780_000)).toBe(870_000);
  expect(generationDeadline(deadline, "investigation", 420_000)).toBe(420_000);
  expect(() => generationDeadline(Number.NaN, "investigation")).toThrow(
    "Invalid review deadline",
  );
  expect(reviewTimeBudget.workflowStepMs).toBeGreaterThan(deadline);
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
