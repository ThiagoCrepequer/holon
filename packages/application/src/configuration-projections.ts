import {
  repositoryConfigLimits,
  runConfigurationSummarySchema,
  runConfigurationRefSchema,
  type RunConfigurationRef,
  type RunConfigurationSnapshot,
} from "@holon/contracts";
import {
  matchingConfigurationRules,
  selectConfiguredProject,
} from "@holon/domain";

import { RepositoryConfigurationError } from "./repository-configuration-error.js";
import {
  canonicalConfigurationJson,
  configurationDigest,
} from "./repository-configuration.js";

export function configurationReference(
  snapshot: RunConfigurationSnapshot,
): RunConfigurationRef {
  const reference = runConfigurationRefSchema.parse({
    identity: snapshot.identity,
    configDigest: snapshot.configDigest,
    sourceDigest: snapshot.sourceDigest,
    scopeDigest: snapshot.scopeDigest,
  });
  if (new TextEncoder().encode(JSON.stringify(reference)).byteLength > 4096)
    throw new RepositoryConfigurationError("budget_exceeded", "manifest");
  return reference;
}
export async function verifyConfigurationSnapshot(
  snapshot: RunConfigurationSnapshot,
  reference: RunConfigurationRef,
): Promise<void> {
  if (
    canonicalConfigurationJson(snapshot.identity) !==
      canonicalConfigurationJson(reference.identity) ||
    snapshot.configDigest !== reference.configDigest ||
    snapshot.sourceDigest !== reference.sourceDigest ||
    snapshot.scopeDigest !== reference.scopeDigest ||
    (await configurationDigest(
      canonicalConfigurationJson({
        compilerIdentity: snapshot.compilerIdentity,
        config: snapshot.config,
      }),
    )) !== snapshot.configDigest ||
    (await configurationDigest(
      canonicalConfigurationJson({
        additionalExcludes: snapshot.config.additionalExcludes,
      }),
    )) !== snapshot.scopeDigest
  )
    throw new RepositoryConfigurationError("snapshot_mismatch");
}
export function projectConfigurationGuidance(
  snapshot: RunConfigurationSnapshot,
  paths: readonly string[],
) {
  const config = snapshot.config;
  const instructionEntries = new Map<
    string,
    RunConfigurationSnapshot["config"]["instructions"][number]
  >();
  const scopes = paths.map((path) => {
    const project = selectConfiguredProject(path, config.projects);
    const rules = matchingConfigurationRules(path, config.pathRules);
    const instructions = [
      ...config.instructions,
      ...(project?.instructions ?? []),
      ...rules.flatMap((rule) => rule.instructions),
    ];
    for (const entry of instructions)
      instructionEntries.set(entry.origin, entry);
    return {
      path,
      project:
        project === undefined
          ? null
          : {
              name: project.name,
              root: project.root,
              description: project.description,
              compatibility: project.compatibility,
            },
      instructionOrigins: instructions.map((entry) => entry.origin),
    };
  });
  const projection = {
    configuration: configurationReference(snapshot),
    output: config.output,
    focus: config.focus,
    references: config.references,
    instructions: [...instructionEntries.values()],
    scopes,
  };
  if (
    new TextEncoder().encode(JSON.stringify(projection)).byteLength >
    repositoryConfigLimits.guidanceBytes
  )
    throw new RepositoryConfigurationError("budget_exceeded", "shard_guidance");
  return projection;
}
export type ShardReviewGuidance = ReturnType<
  typeof projectConfigurationGuidance
>;
export function sanitizedConfigurationSummary(
  snapshot: RunConfigurationSnapshot,
) {
  const config = snapshot.config;
  return runConfigurationSummarySchema.parse({
    ...configurationReference(snapshot),
    source: config.source,
    sourceDigest: snapshot.sourceDigest,
    output: config.output,
    additionalExcludes: config.additionalExcludes,
    focus: config.focus,
    verdictStrictness: config.verdictStrictness,
    projects: config.projects.map((project) => ({
      name: project.name,
      root: project.root,
      compatibility: project.compatibility,
    })),
    instructionCount:
      config.instructions.length +
      config.projects.reduce(
        (sum, project) => sum + project.instructions.length,
        0,
      ) +
      config.pathRules.reduce((sum, rule) => sum + rule.instructions.length, 0),
    referenceCount: new Set(
      [
        ...config.references,
        ...config.instructions,
        ...config.projects.flatMap((project) => project.instructions),
        ...config.pathRules.flatMap((rule) => rule.instructions),
      ].flatMap((entry) => (entry.path === null ? [] : [entry.path])),
    ).size,
    pathRuleCount: config.pathRules.length,
  });
}
