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
export function projectStructuralImpact(
  input:
    | {
        readonly changedSymbols: readonly unknown[];
        readonly contractBreaks: readonly unknown[];
        readonly downstreamReferences: readonly unknown[];
        readonly securitySurfaces: readonly unknown[];
        readonly repositoryScanTruncated?: boolean | undefined;
        readonly omittedSignals?:
          | Readonly<
              Record<
                | "changedSymbols"
                | "contractBreaks"
                | "downstreamReferences"
                | "securitySurfaces",
                number
              >
            >
          | undefined;
      }
    | undefined,
  maximumBytes: number,
) {
  if (!input) return { content: "null", truncated: false, omitted: 0 };
  const output = {
    changedSymbols: [] as unknown[],
    contractBreaks: [] as unknown[],
    downstreamReferences: [] as unknown[],
    securitySurfaces: [] as unknown[],
    repositoryScanTruncated: input.repositoryScanTruncated ?? false,
    ...(input.omittedSignals ? { omittedSignals: input.omittedSignals } : {}),
    omitted: Object.values(input.omittedSignals ?? {}).reduce(
      (sum, count) => sum + count,
      0,
    ),
  };
  const groups = [
    "contractBreaks",
    "securitySurfaces",
    "downstreamReferences",
    "changedSymbols",
  ] as const;
  // Round-robin lets each kind present a lead before any kind consumes the remainder.
  const total = Math.max(...groups.map((key) => input[key].length));
  for (let index = 0; index < total; index++)
    for (const key of groups) {
      const item = input[key][index];
      if (item === undefined) continue;
      output[key].push(item);
      if (
        new TextEncoder().encode(JSON.stringify(output)).byteLength >
        maximumBytes - 64
      ) {
        output[key].pop();
        output.omitted++;
      }
    }
  return {
    content: JSON.stringify(output),
    truncated: output.omitted > 0,
    omitted: output.omitted,
  };
}
