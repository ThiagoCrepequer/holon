import { expect, it, vi } from "vitest";

import {
  contextPages,
  contextStream,
  readContextPages,
  readContextStream,
} from "../src/index.js";

it("streams more than 32 pages in one transfer and verifies all bytes", async () => {
  const text = "😀\n".repeat(400_000);
  const { manifest, pages } = await contextPages(text);
  const read = vi.fn(async (index: number) => pages[index]);
  expect(pages.length).toBeGreaterThan(32);
  expect(await readContextStream(contextStream(manifest, read))).toBe(text);
  expect(read).toHaveBeenCalledTimes(pages.length);
});

it("cancels oversized streams and rejects missing, corrupt and invalid UTF-8 data", async () => {
  const { manifest } = await contextPages("valid");
  for (const data of [
    new TextEncoder().encode("corrupt"),
    new TextEncoder().encode("other"),
    new Uint8Array([255]),
    new Uint8Array(0),
  ]) {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data);
      },
      cancel,
    });
    if (data.length > manifest.bytes || data.length === 0) {
      await expect(readContextStream({ manifest, stream })).rejects.toThrow();
      expect(cancel).toHaveBeenCalledOnce();
    } else {
      await stream.cancel();
      const finite = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(data);
          controller.close();
        },
      });
      await expect(
        readContextStream({ manifest, stream: finite }),
      ).rejects.toThrow();
    }
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
  await expect(readContextStream({ manifest, stream })).rejects.toThrow();
});

it("transfers multi-megabyte context with bounded JSON pages and intact Unicode", async () => {
  const text = ("\u0000".repeat(31_999) + "😀\n").repeat(35);
  const { manifest, pages } = await contextPages(text);
  expect(manifest.bytes).toBeGreaterThan(1_048_576);
  for (const page of pages)
    expect(
      new TextEncoder().encode(JSON.stringify(page)).byteLength,
    ).toBeLessThan(200_000);
  expect(await readContextPages(manifest, async (index) => pages[index])).toBe(
    text,
  );
  await expect(
    readContextPages(manifest, async (index) => pages[index] + "x"),
  ).rejects.toThrow();
  await expect(
    readContextPages(
      manifest,
      async (index) => pages[pages.length - index - 1],
    ),
  ).rejects.toThrow();
  await expect(readContextPages(manifest, async () => "")).rejects.toThrow();
  await expect(
    readContextPages({ ...manifest, pages: 99999 }, async () => "x"),
  ).rejects.toThrow();
});
