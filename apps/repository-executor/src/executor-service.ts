import {
  contextStream,
  projectMetadataAuthoritySchema,
  projectMetadataRequestSchema,
  executorRequestSchema,
  preparedRepositorySchema,
  reviewContextSchema,
  runIdSchema,
  type ExecutorRequest,
  type PreparedRepository,
  type RepositoryToolCall,
  type ReviewContext,
} from "@holon/contracts";
import {
  buildCheckoutPlan,
  splitPullRequestDiff,
} from "@holon/repository-analysis";

import {
  saveContext,
  loadContextManifest,
  loadContextPage,
  loadStoredContext,
  hasStoredContext,
} from "./context-storage.js";
import { createGitHubEgressUrl } from "./egress-policy.js";
import type { GitHubEgressAuthorization } from "./egress-policy.js";
import { readLocalDiff, resolveMergeBase } from "./local-diff.js";
import {
  collectProjectMetadata,
  metadataAuthorityPath,
} from "./project-metadata.js";
import {
  executeRepositoryTool,
  repositoryPath,
  reviewScopePolicyPath,
} from "./repository-tools.js";
import { buildReviewArtifacts } from "./review-context.js";
import {
  RepositoryPreparationError,
  SandboxRuntimeError,
  type RepositoryPreparationStage,
} from "./sandbox-errors.js";
import type {
  SandboxCommandResult,
  SandboxPort,
  SandboxProvider,
} from "./sandbox-port.js";
import { collectStructuralRepositoryInventory } from "./structural-repository-inventory.js";

export {
  RepositoryPreparationError,
  SandboxRuntimeError,
} from "./sandbox-errors.js";
export type {
  SandboxCommandResult,
  SandboxPort,
  SandboxProvider,
} from "./sandbox-port.js";

function preparationFailure(
  error: unknown,
  stage: RepositoryPreparationStage,
): RepositoryPreparationError {
  if (error instanceof RepositoryPreparationError) return error;
  if (error instanceof SandboxRuntimeError) {
    return new RepositoryPreparationError(error.retryable, stage, error.reason);
  }
  return new RepositoryPreparationError(false, stage, "unavailable");
}

async function destroyAfterFailure(sandbox: SandboxPort): Promise<void> {
  try {
    await sandbox.destroy();
  } catch {
    // Preserve the causal error. The workflow also performs final cleanup.
  }
}

function assertPreparationSuccessful(
  result: SandboxCommandResult,
  stage: RepositoryPreparationStage,
): void {
  if (result.timedOut === true) {
    throw new RepositoryPreparationError(true, stage, "timed-out");
  }
  if (result.exitCode === 0) return;
  const output = `${result.stderr}\n${result.stdout}`;
  const transientFetchFailure =
    stage === "fetch" &&
    /could not resolve host|failed to connect|connection (?:reset|timed out)|operation timed out|requested url returned error: (?:404|408|409|425|429|5\d\d)|couldn't find remote ref|remote end hung up unexpectedly|early eof|repository (?:'.*?' )?not found/iu.test(
      output,
    );
  const retryable = result.exitCode === 143 || transientFetchFailure;
  throw new RepositoryPreparationError(
    retryable,
    stage,
    result.exitCode === 143 ? "terminated" : "command-failed",
  );
}

function githubEgressAuthorization(
  request: ExecutorRequest,
): GitHubEgressAuthorization {
  return {
    installationId: request.installationId,
    repositoryId: request.repositoryId,
    repositoryName: request.repositoryName,
    repositoryOwner: request.repositoryOwner,
    repositoryPath: new URL(request.cloneUrl).pathname,
    runId: request.runId,
  };
}

export class RepositoryExecutorService {
  public constructor(private readonly sandboxes: SandboxProvider) {}

  public async prepareRepository(
    rawRequest: unknown,
  ): Promise<PreparedRepository> {
    const request = executorRequestSchema.parse(rawRequest);
    return preparedRepositorySchema.parse(await this.prepareInternal(request));
  }

  private async prepareInternal(
    rawRequest: unknown,
  ): Promise<PreparedRepository> {
    const request = executorRequestSchema.parse(rawRequest);
    const authorization = githubEgressAuthorization(request);
    const sandbox = this.sandboxes.get(request.runId);
    const deadline = Date.now() + 240_000;
    let stage: RepositoryPreparationStage = "configure-egress";
    try {
      await sandbox.configureGitHubEgress(authorization);
      for (const execution of buildCheckoutPlan(
        request,
        repositoryPath,
        createGitHubEgressUrl(request.cloneUrl),
      )) {
        stage = execution.stage ?? "prepare-context";
        const result = await sandbox.run(execution.argv, {
          cwd: execution.cwd,
          ...(execution.timeoutMs === undefined
            ? {}
            : { timeoutMs: execution.timeoutMs }),
          ...(execution.maxOutputBytes === undefined
            ? {}
            : { maxOutputBytes: execution.maxOutputBytes }),
        });
        assertPreparationSuccessful(result, stage);
      }
      stage = "merge-base";
      const mergeBase = await resolveMergeBase(
        sandbox,
        request,
        createGitHubEgressUrl(request.cloneUrl),
        repositoryPath,
        deadline,
      );
      stage = "block-egress";
      await sandbox.blockGitHubEgress();
      stage = "prepare-context";
      const resolvedHead = await sandbox.run(["git", "rev-parse", "HEAD"], {
        cwd: repositoryPath,
        maxOutputBytes: 1_000,
        timeoutMs: 10_000,
      });
      assertPreparationSuccessful(resolvedHead, stage);
      if (resolvedHead.stdout.trim() !== request.headSha)
        throw new RepositoryPreparationError(false, stage, "command-failed");

      stage = "diff";
      const canonicalDiff = await readLocalDiff(
        sandbox,
        mergeBase,
        request.headSha,
        repositoryPath,
        deadline,
      );
      stage = "prepare-context";
      const repositoryInventory = await collectStructuralRepositoryInventory(
        sandbox,
        canonicalDiff,
        request.effectivePolicy.additionalExcludes,
      );
      const artifacts = buildReviewArtifacts(
        { ...request, canonicalDiff },
        repositoryInventory.files,
        repositoryInventory.truncated,
      );
      await sandbox.writeFile(reviewScopePolicyPath, artifacts.policy);
      await saveContext(sandbox, artifacts.serializedContext);
      const authority = JSON.stringify(
        projectMetadataAuthoritySchema.parse({
          runId: request.runId,
          installationId: request.installationId,
          repositoryId: request.repositoryId,
          headSha: request.headSha,
          baseSha: request.baseSha,
          policyDigest: request.effectivePolicy.effectivePolicyDigest,
          changedPaths: [
            ...new Set(
              splitPullRequestDiff(canonicalDiff).flatMap((f) =>
                [f.oldPath, f.newPath].filter(
                  (p): p is string => p !== undefined,
                ),
              ),
            ),
          ],
        }),
      );
      if (new TextEncoder().encode(authority).byteLength > 2_000_000)
        throw new RepositoryPreparationError(false, stage, "size-limit");
      await sandbox.writeFile(metadataAuthorityPath, authority);
      return preparedRepositorySchema.parse({
        changedLineCount: artifacts.context.changedLines.length,
        contextBytes: artifacts.contextBytes,
        effectivePolicyDigest: artifacts.context.effectivePolicyDigest,
        fileCount: artifacts.fileCount,
        runId: request.runId,
        truncated: artifacts.context.truncated,
        waiversCount: artifacts.context.waiversCount,
      });
    } catch (error) {
      await destroyAfterFailure(sandbox);
      throw preparationFailure(error, stage);
    }
  }

  public async discoverProjectMetadata(raw: unknown) {
    const request = projectMetadataRequestSchema.parse(raw);
    return collectProjectMetadata(this.sandboxes.get(request.runId), request);
  }

  private async loadAnyContext(runId: string): Promise<ReviewContext> {
    const requestRunId = runIdSchema.parse(runId);
    const serialized = await loadStoredContext(
      this.sandboxes.get(requestRunId),
    );
    return reviewContextSchema.parse(JSON.parse(serialized) as unknown);
  }

  public async loadContext(runId: string): Promise<ReviewContext> {
    return reviewContextSchema.parse(await this.loadAnyContext(runId));
  }

  public async hasContext(runId: string): Promise<boolean> {
    const requestRunId = runIdSchema.parse(runId);
    const sandbox = this.sandboxes.get(requestRunId);
    const [hasContext, hasPolicy] = await Promise.all([
      hasStoredContext(sandbox),
      sandbox.exists(reviewScopePolicyPath),
    ]);
    return hasContext && hasPolicy;
  }

  public async openContext(runId: string) {
    const sandbox = this.sandboxes.get(runIdSchema.parse(runId));
    return contextStream(await loadContextManifest(sandbox), (index, digest) =>
      loadContextPage(sandbox, index, digest),
    );
  }

  public async runTool(
    runId: string,
    rawCall: RepositoryToolCall,
  ): Promise<{ content: string; truncated: boolean }> {
    const requestRunId = runIdSchema.parse(runId);
    return await executeRepositoryTool(
      this.sandboxes.get(requestRunId),
      requestRunId,
      rawCall,
    );
  }

  public async cleanup(runId: string): Promise<void> {
    await this.sandboxes.get(runId).destroy();
  }
}
