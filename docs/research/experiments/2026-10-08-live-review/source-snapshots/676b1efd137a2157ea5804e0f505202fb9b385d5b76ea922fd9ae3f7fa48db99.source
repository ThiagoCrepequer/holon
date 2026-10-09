import type { ChangedSymbol, DownstreamReference } from "@holon/contracts";

export interface DownstreamTracerFile {
  readonly content: string;
  readonly path: string;
}

export interface DownstreamTracerOptions {
  readonly maxReferences?: number;
}

/** Shared by JavaScript tracing and rg inventory discovery; no lookaround required. */
export function symbolReferencePattern(
  names: readonly string[],
): string | undefined {
  if (names.length === 0) return undefined;
  const continuation = "\\p{ID_Continue}$\\p{Join_Control}";
  return `(?:^|[^${continuation}])(?:${names.map(escapeRegExp).join("|")})(?:$|[^${continuation}])`;
}

export function findDownstreamReferences(
  symbols: readonly ChangedSymbol[],
  files: readonly DownstreamTracerFile[],
  options: DownstreamTracerOptions = {},
): {
  readonly references: readonly DownstreamReference[];
  readonly totalCount: number;
} {
  const maxReferences = options.maxReferences ?? 50;
  const targetSymbols = symbols.filter(
    (sym) =>
      sym.isExported && (sym.change === "modified" || sym.change === "deleted"),
  );

  if (targetSymbols.length === 0 || files.length === 0) {
    return { references: [], totalCount: 0 };
  }

  const references: DownstreamReference[] = [];
  let totalCount = 0;

  for (const symbol of targetSymbols) {
    const pattern = symbolReferencePattern([symbol.name]);
    if (pattern === undefined) continue;
    const identifierRegex = new RegExp(pattern, "u");

    for (const file of files) {
      if (file.path === symbol.path) continue; // Skip the declaring file itself

      // Quick check if file even contains the symbol identifier
      if (!identifierRegex.test(file.content)) continue;

      const lines = file.content.split("\n");
      for (const [lineIndex, line] of lines.entries()) {
        if (identifierRegex.test(line)) {
          totalCount += 1;
          if (references.length < maxReferences) {
            references.push({
              callerLine: lineIndex + 1,
              callerPath: file.path,
              excerpt: line.trim().slice(0, 300),
              symbolName: symbol.name,
              targetPath: symbol.path,
            });
          }
        }
      }
    }
  }

  return { references, totalCount };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
