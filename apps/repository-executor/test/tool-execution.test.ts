import { afterEach, expect, it, vi } from "vitest";

import { ToolExecution } from "../src/tool-execution.js";

afterEach(() => vi.useRealTimers());
it("bounds a stuck read, observes its late rejection and starts no further work", async () => {
  vi.useFakeTimers();
  const retained: Promise<unknown>[] = [];
  const execution = new ToolExecution(Date.now() + 100, (work) => {
    retained.push(work);
  });
  let release!: () => void;
  const pending = execution.wait(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const rejected = expect(pending).rejects.toMatchObject({
    reason: "timed-out",
  });
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  const next = vi.fn(async () => {});
  await expect(execution.wait(next)).rejects.toThrow();
  expect(next).not.toHaveBeenCalled();
  release();
  await Promise.all(retained);
  execution.dispose();
});
it("kills a process handle delivered after cancellation", async () => {
  const retained: Promise<unknown>[] = [];
  const execution = new ToolExecution(Date.now() + 10_000, (work) => {
    retained.push(work);
  });
  let release!: (value: { kill(): Promise<void> }) => void;
  const kill = vi.fn(async () => {});
  const pending = execution.wait(
    () =>
      new Promise<{ kill(): Promise<void> }>((resolve) => {
        release = resolve;
      }),
    (value) => value.kill(),
  );
  const rejected = expect(pending).rejects.toMatchObject({
    reason: "timed-out",
  });
  await Promise.resolve();
  execution.cancel();
  await rejected;
  release({ kill });
  await Promise.all(retained);
  expect(kill).toHaveBeenCalledOnce();
  execution.dispose();
});
it("rejects invalid, expired and excessively distant deadlines", () => {
  for (const deadline of [NaN, 0, Date.now() - 1, Date.now() + 100_000]) {
    expect(() => new ToolExecution(deadline, () => {})).toThrow();
  }
});

it("returns successful work even when logging fails, and bounds cleanup acknowledgement", async () => {
  vi.useFakeTimers();
  const retained: Promise<unknown>[] = [];
  const execution = new ToolExecution(
    Date.now() + 10_000,
    (work) => {
      retained.push(work);
    },
    () => {
      throw new Error("log unavailable");
    },
  );
  await expect(execution.wait(async () => "result")).resolves.toBe("result");
  let finish!: () => void;
  let acknowledged = false;
  const cleanup = execution
    .cleanup(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .then(() => {
      acknowledged = true;
      return undefined;
    });
  await vi.advanceTimersByTimeAsync(5_000);
  await cleanup;
  expect(acknowledged).toBe(true);
  finish();
  await Promise.all(retained);
  execution.dispose();
});
