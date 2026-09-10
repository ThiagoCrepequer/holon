import type { ConfigurationSnapshotReader } from "@holon/application";

/** In-memory base snapshot. Missing entries model proven tree absence. */
export function configurationReader(
  files: Readonly<Record<string, string>> = {},
): ConfigurationSnapshotReader {
  return {
    readFile: async (path) =>
      files[path] === undefined
        ? { kind: "absent" }
        : { kind: "found", bytes: new TextEncoder().encode(files[path]) },
    directoryExists: async () => true,
    isReferenceAllowed: () => true,
  };
}

export async function defaultRunConfiguration(
  job: import("@holon/contracts").ReviewJob,
) {
  const { compileRepositoryConfiguration } = await import("@holon/application");
  return compileRepositoryConfiguration(
    {
      runId: job.runId,
      installationId: job.envelope.installationId,
      repositoryId: job.envelope.repository.id,
      pullRequestNumber: job.envelope.pullRequest.number,
      headSha: job.envelope.pullRequest.headSha,
      baseSha: job.envelope.pullRequest.baseSha,
    },
    configurationReader(),
    () => ({}),
  );
}

export async function defaultScopePolicy(baseSha: string) {
  const { configurationDigest } = await import("@holon/application");
  return {
    additionalExcludes: [],
    baseSha,
    effectivePolicyDigest: await configurationDigest(
      '{"additionalExcludes":[]}',
    ),
    source: "default" as const,
    sourceDigest: null,
    verdictStrictness: "default" as const,
  };
}
