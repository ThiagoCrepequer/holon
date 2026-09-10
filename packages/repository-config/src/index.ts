import { RepositoryConfigurationError } from "@holon/application";
import { repositoryConfigLimits } from "@holon/contracts";
import {
  isAlias,
  isCollection,
  isNode,
  isPair,
  isScalar,
  parseDocument,
  visit,
} from "yaml";

export function parseRepositoryConfigurationYaml(text: string): unknown {
  if (
    new TextEncoder().encode(text).byteLength > repositoryConfigLimits.yamlBytes
  )
    throw new RepositoryConfigurationError("budget_exceeded");
  // Directives could select YAML 1.1 or define tag handles. Neither is accepted.
  if (/^%/mu.test(text)) throw new RepositoryConfigurationError("invalid_yaml");
  try {
    const document = parseDocument(text, {
      version: "1.2",
      prettyErrors: false,
      uniqueKeys: true,
      strict: true,
    });
    if (document.errors.length > 0 || document.warnings.length > 0) {
      const position =
        (document.errors[0] ?? document.warnings[0])?.pos[0] ?? 0;
      const preceding = text.slice(0, position);
      throw new RepositoryConfigurationError("invalid_yaml", "configuration", {
        line: preceding.split("\n").length,
        column: position - preceding.lastIndexOf("\n"),
      });
    }
    let nodes = 0;
    visit(document, (_key, node, path) => {
      nodes += 1;
      if (
        nodes > repositoryConfigLimits.astNodes ||
        path.length > repositoryConfigLimits.astDepth
      )
        throw new Error();
      if (
        isAlias(node) ||
        (isNode(node) && (node.anchor !== undefined || node.tag !== undefined))
      )
        throw new Error();
      if (
        isPair(node) &&
        (!isScalar(node.key) ||
          typeof node.key.value !== "string" ||
          ["<<", "__proto__", "constructor", "prototype"].includes(
            node.key.value,
          ))
      )
        throw new Error();
    });
    if (!isCollection(document.contents)) throw new Error();
    const value: unknown = document.toJS({ maxAliasCount: 0, mapAsMap: false });
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch (error) {
    if (error instanceof RepositoryConfigurationError) throw error;
    throw new RepositoryConfigurationError("invalid_yaml");
  }
}
