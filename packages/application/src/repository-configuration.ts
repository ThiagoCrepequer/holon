import {
  configurationIdentitySchema,
  configurationCompilerIdentity,
  repositoryConfigInputSchema,
  repositoryConfigLimits as limits,
  repositoryPolicyGlobSchema,
  runConfigurationSnapshotSchema,
  type ConfigurationIdentity,
  type InstructionEntry,
  type ResolvedRepositoryConfig,
  type RunConfigurationSnapshot,
} from "@holon/contracts";

import { validateCompatibilityDeclaration } from "./configuration-compatibility.js";
import { RepositoryConfigurationError } from "./repository-configuration-error.js";

export type ConfigurationReadResult =
  | { kind: "found"; bytes: Uint8Array }
  | {
      kind:
        | "absent"
        | "access_denied"
        | "snapshot_unavailable"
        | "invalid_file"
        | "too_large"
        | "transient_failure";
      retryAfterMs?: number | undefined;
    };
/** Bound to one installation/repository/base SHA by the adapter. Absence requires a complete tree listing. */
export interface ConfigurationSnapshotReader {
  readFile(
    path: string,
    maximumBytes: number,
  ): Promise<ConfigurationReadResult>;
  directoryExists(path: string): Promise<boolean>;
  isReferenceAllowed(
    path: string,
    additionalExcludes: readonly string[],
  ): boolean;
}
export function canonicalConfigurationJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalConfigurationJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(
        ([key, item]) =>
          `${JSON.stringify(key)}:${canonicalConfigurationJson(item)}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export async function configurationDigest(
  value: string | Uint8Array,
): Promise<string> {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(value);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
function budget(size: number, maximum: number, location: string): void {
  if (size > maximum)
    throw new RepositoryConfigurationError("budget_exceeded", location);
}
function decode(bytes: Uint8Array, location: string): string {
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      value.includes("\0") ||
      value.startsWith("version https://git-lfs.github.com/spec/")
    )
      throw new Error();
    return value;
  } catch {
    throw new RepositoryConfigurationError("invalid_file", location);
  }
}

export async function compileRepositoryConfiguration(
  identity: ConfigurationIdentity,
  reader: ConfigurationSnapshotReader,
  parse: (text: string) => unknown,
  compilerIdentity = configurationCompilerIdentity,
): Promise<RunConfigurationSnapshot> {
  configurationIdentitySchema.parse(identity);
  if (
    identity.runId !==
    `github:${identity.repositoryId}:pr:${identity.pullRequestNumber}:head:${identity.headSha}:base:${identity.baseSha}`
  )
    throw new RepositoryConfigurationError("identity_mismatch");
  let totalBytes = 0;
  const sources = new Map<string, string>();
  const sourceContent = new Map<string, string>();
  const read = async (
    path: string,
    maximum: number,
  ): Promise<string | undefined> => {
    const cached = sourceContent.get(path);
    if (cached !== undefined) {
      budget(byteLength(cached), maximum, path);
      return cached;
    }
    const result = await reader.readFile(path, maximum);
    if (result.kind === "absent") return undefined;
    if (result.kind !== "found")
      throw new RepositoryConfigurationError(result.kind, path, {
        retryAfterMs: result.retryAfterMs,
      });
    budget(result.bytes.byteLength, maximum, path);
    totalBytes += result.bytes.byteLength;
    budget(totalBytes, limits.sourceBytes, "sources");
    sources.set(path, await configurationDigest(result.bytes));
    const text = decode(result.bytes, path);
    sourceContent.set(path, text);
    return text;
  };
  const primary = await read(".github/holon.yml", limits.yamlBytes);
  const secondary = await read(".holon.yml", limits.yamlBytes);
  if (primary !== undefined && secondary !== undefined)
    throw new RepositoryConfigurationError("conflicting_sources");
  const raw = primary ?? secondary;
  let parsed: unknown = {};
  if (raw !== undefined) {
    try {
      parsed = parse(raw);
    } catch (error) {
      if (error instanceof RepositoryConfigurationError) throw error;
      throw new RepositoryConfigurationError("invalid_yaml");
    }
  }
  const validated = repositoryConfigInputSchema.safeParse(parsed);
  if (!validated.success) {
    const known = new Set([
      "output",
      "language",
      "detail",
      "max_inline_comments",
      "review",
      "additional_excludes",
      "focus",
      "reference_files",
      "verdict",
      "strictness",
      "instructions",
      "path",
      "projects",
      "name",
      "root",
      "description",
      "compatibility",
      "runtimes",
      "frameworks",
      "path_rules",
      "paths",
    ]);
    const location = (validated.error.issues[0]?.path ?? [])
      .map((part) =>
        typeof part === "number" ? part : known.has(String(part)) ? part : "*",
      )
      .join("/");
    throw new RepositoryConfigurationError(
      "invalid_configuration",
      "/" + location,
    );
  }
  const input = validated.data;
  const additionalExcludes = [
    ...new Set(input.review?.additional_excludes ?? []),
  ].toSorted();
  if (
    additionalExcludes.some(
      (glob) => !repositoryPolicyGlobSchema.safeParse(glob).success,
    )
  )
    throw new RepositoryConfigurationError(
      "invalid_configuration",
      "review.additional_excludes",
    );
  const roots = new Set<string>();
  const names = new Set<string>();
  for (const project of input.projects ?? []) {
    if (roots.has(project.root) || names.has(project.name))
      throw new RepositoryConfigurationError(
        "invalid_configuration",
        "projects",
      );
    roots.add(project.root);
    names.add(project.name);
    for (const category of ["runtimes", "frameworks"] as const)
      for (const [name, value] of Object.entries(
        project.compatibility?.[category] ?? {},
      ))
        validateCompatibilityDeclaration(
          name,
          value,
          `projects[${names.size - 1}].compatibility.${category}.${name}`,
        );
    if (!(await reader.directoryExists(project.root)))
      throw new RepositoryConfigurationError(
        "missing_project_root",
        project.root,
      );
    if (project.description !== undefined)
      budget(
        byteLength(project.description),
        limits.descriptionBytes,
        "projects.description",
      );
  }
  const references = new Map<string, string>();
  let instructionCount = 0;
  const reference = async (path: string): Promise<string> => {
    if (!reader.isReferenceAllowed(path, additionalExcludes))
      throw new RepositoryConfigurationError("excluded_reference", path);
    const cached = references.get(path);
    if (cached !== undefined) return cached;
    budget(references.size + 1, limits.referenceFiles, "reference_files");
    const value = await read(path, limits.referenceBytes);
    if (value === undefined)
      throw new RepositoryConfigurationError("missing_reference", path);
    references.set(path, value);
    return value;
  };
  const entries = async (
    items: InstructionEntry[],
    origin: string,
    root = ".",
  ) => {
    instructionCount += items.length;
    budget(instructionCount, limits.instructionEntries, "instructions");
    const result = [];
    for (const [index, item] of items.entries()) {
      const path =
        typeof item === "string"
          ? null
          : root === "."
            ? item.path
            : `${root}/${item.path}`;
      const text = typeof item === "string" ? item : await reference(path!);
      if (typeof item === "string")
        budget(
          byteLength(text),
          limits.instructionBytes,
          `${origin}[${index}]`,
        );
      result.push({
        origin: `${origin}[${index}]`,
        path,
        text,
        digest: await configurationDigest(text),
      });
    }
    return result;
  };
  const instructions = await entries(input.instructions ?? [], "instructions");
  const contextReferences = [];
  for (const [index, path] of [
    ...new Set(input.review?.reference_files ?? []),
  ].entries()) {
    const text = await reference(path);
    contextReferences.push({
      origin: `review.reference_files[${index}]`,
      path,
      text,
      digest: await configurationDigest(text),
    });
  }
  const projects = [];
  for (const [index, project] of (input.projects ?? []).entries())
    projects.push({
      name: project.name,
      root: project.root,
      description: project.description ?? null,
      compatibility: project.compatibility ?? {},
      instructions: await entries(
        project.instructions ?? [],
        `projects[${index}].instructions`,
        project.root,
      ),
    });
  const pathRules = [];
  for (const [index, rule] of (input.path_rules ?? []).entries())
    pathRules.push({
      paths: rule.paths,
      instructions: await entries(
        rule.instructions,
        `path_rules[${index}].instructions`,
      ),
    });
  const config: ResolvedRepositoryConfig = {
    source:
      primary !== undefined
        ? ".github/holon.yml"
        : secondary !== undefined
          ? ".holon.yml"
          : "default",
    output: {
      language: input.output?.language ?? "en",
      detail: input.output?.detail ?? "concise",
      maxInlineComments: input.output?.max_inline_comments ?? 40,
    },
    additionalExcludes,
    focus: [...new Set(input.review?.focus ?? [])].toSorted(),
    verdictStrictness: input.verdict?.strictness ?? "default",
    instructions,
    references: contextReferences,
    projects,
    pathRules,
  };
  const snapshot = runConfigurationSnapshotSchema.parse({
    identity,
    compilerIdentity,
    config,
    sourceDigest: await configurationDigest(
      canonicalConfigurationJson(Object.fromEntries(sources)),
    ),
    configDigest: await configurationDigest(
      canonicalConfigurationJson({ compilerIdentity, config }),
    ),
    scopeDigest: await configurationDigest(
      canonicalConfigurationJson({ additionalExcludes }),
    ),
  });
  budget(
    byteLength(JSON.stringify(snapshot)),
    limits.serializedBytes,
    "snapshot",
  );
  return snapshot;
}
