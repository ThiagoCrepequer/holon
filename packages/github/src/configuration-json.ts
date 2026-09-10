import { RepositoryConfigurationError } from "@holon/application";

/** Bound authenticated Git-object responses before allocating/parsing their full JSON. */
export async function readConfigurationJson(
  stream: unknown,
  maximumBytes: number,
): Promise<unknown> {
  if (!(stream instanceof ReadableStream))
    throw new RepositoryConfigurationError("invalid_file");
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array))
        throw new RepositoryConfigurationError("invalid_file");
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes)
        throw new RepositoryConfigurationError("too_large");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof RepositoryConfigurationError) throw error;
    throw new RepositoryConfigurationError("invalid_file");
  } finally {
    reader.releaseLock();
  }
}
