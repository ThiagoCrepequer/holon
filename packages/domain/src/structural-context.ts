/** One UTF-8 context budget for structural planning and model projection. */
export const structuralContextLimits = {
  maximumBytes: 24_000,
  omissionCounterReserveBytes: 64,
} as const;

interface StructuralPaths {
  readonly changedSymbols: readonly { readonly path: string }[];
  readonly contractBreaks: readonly { readonly path: string }[];
  readonly downstreamReferences: readonly {
    readonly targetPath: string;
    readonly callerPath: string;
  }[];
  readonly securitySurfaces: readonly { readonly path: string }[];
}

/** Preserve metadata and complete records while selecting the same paths for every caller. */
export function selectStructuralImpact<T extends StructuralPaths>(
  input: T,
  paths: readonly string[],
): T {
  const selected = new Set(paths);
  return {
    ...input,
    changedSymbols: input.changedSymbols.filter((signal) =>
      selected.has(signal.path),
    ),
    contractBreaks: input.contractBreaks.filter((signal) =>
      selected.has(signal.path),
    ),
    downstreamReferences: input.downstreamReferences.filter(
      (signal) =>
        selected.has(signal.targetPath) || selected.has(signal.callerPath),
    ),
    securitySurfaces: input.securitySurfaces.filter((signal) =>
      selected.has(signal.path),
    ),
  };
}

interface StructuralContextInput {
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

function structuralEnvelope(input: StructuralContextInput) {
  return {
    changedSymbols: [...input.changedSymbols],
    contractBreaks: [...input.contractBreaks],
    downstreamReferences: [...input.downstreamReferences],
    securitySurfaces: [...input.securitySurfaces],
    repositoryScanTruncated: input.repositoryScanTruncated ?? false,
    ...(input.omittedSignals ? { omittedSignals: input.omittedSignals } : {}),
    // Producer gaps describe the run's inventory, not bytes lost by this projection.
    omitted: 0,
  };
}

/** Measure the full envelope once; packing must not rely on an already-truncated projection. */
export function structuralImpactFits(
  input: StructuralContextInput | undefined,
): boolean {
  return (
    !input ||
    new TextEncoder().encode(JSON.stringify(structuralEnvelope(input)))
      .byteLength <=
      structuralContextLimits.maximumBytes -
        structuralContextLimits.omissionCounterReserveBytes
  );
}

export function projectStructuralImpact(
  input: StructuralContextInput | undefined,
  maximumBytes: number,
) {
  if (!input) return { content: "null", truncated: false, omitted: 0 };
  const output = structuralEnvelope({
    ...input,
    changedSymbols: [],
    contractBreaks: [],
    downstreamReferences: [],
    securitySurfaces: [],
  });
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
        maximumBytes - structuralContextLimits.omissionCounterReserveBytes
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
