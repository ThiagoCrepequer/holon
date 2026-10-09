import { expect, it, vi } from "vitest";

import { SnapshotToolCache } from "../src/snapshot-tool-cache.js";

it("coalesces matching snapshot reads and returns caller-owned results", async () => {
  const cache = new SnapshotToolCache();
  const execute = vi.fn(async () => ({
    content: "caller guard",
    truncated: false,
  }));
  const [one, two] = await Promise.all([
    cache.read("run:sha:policy:read", execute),
    cache.read("run:sha:policy:read", execute),
  ]);
  expect(execute).toHaveBeenCalledOnce();
  expect([one.reused, two.reused]).toEqual([false, true]);
  one.result.content = "changed by caller";
  expect(
    (await cache.read("run:sha:policy:read", execute)).result.content,
  ).toBe("caller guard");
  await cache.read("other-sha:policy:read", execute);
  await cache.read("run:sha:other-policy:read", execute);
  expect(execute).toHaveBeenCalledTimes(3);
});
it.each([
  { content: "", truncated: false },
  { content: "partial", truncated: true },
])("does not cache empty or truncated absence ($truncated)", async (result) => {
  const cache = new SnapshotToolCache();
  const execute = vi.fn(async () => result);
  await cache.read("read", execute);
  await cache.read("read", execute);
  expect(execute).toHaveBeenCalledTimes(2);
});
it("joins cleanup and fences late completion without retaining results", async () => {
  const cache = new SnapshotToolCache();
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = vi.fn(async () => {
    await waiting;
    return { content: "safe", truncated: false };
  });
  const read = cache.read("read", execute);
  const cleanup = cache.clear();
  release();
  await cleanup;
  await read;
  await cache.read("read", execute);
  expect(execute).toHaveBeenCalledTimes(2);
});
it("retries errors and bounds retention to 32 entries", async () => {
  const cache = new SnapshotToolCache();
  const fail = vi
    .fn()
    .mockRejectedValueOnce(new Error("external failure"))
    .mockResolvedValue({ content: "safe", truncated: false });
  await expect(cache.read("failed", fail)).rejects.toThrow();
  await cache.read("failed", fail);
  const execute = vi.fn(async () => ({ content: "safe", truncated: false }));
  for (let i = 0; i < 33; i++) await cache.read(`read-${i}`, execute);
  await cache.read("read-0", execute);
  expect(execute).toHaveBeenCalledTimes(34);
});
