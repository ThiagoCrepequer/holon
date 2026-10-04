import type {
  ChangedSymbol,
  ContractBreakSignal,
  DownstreamReference,
} from "@holon/contracts";
import { parsePatch } from "diff";

const sqlDestructivePatterns: readonly {
  readonly description: string;
  readonly regex: RegExp;
  readonly severity: "critical" | "high";
}[] = [
  {
    description: "Destructive database operation: DROP TABLE",
    regex: /\bDROP\s+TABLE\b/iu,
    severity: "critical",
  },
  {
    description: "Destructive database operation: DROP COLUMN",
    regex:
      /\b(?:ALTER\s+TABLE\s+\S+\s+)?DROP\s+(?:COLUMN\s+)?([A-Za-z0-9_]+)\b/iu,
    severity: "critical",
  },
  {
    description: "Destructive database operation: TRUNCATE TABLE",
    regex: /\bTRUNCATE\s+(?:TABLE\s+)?/iu,
    severity: "critical",
  },
];

function isContractBoundary(
  path: string,
  symbolName: string,
  downstreamReferences?: readonly DownstreamReference[],
): boolean {
  // Only internal application modules (apps/*) without downstream consumers are exempt from contract break alerts.
  // In shared packages (packages/*, libs/*) or standard repository libraries (src/*, lib/*), exports form the API surface.
  if (path.startsWith("apps/")) {
    const isEntrypoint =
      /(?:^|\/)(?:index|api|contracts?|public-api)\.[a-z]+$/iu.test(path);
    const hasDownstream =
      downstreamReferences !== undefined &&
      downstreamReferences.some((ref) => ref.symbolName === symbolName);
    return isEntrypoint || hasDownstream;
  }
  return true;
}

function addedTypeReexports(
  files: readonly { readonly patch: string; readonly path: string }[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const byPath = new Map<string, Set<string>>();
  for (const file of files) {
    if (!/\.(?:[cm]?ts|tsx)$/iu.test(file.path)) continue;
    let patches;
    try {
      patches = parsePatch(file.patch);
    } catch {
      continue;
    }
    for (const patch of patches) {
      for (const hunk of patch.hunks ?? []) {
        for (const line of hunk.lines) {
          if (!line.startsWith("+")) continue;
          const reexport =
            /^\+\s*export\s+type\s*\{([^}]+)\}\s*from\s*["'][^"']+["']\s*;?\s*$/u.exec(
              line,
            );
          if (reexport?.[1] === undefined) continue;
          const names = byPath.get(file.path) ?? new Set<string>();
          for (const entry of reexport[1].split(",")) {
            const specifier =
              /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/u.exec(
                entry,
              );
            const publicName = specifier?.[2] ?? specifier?.[1];
            if (publicName !== undefined) names.add(publicName);
          }
          byPath.set(file.path, names);
        }
      }
    }
  }
  return byPath;
}

export function detectContractBreaks(
  files: readonly { readonly patch: string; readonly path: string }[],
  changedSymbols: readonly ChangedSymbol[],
  downstreamReferences?: readonly DownstreamReference[],
): readonly ContractBreakSignal[] {
  const breaks: ContractBreakSignal[] = [];
  const reexports = addedTypeReexports(files);

  // 1. Detect removed exported symbols on contract boundaries
  for (const symbol of changedSymbols) {
    if (
      symbol.isExported &&
      symbol.change === "deleted" &&
      !(
        (symbol.kind === "interface" || symbol.kind === "type") &&
        reexports.get(symbol.path)?.has(symbol.name)
      ) &&
      isContractBoundary(symbol.path, symbol.name, downstreamReferences)
    ) {
      breaks.push({
        description: `Exported ${symbol.kind} '${symbol.name}' was removed from ${symbol.path}`,
        kind: "exported_symbol_removed",
        line: symbol.line,
        path: symbol.path,
        severity: "critical",
      });
    }
  }

  // 2. Detect destructive SQL migrations
  for (const file of files) {
    const isSql =
      file.path.endsWith(".sql") ||
      file.path.includes("migrations/") ||
      file.path.includes("migration");

    if (!isSql) continue;

    let patches;
    try {
      patches = parsePatch(file.patch);
    } catch {
      continue;
    }

    for (const patch of patches) {
      for (const hunk of patch.hunks ?? []) {
        let newLine = hunk.newStart;
        for (const rawLine of hunk.lines) {
          if (rawLine.startsWith("+")) {
            const addedText = rawLine.slice(1);
            for (const pattern of sqlDestructivePatterns) {
              if (pattern.regex.test(addedText)) {
                breaks.push({
                  description: pattern.description,
                  kind: "sql_destructive_migration",
                  line: newLine,
                  path: file.path,
                  severity: pattern.severity,
                });
                break;
              }
            }
            newLine += 1;
          } else if (!rawLine.startsWith("-")) {
            newLine += 1;
          }
        }
      }
    }
  }

  return breaks;
}
