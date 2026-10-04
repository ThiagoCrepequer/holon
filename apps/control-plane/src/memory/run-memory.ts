import {
  memoryRunIdentitySchema,
  type MemorySnapshot,
  type ReviewJob,
} from "@holon/contracts";

export interface RunMemoryLedger {
  loadRunMemory(runId: string): Promise<MemorySnapshot | undefined>;
  saveRunMemory(snapshot: MemorySnapshot): Promise<void>;
}
export async function resolveRunMemory(
  env: Cloudflare.Env,
  job: ReviewJob,
  ledger: RunMemoryLedger,
  paths: string[] = [],
): Promise<MemorySnapshot> {
  const identity = memoryRunIdentitySchema.parse({
    installationId: job.envelope.installationId,
    repositoryId: job.envelope.repository.id,
    pullRequestNumber: job.envelope.pullRequest.number,
    runId: job.runId,
    headSha: job.envelope.pullRequest.headSha,
    baseSha: job.envelope.pullRequest.baseSha,
  });
  const memoryName = await env.PROJECT_IDENTIFICATION_REGISTRY.getByName(
    String(identity.installationId),
  ).register(identity.installationId, identity.repositoryId);
  if (!memoryName) throw new Error("Repository memory access revoked");
  const existing = await ledger.loadRunMemory(job.runId);
  if (existing) {
    if (
      JSON.stringify(existing.identity) !== JSON.stringify(identity) ||
      existing.memoryName !== memoryName
    )
      throw new Error("Run memory identity changed");
    return existing;
  }
  const snapshot = await env.REPOSITORY_MEMORIES.getByName(memoryName).snapshot(
    identity,
    memoryName,
    paths,
  );
  await ledger.saveRunMemory(snapshot);
  return snapshot;
}
