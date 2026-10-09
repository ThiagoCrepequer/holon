/** Preserve complete JSON entries and report every omission within a UTF-8 budget. */
export function projectContextList(
  items: readonly unknown[],
  maximumBytes: number,
) {
  const selected: unknown[] = [];
  let omitted = 0;
  for (const item of items) {
    selected.push(item);
    if (
      new TextEncoder().encode(JSON.stringify(selected)).byteLength >
      maximumBytes
    ) {
      selected.pop();
      omitted++;
    }
  }
  return { content: JSON.stringify(selected), truncated: omitted > 0, omitted };
}
