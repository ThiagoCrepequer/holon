/** Byte counts only. This diagnostic must never retain request text or content. */
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const fieldBytes = (name: string, value: unknown) =>
  value === undefined
    ? 0
    : bytes(JSON.stringify(name) + ":" + JSON.stringify(value));

export function profileModelInput(raw: string, body: Record<string, unknown>) {
  let instructionBytes = 0;
  let canonicalBytes = 0;
  let historyBytes = 0;
  let canonicalSeen = false;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (const message of messages) {
    const size = bytes(JSON.stringify(message));
    const role =
      typeof message === "object" && message !== null && "role" in message
        ? message.role
        : undefined;
    if (role === "system" || role === "developer") instructionBytes += size;
    else if (role === "user" && !canonicalSeen) {
      canonicalBytes += size;
      canonicalSeen = true;
    } else historyBytes += size;
  }
  const toolSchemaBytes = fieldBytes("tools", body.tools);
  const responseFormatBytes = fieldBytes(
    "response_format",
    body.response_format,
  );
  const totalBytes = bytes(raw);
  const otherBytes =
    totalBytes -
    instructionBytes -
    canonicalBytes -
    historyBytes -
    toolSchemaBytes -
    responseFormatBytes;
  if (otherBytes < 0) throw new Error("Invalid input profile partition");
  return {
    totalBytes,
    instructionBytes,
    canonicalBytes,
    historyBytes,
    toolSchemaBytes,
    responseFormatBytes,
    otherBytes,
    messages: messages.length,
  };
}
