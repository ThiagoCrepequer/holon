import {
  compileRepositoryConfiguration,
  canonicalConfigurationJson,
  RepositoryConfigurationError,
  type ConfigurationSnapshotReader,
} from "@holon/application";
import {
  repositoryPolicySchema,
  type RepositoryPolicy,
  type ReviewJob,
  type RunConfigurationRef,
  type RunConfigurationSnapshot,
} from "@holon/contracts";
import { parseRepositoryConfigurationYaml } from "@holon/repository-config";

import type { WorkflowLedger } from "./review-services.js";

export async function resolveRunConfiguration(
  job: ReviewJob,
  ledger: Pick<
    WorkflowLedger,
    "findRunConfiguration" | "loadRunConfiguration" | "saveRunConfiguration"
  >,
  createReader: () => Promise<ConfigurationSnapshotReader>,
  emit?: (
    event: string,
    fields: Readonly<Record<string, string | number>>,
  ) => void,
): Promise<RunConfigurationRef> {
  const identity = {
    runId: job.runId,
    installationId: job.envelope.installationId,
    repositoryId: job.envelope.repository.id,
    pullRequestNumber: job.envelope.pullRequest.number,
    baseSha: job.envelope.pullRequest.baseSha,
    headSha: job.envelope.pullRequest.headSha,
  };
  const existing = await ledger.findRunConfiguration(job.runId);
  if (existing !== undefined) {
    if (
      canonicalConfigurationJson(existing.identity) !==
      canonicalConfigurationJson(identity)
    )
      throw new RepositoryConfigurationError("identity_mismatch");
    await ledger.loadRunConfiguration(existing);
    emit?.("configuration.snapshot_reused", {
      runId: job.runId,
      configDigest: existing.configDigest,
    });
    return existing;
  }
  const snapshot = await compileRepositoryConfiguration(
    identity,
    await createReader(),
    parseRepositoryConfigurationYaml,
  );
  const reference = await ledger.saveRunConfiguration(snapshot);
  emit?.("configuration.resolved", {
    runId: job.runId,
    configDigest: reference.configDigest,
    scopeDigest: reference.scopeDigest,
    source: snapshot.config.source,
    language: snapshot.config.output.language,
    projects: snapshot.config.projects.length,
    pathRules: snapshot.config.pathRules.length,
  });
  return reference;
}

export function configurationScopePolicy(
  snapshot: RunConfigurationSnapshot,
): RepositoryPolicy {
  return repositoryPolicySchema.parse({
    additionalExcludes: snapshot.config.additionalExcludes,
    baseSha: snapshot.identity.baseSha,
    effectivePolicyDigest: snapshot.scopeDigest,
    source: snapshot.config.source,
    sourceDigest: snapshot.sourceDigest,
    verdictStrictness: snapshot.config.verdictStrictness,
  });
}
