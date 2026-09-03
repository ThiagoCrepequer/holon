import type { ChangedSymbol, ChangedSymbolKind } from "@holon/contracts";
import { parsePatch } from "diff";

interface ExtractedRawSymbol {
  readonly isExported: boolean;
  readonly kind: ChangedSymbolKind;
  readonly line: number;
  readonly name: string;
  readonly type: "added" | "removed";
}

interface LanguagePatterns {
  readonly exportedDetector: (line: string, symbolName: string) => boolean;
  readonly extensions: readonly string[];
  readonly matchers: readonly {
    readonly kind: ChangedSymbolKind;
    readonly regex: RegExp;
  }[];
}

const languageConfigs: readonly LanguagePatterns[] = [
  // TypeScript & JavaScript
  {
    exportedDetector: (line: string) =>
      /\bexport\b/u.test(line) || /\bmodule\.exports\b/u.test(line),
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
    matchers: [
      {
        kind: "function",
        regex:
          /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/u,
      },
      {
        kind: "class",
        regex:
          /(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/u,
      },
      {
        kind: "interface",
        regex: /(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/u,
      },
      {
        kind: "type",
        regex: /(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/u,
      },
      {
        kind: "constant",
        regex:
          /(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*[:=]\s*(?:(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>|function\b|)/u,
      },
      {
        kind: "variable",
        regex: /(?:export\s+)?(?:let|var)\s+([A-Za-z0-9_$]+)\s*[:=]/u,
      },
    ],
  },
  // Python
  {
    exportedDetector: (_line: string, name: string) => !name.startsWith("_"),
    extensions: [".py"],
    matchers: [
      {
        kind: "function",
        regex: /(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(/u,
      },
      {
        kind: "class",
        regex: /class\s+([A-Za-z0-9_]+)/u,
      },
      {
        kind: "constant",
        regex: /^([A-Z][A-Z0-9_]+)\s*[:=]/u,
      },
    ],
  },
  // Go
  {
    exportedDetector: (_line: string, name: string) => /^[A-Z]/u.test(name),
    extensions: [".go"],
    matchers: [
      {
        kind: "function",
        regex: /func\s+(?:\([^)]+\)\s*)?([A-Za-z0-9_]+)\s*\(/u,
      },
      {
        kind: "interface",
        regex: /type\s+([A-Za-z0-9_]+)\s+interface\b/u,
      },
      {
        kind: "type",
        regex: /type\s+([A-Za-z0-9_]+)\s+struct\b/u,
      },
      {
        kind: "constant",
        regex: /(?:const|var)\s+([A-Za-z0-9_]+)\s*(?:=|[A-Za-z0-9_]+)/u,
      },
    ],
  },
  // Rust
  {
    exportedDetector: (line: string) => /\bpub\b/u.test(line),
    extensions: [".rs"],
    matchers: [
      {
        kind: "function",
        regex:
          /(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)\s*(?:<[^>]+>)?\s*\(/u,
      },
      {
        kind: "class",
        regex: /(?:pub(?:\([^)]+\))?\s+)?struct\s+([A-Za-z0-9_]+)/u,
      },
      {
        kind: "interface",
        regex: /(?:pub(?:\([^)]+\))?\s+)?trait\s+([A-Za-z0-9_]+)/u,
      },
      {
        kind: "type",
        regex: /(?:pub(?:\([^)]+\))?\s+)?enum\s+([A-Za-z0-9_]+)/u,
      },
      {
        kind: "constant",
        regex: /(?:pub(?:\([^)]+\))?\s+)?const\s+([A-Za-z0-9_]+)/u,
      },
    ],
  },
  // Java
  {
    exportedDetector: (line: string) => /\b(?:public|protected)\b/u.test(line),
    extensions: [".java"],
    matchers: [
      {
        kind: "class",
        regex:
          /(?:public|protected|private)?\s*(?:static\s+)?(?:final\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/u,
      },
      {
        kind: "interface",
        regex:
          /(?:public|protected|private)?\s*(?:static\s+)?interface\s+([A-Za-z0-9_]+)/u,
      },
      {
        kind: "function",
        regex:
          /(?:public|protected|private)\s+(?:static\s+)?(?:final\s+)?[A-Za-z0-9_<>[\]]+\s+([A-Za-z0-9_]+)\s*\(/u,
      },
    ],
  },
];

function findLanguageConfig(filePath: string): LanguagePatterns | undefined {
  const lower = filePath.toLowerCase();
  return languageConfigs.find((config) =>
    config.extensions.some((ext) => lower.endsWith(ext)),
  );
}

function extractRawSymbolsFromLine(
  line: string,
  lineNumber: number,
  type: "added" | "removed",
  config: LanguagePatterns,
): ExtractedRawSymbol | undefined {
  for (const matcher of config.matchers) {
    const match = matcher.regex.exec(line);
    if (match?.[1]) {
      const name = match[1];
      const isExported = config.exportedDetector(line, name);
      return {
        isExported,
        kind: matcher.kind,
        line: lineNumber,
        name,
        type,
      };
    }
  }
  return undefined;
}

export function extractChangedSymbols(
  files: readonly { readonly patch: string; readonly path: string }[],
): readonly ChangedSymbol[] {
  const changedSymbols: ChangedSymbol[] = [];

  for (const file of files) {
    const config = findLanguageConfig(file.path);
    if (!config) continue;

    let patches;
    try {
      patches = parsePatch(file.patch);
    } catch {
      continue;
    }

    const addedSymbols = new Map<string, ExtractedRawSymbol>();
    const removedSymbols = new Map<string, ExtractedRawSymbol>();

    for (const patch of patches) {
      for (const hunk of patch.hunks ?? []) {
        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;

        for (const rawLine of hunk.lines) {
          if (rawLine.startsWith("+")) {
            const lineContent = rawLine.slice(1).trim();
            const symbol = extractRawSymbolsFromLine(
              lineContent,
              newLine,
              "added",
              config,
            );
            if (symbol) {
              addedSymbols.set(symbol.name, symbol);
            }
            newLine += 1;
          } else if (rawLine.startsWith("-")) {
            const lineContent = rawLine.slice(1).trim();
            const symbol = extractRawSymbolsFromLine(
              lineContent,
              oldLine,
              "removed",
              config,
            );
            if (symbol) {
              removedSymbols.set(symbol.name, symbol);
            }
            oldLine += 1;
          } else {
            oldLine += 1;
            newLine += 1;
          }
        }
      }
    }

    // Correlate added and removed to determine status
    for (const [name, added] of addedSymbols.entries()) {
      const isModified = removedSymbols.has(name);
      changedSymbols.push({
        change: isModified ? "modified" : "added",
        isExported: added.isExported,
        kind: added.kind,
        line: added.line,
        name: added.name,
        path: file.path,
      });
      if (isModified) {
        removedSymbols.delete(name);
      }
    }

    for (const [, removed] of removedSymbols.entries()) {
      changedSymbols.push({
        change: "deleted",
        isExported: removed.isExported,
        kind: removed.kind,
        line: removed.line,
        name: removed.name,
        path: file.path,
      });
    }
  }

  return changedSymbols;
}
