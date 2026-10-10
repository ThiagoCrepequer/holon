import { parseRepositoryModule } from "./repository-module.js";

export interface PreservedModuleExports {
  readonly types: ReadonlyMap<string, number>;
  readonly values: ReadonlyMap<string, number>;
}

export function extractModuleExports(
  source: string,
  filePath: string,
): PreservedModuleExports | undefined {
  const ast = parseRepositoryModule(source, filePath);
  if (!ast) return undefined;

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

  const types = new Map<string, number>();
  const values = new Map<string, number>();

  for (const stmt of ast.program.body) {
    if (stmt.type === "ExportNamedDeclaration") {
      const isStatementTypeOnly = stmt.exportKind === "type";
      const isExternalReexport =
        stmt.source !== null && stmt.source !== undefined;

      for (const spec of stmt.specifiers) {
        if (spec.type === "ExportSpecifier") {
          if (!spec.loc) continue;
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
              types.set(exportedName, spec.loc.start.line);
            }
          } else if (isExternalReexport) {
            values.set(exportedName, spec.loc.start.line);
            types.set(exportedName, spec.loc.start.line);
          } else {
            if (localValueDeclarations.has(localName)) {
              values.set(exportedName, spec.loc.start.line);
            }
            if (localTypeDeclarations.has(localName)) {
              types.set(exportedName, spec.loc.start.line);
            }
          }
        }
      }

      if (stmt.declaration) {
        const decl = stmt.declaration;
        if (!decl.loc) continue;
        const isAmbient = Boolean(
          ("declare" in decl && (decl as { declare?: boolean }).declare) ||
          ("declare" in stmt && (stmt as { declare?: boolean }).declare),
        );

        if (decl.type === "ClassDeclaration") {
          if (decl.id?.name) {
            types.set(decl.id.name, decl.loc.start.line);
            if (!isAmbient && !isStatementTypeOnly) {
              values.set(decl.id.name, decl.loc.start.line);
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
              values.set(decl.id.name, decl.loc.start.line);
            }
          }
        } else if (decl.type === "VariableDeclaration") {
          if (!isAmbient && !isStatementTypeOnly) {
            for (const d of decl.declarations) {
              if (d.id.type === "Identifier") {
                values.set(d.id.name, d.loc?.start.line ?? 1);
              }
            }
          }
        } else if (
          decl.type === "TSInterfaceDeclaration" ||
          decl.type === "TSTypeAliasDeclaration"
        ) {
          if (decl.id?.name) {
            types.set(decl.id.name, decl.loc.start.line);
          }
        } else if (decl.type === "TSEnumDeclaration") {
          if (decl.id?.name) {
            types.set(decl.id.name, decl.loc.start.line);
            if (!isAmbient && !isStatementTypeOnly) {
              values.set(decl.id.name, decl.loc.start.line);
            }
          }
        }
      }
    }
  }

  return { types, values };
}
