import { z } from "zod";

import { reviewExecutionLimits } from "./review-execution-limits.js";

// Worst-case JSON escaping stays below 200 kB, independently of UTF-8 contents.
export const contextPageCharacters = 32_000;
export const contextManifestSchema = z.strictObject({
  digest: z.string().regex(/^[a-f0-9]{64}$/u),
  bytes: z.number().int().positive().max(reviewExecutionLimits.contextBytes),
  pages: z.number().int().positive().max(251),
});
export type ContextManifest = z.infer<typeof contextManifestSchema>;
export const contextPageSchema = z.string().min(1).max(contextPageCharacters);

export interface ContextTransfer {
  manifest: ContextManifest;
  stream: ReadableStream<Uint8Array>;
}

/** One RPC stream, with backpressure; pages never become Workflow outputs. */
export function contextStream(
  manifest: ContextManifest,
  read: (index: number, digest: string) => Promise<unknown>,
): ContextTransfer {
  const validated = contextManifestSchema.parse(manifest);
  let index = 0;
  return {
    manifest: validated,
    stream: new ReadableStream<Uint8Array>({
      async pull(controller) {
        const page = contextPageSchema.parse(
          await read(index++, validated.digest),
        );
        controller.enqueue(new TextEncoder().encode(page));
        if (index === validated.pages) controller.close();
      },
    }),
  };
}

export async function readContextStream(
  transfer: ContextTransfer,
): Promise<string> {
  const reader = transfer.stream.getReader();
  try {
    const manifest = contextManifestSchema.parse(transfer.manifest);
    const bytes = new Uint8Array(manifest.bytes);
    let offset = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (
        !(next.value instanceof Uint8Array) ||
        next.value.length === 0 ||
        offset + next.value.length > bytes.length
      )
        throw new Error("Invalid context stream length");
      bytes.set(next.value, offset);
      offset += next.value.length;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      offset !== bytes.length ||
      (await contextDigest(text)) !== manifest.digest
    )
      throw new Error("Context transfer integrity mismatch");
    return text;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function contextDigest(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}

export async function readContextPages(
  raw: unknown,
  read: (index: number, digest: string) => Promise<unknown>,
): Promise<string> {
  const manifest = contextManifestSchema.parse(raw);
  const pages: string[] = [];
  let bytes = 0;
  for (let index = 0; index < manifest.pages; index++) {
    const page = contextPageSchema.parse(await read(index, manifest.digest));
    bytes += new TextEncoder().encode(page).byteLength;
    if (bytes > manifest.bytes) throw new Error("Invalid context page length");
    pages.push(page);
  }
  const text = pages.join("");
  if (
    bytes !== manifest.bytes ||
    (await contextDigest(text)) !== manifest.digest
  )
    throw new Error("Context transfer integrity mismatch");
  return text;
}

export async function contextPages(
  text: string,
): Promise<{ manifest: ContextManifest; pages: string[] }> {
  const pages: string[] = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + contextPageCharacters, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]!)) end--;
    pages.push(text.slice(offset, end));
    offset = end;
  }
  return {
    manifest: contextManifestSchema.parse({
      digest: await contextDigest(text),
      bytes: new TextEncoder().encode(text).byteLength,
      pages: pages.length,
    }),
    pages,
  };
}
