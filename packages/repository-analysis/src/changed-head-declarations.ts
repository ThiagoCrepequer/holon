import type { ChangedSymbol, ChangedSymbolKind } from "@holon/contracts";
import { parsePatch } from "diff";

import { parseRepositoryModule } from "./repository-module.js";

/** Bounded hints for declarations containing edits, not resolved dependency edges. */
export function changedHeadDeclarations(
  path: string,
  patch: string,
  content: string,
): readonly ChangedSymbol[] {
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/iu.test(path)) return [];
  const ast = parseRepositoryModule(content, path);
  if (!ast) return [];
  const additions = new Set<number>();
  const deletions = new Set<number>();
  try {
    for (const parsed of parsePatch(patch)) {
      for (const hunk of parsed.hunks) {
        let line = hunk.newStart;
        for (const raw of hunk.lines) {
          if (raw.startsWith("+")) additions.add(line++);
          else if (raw.startsWith("-")) deletions.add(line);
          else if (raw.startsWith(" ")) line++;
        }
      }
    }
  } catch {
    return [];
  }
  const exported = new Map<string, Set<string>>();
  for (const statement of ast.program.body) {
    if (statement.type !== "ExportNamedDeclaration" || statement.source)
      continue;
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ExportSpecifier" &&
        specifier.local.type === "Identifier"
      ) {
        const aliases = exported.get(specifier.local.name) ?? new Set<string>();
        aliases.add(
          specifier.exported.type === "Identifier"
            ? specifier.exported.name
            : specifier.exported.value,
        );
        exported.set(specifier.local.name, aliases);
      }
    }
  }
  const symbols: ChangedSymbol[] = [];
  const add = (
    name: string,
    kind: ChangedSymbolKind,
    location:
      | { start: { line: number }; end: { line: number } }
      | null
      | undefined,
    isExported: boolean,
  ) => {
    if (!location) return;
    const { start, end } = location;
    const containsEdit =
      [...additions].some((line) => line >= start.line && line <= end.line) ||
      [...deletions].some((line) => line > start.line && line <= end.line);
    if (containsEdit) {
      symbols.push({
        path,
        name,
        kind,
        line: start.line,
        isExported: isExported || exported.has(name),
        change: "modified",
      });
      for (const alias of exported.get(name) ?? []) {
        // Default imports have arbitrary local names; "default" is not an identifier lead.
        if (alias === name || alias === "default") continue;
        symbols.push({
          path,
          name: alias,
          kind,
          line: start.line,
          isExported: true,
          change: "modified",
        });
      }
    }
  };
  for (const statement of ast.program.body) {
    const isExported =
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration";
    const declaration =
      isExported && "declaration" in statement
        ? statement.declaration
        : statement;
    if (!declaration) continue;
    switch (declaration.type) {
      case "FunctionDeclaration":
      case "ClassDeclaration":
      case "TSInterfaceDeclaration":
      case "TSTypeAliasDeclaration": {
        const kinds = {
          FunctionDeclaration: "function",
          ClassDeclaration: "class",
          TSInterfaceDeclaration: "interface",
          TSTypeAliasDeclaration: "type",
        } as const;
        if (declaration.id)
          add(
            declaration.id.name,
            kinds[declaration.type],
            declaration.loc,
            isExported,
          );
        break;
      }
      case "VariableDeclaration":
        for (const variable of declaration.declarations) {
          if (variable.id.type === "Identifier")
            add(
              variable.id.name,
              declaration.kind === "const" ? "constant" : "variable",
              variable.loc,
              isExported,
            );
        }
        break;
      default:
        break;
    }
  }
  return symbols;
}
