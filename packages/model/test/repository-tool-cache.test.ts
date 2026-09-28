import { expect, it, vi } from "vitest";

import { createRepositoryToolCache } from "../src/repository-tool-cache.js";
const call = {
  name: "read_file" as const,
  arguments: { path: "src/a.ts", startLine: 1 },
};
it("coalesces concurrent identical reads and keeps different ranges isolated", async () => {
  const run = vi.fn(async () => ({ content: "source", truncated: false }));
  const runner = createRepositoryToolCache({ run });
  const results = await Promise.all([runner.run(call), runner.run(call)]);
  expect(run).toHaveBeenCalledTimes(1);
  expect(results[0]).toEqual(results[1]);
  await runner.run({ ...call, arguments: { ...call.arguments, startLine: 2 } });
  expect(run).toHaveBeenCalledTimes(2);
  await createRepositoryToolCache({ run }).run(call);
  expect(run).toHaveBeenCalledTimes(3);
});
it("retries failed reads instead of caching a failure or fabricating an empty result", async () => {
  const run = vi
    .fn()
    .mockRejectedValueOnce(new Error("read failed"))
    .mockResolvedValue({ content: "ok", truncated: false });
  const runner = createRepositoryToolCache({ run });
  await expect(runner.run(call)).rejects.toThrow("read failed");
  await expect(runner.run(call)).resolves.toEqual({
    content: "ok",
    truncated: false,
  });
  expect(run).toHaveBeenCalledTimes(2);
});

it("reuses complete covering reads with equivalent defaults without another executor call", async () => {
  const run = vi.fn(async () => ({
    content: "one\ntwo\nthree\nfour",
    truncated: false,
  }));
  const runner = createRepositoryToolCache({ run });
  await runner.run({
    name: "read_file",
    arguments: { path: "src/a.ts", startLine: 1, endLine: 4 },
  });
  await expect(
    runner.run({
      name: "read_file",
      arguments: { path: "src/a.ts", startLine: 2, endLine: 3 },
    }),
  ).resolves.toEqual({ content: "two\nthree", truncated: false });
  expect(run).toHaveBeenCalledOnce();
});

it("canonicalizes default read ranges and unordered search paths", async () => {
  const run = vi.fn(async () => ({ content: "source", truncated: false }));
  const runner = createRepositoryToolCache({ run });
  await runner.run({ name: "read_file", arguments: { path: "src/a.ts" } });
  await runner.run({
    name: "read_file",
    arguments: { path: "src/a.ts", startLine: 1, endLine: 200 },
  });
  await runner.run({
    name: "search_text",
    arguments: { query: "symbol", maxResults: 10, paths: ["b.ts", "a.ts"] },
  });
  await runner.run({
    name: "search_text",
    arguments: { query: "symbol", maxResults: 10, paths: ["a.ts", "b.ts"] },
  });
  expect(run).toHaveBeenCalledTimes(2);
});

it("never covers a range from truncated, empty or incomplete reads", async () => {
  const run = vi
    .fn()
    .mockResolvedValueOnce({ content: "one\ntwo", truncated: true })
    .mockResolvedValueOnce({ content: "", truncated: false })
    .mockResolvedValue({ content: "source", truncated: false });
  const cache = createRepositoryToolCache({ run });
  await cache.run({
    name: "read_file",
    arguments: { path: "a.ts", startLine: 1, endLine: 10 },
  });
  await cache.run({
    name: "read_file",
    arguments: { path: "a.ts", startLine: 1, endLine: 2 },
  });
  await cache.run({
    name: "read_file",
    arguments: { path: "a.ts", startLine: 2, endLine: 2 },
  });
  expect(run).toHaveBeenCalledTimes(3);
  expect(cache.metrics()).toMatchObject({
    requests: 3,
    hits: 0,
    truncatedResults: 1,
  });
});
it("rejects cached work after cancellation and does not retain a late cancelled result", async () => {
  const controller = new AbortController();
  const run = vi.fn(async () => {
    controller.abort();
    return { content: "source", truncated: false };
  });
  const cache = createRepositoryToolCache({ run });
  await expect(
    cache.run(call, { abortSignal: controller.signal }),
  ).rejects.toThrow();
  expect(() => cache.run(call, { abortSignal: controller.signal })).toThrow();
  await cache.run(call);
  expect(run).toHaveBeenCalledTimes(2);
});

it("does not infer line positions through redacted multiline source", async () => {
  const run = vi.fn(async () => ({
    content: "[REDACTED_SECRET]\nreturn value;",
    truncated: false,
  }));
  const cache = createRepositoryToolCache({ run });
  await cache.run({
    name: "read_file",
    arguments: { path: "src/a.ts", startLine: 1, endLine: 100 },
  });
  await cache.run({
    name: "read_file",
    arguments: { path: "src/a.ts", startLine: 2, endLine: 2 },
  });
  expect(run).toHaveBeenCalledTimes(2);
});
