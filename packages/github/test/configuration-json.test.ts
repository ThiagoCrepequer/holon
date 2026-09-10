import { expect, it } from "vitest";

import { readConfigurationJson } from "../src/configuration-json.js";

it("decodes bounded UTF-8 JSON across streamed byte boundaries", async () => {
  const bytes = new TextEncoder().encode('{"value":"é"}');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  await expect(readConfigurationJson(stream, bytes.length)).resolves.toEqual({
    value: "é",
  });
});
it("cancels an oversized response before consuming subsequent chunks", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(33));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(readConfigurationJson(stream, 32)).rejects.toMatchObject({
    code: "too_large",
  });
  expect(cancelled).toBe(true);
});
it("does not expose invalid JSON or bytes in diagnostics", async () => {
  const stream = new Response("private-invalid-json").body!;
  await expect(readConfigurationJson(stream, 100)).rejects.toThrow(
    "invalid_file",
  );
});

it("rejects non-stream bodies and invalid chunks even when cancellation rejects", async () => {
  await expect(readConfigurationJson({}, 100)).rejects.toMatchObject({
    code: "invalid_file",
  });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("invalid");
    },
    cancel() {
      return Promise.reject(new Error("private error"));
    },
  });
  await expect(readConfigurationJson(stream, 100)).rejects.toMatchObject({
    code: "invalid_file",
  });
});
