import { parse } from "@babel/parser";
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

interface PreservedModuleExports {
  readonly types: Set<string>;
  readonly values: Set<string>;
}

function getBabelPlugins(
  filePath: string,
): import("@babel/parser").ParserPlugin[] {
  const lower = filePath.toLowerCase();
  const isTs = /\.(?:[cm]?ts|tsx)$/u.test(lower);
  const isJsx = /\.[jt]sx$/u.test(lower);
  const plugins: import("@babel/parser").ParserPlugin[] = [];
  if (isTs) plugins.push("typescript");
  if (isJsx) plugins.push("jsx");
  return plugins;
}

function extractExportsFromAst(
  source: string,
  filePath: string,
): PreservedModuleExports | undefined {
  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: getBabelPlugins(filePath),
    });
  } catch {
    return undefined;
  }

  const localTypeDeclarations = new Set<string>();
  const localValueDeclarations = new Set<string>();

  for (const rawStmt of ast.program.body) {
    const isNamedExport = rawStmt.type === "ExportNamedDeclaration";
    const isDefaultExport = rawStmt.type === "ExportDefaultDeclaration";
    const stmt =
      (isNamedExport || isDefaultExport) && "declaration" in rawStmt
        ? rawStmt.declaration
        : rawStmt;
    if (!stmt) continue;

    const isAmbient =
      ("declare" in stmt && (stmt as { declare?: boolean }).declare) ||
      (isNamedExport &&
        (("declare" in rawStmt && (rawStmt as { declare?: boolean }).declare) ||
          rawStmt.exportKind === "type"));

    if (
      stmt.type === "TSInterfaceDeclaration" ||
      stmt.type === "TSTypeAliasDeclaration"
    ) {
      if (stmt.id?.name) localTypeDeclarations.add(stmt.id.name);
    } else if (stmt.type === "ClassDeclaration") {
      if (stmt.id?.name) {
        localTypeDeclarations.add(stmt.id.name);
        if (!isAmbient) {
          localValueDeclarations.add(stmt.id.name);
        }
      }
    } else if (stmt.type === "FunctionDeclaration") {
      if (stmt.id?.name && !isAmbient) {
        localValueDeclarations.add(stmt.id.name);
      }
    } else if (stmt.type === "VariableDeclaration") {
      if (!isAmbient) {
        for (const d of stmt.declarations) {
          if (d.id.type === "Identifier") localValueDeclarations.add(d.id.name);
        }
      }
    } else if (stmt.type === "TSEnumDeclaration") {
      if (stmt.id?.name) {
        localTypeDeclarations.add(stmt.id.name);
        if (!isAmbient) {
          localValueDeclarations.add(stmt.id.name);
        }
      }
    }
  }

  const types = new Set<string>();
  const values = new Set<string>();

  for (const stmt of ast.program.body) {
    if (stmt.type === "ExportNamedDeclaration") {
      const isStatementTypeOnly = stmt.exportKind === "type";
      const isExternalReexport =
        stmt.source !== null && stmt.source !== undefined;

      for (const spec of stmt.specifiers) {
        if (spec.type === "ExportSpecifier") {
          const isSpecTypeOnly = spec.exportKind === "type";
          const localName =
            spec.local.type === "Identifier"
              ? spec.local.name
              : spec.local.value;
          const exportedName =
            spec.exported.type === "Identifier"
              ? spec.exported.name
              : spec.exported.value;

          if (isStatementTypeOnly || isSpecTypeOnly) {
            if (isExternalReexport || localTypeDeclarations.has(localName)) {
              types.add(exportedName);
            }
          } else if (isExternalReexport) {
            values.add(exportedName);
            types.add(exportedName);
          } else {
            if (localValueDeclarations.has(localName)) {
              values.add(exportedName);
            }
            if (localTypeDeclarations.has(localName)) {
              types.add(exportedName);
            }
          }
        }
      }

      if (stmt.declaration) {
        const decl = stmt.declaration;
        const isAmbient = Boolean(
          ("declare" in decl && (decl as { declare?: boolean }).declare) ||
          ("declare" in stmt && (stmt as { declare?: boolean }).declare),
        );

        if (decl.type === "ClassDeclaration") {
          if (decl.id?.name) {
            types.add(decl.id.name);
            if (!isAmbient && !isStatementTypeOnly) {
              values.add(decl.id.name);
            }
          }
        } else if (
          decl.type === "FunctionDeclaration" ||
          decl.type === "TSDeclareFunction"
        ) {
          if (decl.id?.name) {
            if (
              !isAmbient &&
              !isStatementTypeOnly &&
              decl.type === "FunctionDeclaration"
            ) {
              values.add(decl.id.name);
            }
          }
        } else if (decl.type === "VariableDeclaration") {
          if (!isAmbient && !isStatementTypeOnly) {
            for (const d of decl.declarations) {
              if (d.id.type === "Identifier") {
                values.add(d.id.name);
              }
            }
          }
        } else if (
          decl.type === "TSInterfaceDeclaration" ||
          decl.type === "TSTypeAliasDeclaration"
        ) {
          if (decl.id?.name) {
            types.add(decl.id.name);
          }
        } else if (decl.type === "TSEnumDeclaration") {
          if (decl.id?.name) {
            types.add(decl.id.name);
            if (!isAmbient && !isStatementTypeOnly) {
              values.add(decl.id.name);
            }
          }
        }
      }
    }
  }

  return { types, values };
}

export function detectContractBreaks(
  files: readonly { readonly patch: string; readonly path: string }[],
  changedSymbols: readonly ChangedSymbol[],
  downstreamReferences?: readonly DownstreamReference[],
  repositoryFiles?: readonly {
    readonly content: string;
    readonly path: string;
  }[],
): readonly ContractBreakSignal[] {
  const breaks: ContractBreakSignal[] = [];

  const sourceByPath = new Map<string, string>();
  if (repositoryFiles) {
    for (const rf of repositoryFiles) {
      sourceByPath.set(rf.path, rf.content);
    }
  }

  const parsedExportsByPath = new Map<
    string,
    PreservedModuleExports | undefined
  >();

  // 1. Detect removed exported symbols on contract boundaries
  for (const symbol of changedSymbols) {
    if (
      symbol.isExported &&
      symbol.change === "deleted" &&
      isContractBoundary(symbol.path, symbol.name, downstreamReferences)
    ) {
      let isPreserved = false;
      const source = sourceByPath.get(symbol.path);
      if (source !== undefined) {
        let exports = parsedExportsByPath.get(symbol.path);
        if (!parsedExportsByPath.has(symbol.path)) {
          exports = extractExportsFromAst(source, symbol.path);
          parsedExportsByPath.set(symbol.path, exports);
        }
        if (exports !== undefined) {
          isPreserved =
            symbol.kind === "interface" || symbol.kind === "type"
              ? exports.types.has(symbol.name)
              : exports.values.has(symbol.name);
        }
      }

      if (!isPreserved) {
        breaks.push({
          description: `Exported ${symbol.kind} '${symbol.name}' was removed from ${symbol.path}`,
          kind: "exported_symbol_removed",
          line: symbol.line,
          path: symbol.path,
          severity: "critical",
        });
      }
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
