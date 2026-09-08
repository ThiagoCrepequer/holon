import {
  projectMetadataRequestSchema,
  projectMetadataAuthoritySchema,
  repositoryPathSchema,
  type ProjectIdentificationResult,
} from "@holon/contracts";
import {
  identifySnapshot,
  isMetadataPath,
} from "@holon/project-identification";
import { isProjectMetadataPathAllowed } from "@holon/repository-analysis";

import { repositoryPath, reviewScopePolicyPath } from "./repository-tools.js";
import { parseReviewScopePolicy } from "./review-scope-policy.js";
import type { SandboxPort } from "./sandbox-port.js";
export const metadataAuthorityPath = "/workspace/holon-metadata-authority.json";

export async function collectProjectMetadata(
  sandbox: SandboxPort,
  raw: unknown,
): Promise<ProjectIdentificationResult> {
  const request = projectMetadataRequestSchema.parse(raw);
  const authority = projectMetadataAuthoritySchema.parse(
    JSON.parse(await sandbox.readFile(metadataAuthorityPath)) as unknown,
  );
  if (
    authority.runId !== request.runId ||
    authority.repositoryId !== request.repositoryId ||
    authority.installationId !== request.installationId ||
    authority.policyDigest !== request.policyDigest ||
    ![authority.headSha, authority.baseSha].includes(request.snapshotSha)
  )
    throw new Error("PROJECT_METADATA_AUTHORITY");
  const policy = parseReviewScopePolicy(
    await sandbox.readFile(reviewScopePolicyPath),
  );
  const deadline = Math.min(
    request.deadlineAt ?? Infinity,
    Date.now() + 120000,
  );
  const tree = await sandbox.run(
    ["git", "ls-tree", "-r", "-l", "-z", request.snapshotSha],
    {
      cwd: repositoryPath,
      maxOutputBytes: 1048576,
      timeoutMs: Math.max(1, Math.min(10000, deadline - Date.now())),
    },
  );
  if (tree.exitCode !== 0 || tree.timedOut)
    throw new Error("PROJECT_METADATA_UNAVAILABLE");
  const limitations: string[] = tree.truncated ? ["inventory-truncated"] : [];
  const files: { path: string; content: string }[] = [];
  let total = 0,
    count = 0;
  for (const row of tree.stdout.split("\0")) {
    if (Date.now() >= deadline) {
      limitations.push("identification-deadline");
      break;
    }
    const m = row.match(/^(\d+) blob ([a-f0-9]{40})\s+(\d+)\t(.+)$/u);
    if (!m) continue;
    const path = m[4]!;
    if (!repositoryPathSchema.safeParse(path).success || !isMetadataPath(path))
      continue;
    if (++count > 2000) {
      limitations.push("inventory-truncated");
      break;
    }
    if (m[1] !== "100644" && m[1] !== "100755") {
      limitations.push("non-regular-source");
      continue;
    }
    // Only the lockfile classification is exempt. All path and user exclusions remain enforced.
    const lock = /lock|npm-shrinkwrap/u.test(path.split("/").at(-1)!);
    if (
      !isProjectMetadataPathAllowed(path, policy.additionalExcludes) ||
      policy.deniedPaths.includes(path)
    ) {
      limitations.push("source-excluded");
      continue;
    }
    const size = Number(m[3]);
    if (size > (lock ? 2097152 : 65536) || total + size > 16777216) {
      limitations.push("source-size-limit");
      continue;
    }
    total += size;
    const blob = await sandbox.run(["git", "cat-file", "blob", m[2]!], {
      cwd: repositoryPath,
      maxOutputBytes: size + 1,
      timeoutMs: Math.max(1, Math.min(10000, deadline - Date.now())),
    });
    if (blob.exitCode !== 0 || blob.truncated || blob.timedOut) {
      limitations.push("source-unavailable");
      continue;
    }
    if (blob.stdout.startsWith("version https://git-lfs.github.com/spec/")) {
      limitations.push("lfs-source-unavailable");
      continue;
    }
    files.push({ path, content: blob.stdout });
  }
  const result = await identifySnapshot({
    snapshotSha: request.snapshotSha,
    files,
    policyDigest: request.policyDigest,
    modelRevision: request.modelRevision,
    limitations,
    ...(request.mode === "affected" && authority.changedPaths
      ? { changedPaths: authority.changedPaths }
      : {}),
  });
  return {
    ...result,
    metadataChanged: authority.changedPaths?.some(isMetadataPath) ?? false,
  };
}
