import {
  projectMetadataRequestV1Schema,
  executorRequestV3Schema,
  preparedRepositoryV3Schema,
  reviewContextV4Schema,
  runIdSchema,
  type ExecutorRequestV3,
  type PreparedRepositoryV3,
  type RepositoryToolCall,
  type ReviewContextV4,
} from "@holon/contracts";
import { isMetadataPath } from "@holon/project-identification";
import {
  buildCheckoutPlan,
  splitPullRequestDiff,
} from "@holon/repository-analysis";

import { createGitHubEgressUrl } from "./egress-policy.js";
import type { GitHubEgressAuthorization } from "./egress-policy.js";
import {
  collectProjectMetadata,
  metadataAuthorityPath,
} from "./project-metadata.js";
import {
  contextPath,
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
  request: ExecutorRequestV3,
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

  public async prepareRepositoryV3(
    rawRequest: ExecutorRequestV3,
  ): Promise<PreparedRepositoryV3> {
    const request = executorRequestV3Schema.parse(rawRequest);
    return preparedRepositoryV3Schema.parse(
      await this.prepareInternal(request),
    );
  }

  private async prepareInternal(
    rawRequest: ExecutorRequestV3,
  ): Promise<PreparedRepositoryV3> {
    const request = executorRequestV3Schema.parse(rawRequest);
    const authorization = githubEgressAuthorization(request);
    const sandbox = this.sandboxes.get(request.runId);
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
      if (
        splitPullRequestDiff(request.canonicalDiff).some((file) =>
          [file.oldPath, file.newPath].some(
            (path) => path !== undefined && isMetadataPath(path),
          ),
        )
      ) {
        stage = "fetch";
        // Base metadata is optional; an unavailable object remains an explicit gap.
        await sandbox.run(
          [
            "git",
            "fetch",
            "--no-tags",
            "--depth=1",
            createGitHubEgressUrl(request.cloneUrl),
            request.baseSha,
          ],
          { cwd: repositoryPath, maxOutputBytes: 20000, timeoutMs: 60000 },
        );
      }
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

      const repositoryInventory = await collectStructuralRepositoryInventory(
        sandbox,
        request.canonicalDiff,
        request.effectivePolicy.additionalExcludes,
      );
      const artifacts = buildReviewArtifacts(
        request,
        repositoryInventory.files,
        repositoryInventory.truncated,
      );
      await sandbox.writeFile(reviewScopePolicyPath, artifacts.policy);
      await sandbox.writeFile(contextPath, artifacts.serializedContext);
      await sandbox.writeFile(
        metadataAuthorityPath,
        JSON.stringify({
          schemaVersion: 1,
          runId: request.runId,
          installationId: request.installationId,
          repositoryId: request.repositoryId,
          headSha: request.headSha,
          baseSha: request.baseSha,
          policyDigest: request.effectivePolicy.effectivePolicyDigest,
          changedPaths: splitPullRequestDiff(request.canonicalDiff).flatMap(
            (f) =>
              [f.oldPath, f.newPath].filter(
                (p): p is string => p !== undefined,
              ),
          ),
        }),
      );
      return preparedRepositoryV3Schema.parse({
        changedLineCount: artifacts.context.changedLines.length,
        contextBytes: artifacts.contextBytes,
        effectivePolicyDigest: artifacts.context.effectivePolicyDigest,
        fileCount: artifacts.fileCount,
        runId: request.runId,
        schemaVersion: 3,
        truncated: artifacts.context.truncated,
        waiversCount: artifacts.context.waiversCount,
      });
    } catch (error) {
      await destroyAfterFailure(sandbox);
      throw preparationFailure(error, stage);
    }
  }

  public async discoverProjectMetadataV1(raw: unknown) {
    const request = projectMetadataRequestV1Schema.parse(raw);
    return collectProjectMetadata(this.sandboxes.get(request.runId), request);
  }

  private async loadAnyContext(runId: string): Promise<ReviewContextV4> {
    const requestRunId = runIdSchema.parse(runId);
    const serialized = await this.sandboxes
      .get(requestRunId)
      .readFile(contextPath);
    return reviewContextV4Schema.parse(JSON.parse(serialized) as unknown);
  }

  public async loadContextV4(runId: string): Promise<ReviewContextV4> {
    return reviewContextV4Schema.parse(await this.loadAnyContext(runId));
  }

  public async hasContext(runId: string): Promise<boolean> {
    const requestRunId = runIdSchema.parse(runId);
    const sandbox = this.sandboxes.get(requestRunId);
    const [hasContext, hasPolicy] = await Promise.all([
      sandbox.exists(contextPath),
      sandbox.exists(reviewScopePolicyPath),
    ]);
    return hasContext && hasPolicy;
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
