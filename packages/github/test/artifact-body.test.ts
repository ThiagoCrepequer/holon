import { expect, it, vi } from "vitest";

import { readArtifactBody } from "../src/artifact-body.js";
it("cancels a streamed artifact before retaining bytes beyond its limit", async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4));
      controller.enqueue(new Uint8Array(4));
    },
    cancel,
  });
  await expect(readArtifactBody(stream, {}, 6)).rejects.toThrow("limit");
  expect(cancel).toHaveBeenCalledOnce();
});
it("reads streamed ZIP bytes and rejects oversized declared length", async () => {
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array([1, 2]));
      c.close();
    },
  });
  expect([...new Uint8Array(await readArtifactBody(body, {}, 4))]).toEqual([
    1, 2,
  ]);
  await expect(
    readArtifactBody(new ReadableStream(), { "content-length": "50" }, 4),
  ).rejects.toThrow("limit");
});
