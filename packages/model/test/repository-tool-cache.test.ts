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
