/** Octokit parseSuccessResponseBody:false returns fetchResponse.body. */
export async function readArtifactBody(
  data: unknown,
  headers: Record<string, unknown>,
  limit = 10 * 1024 * 1024,
): Promise<ArrayBuffer> {
  if (!(data instanceof ReadableStream))
    throw new TypeError("GitHub artifact response must be streamed");
  const reader = data.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    if (Number(headers["content-length"]) > limit)
      throw new Error("Artifact download exceeds byte limit");
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array))
        throw new TypeError("Invalid artifact bytes");
      total += chunk.value.byteLength;
      if (total > limit)
        throw new Error("Artifact download exceeds byte limit");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes.buffer;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
