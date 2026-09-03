import {
  executorRequestSchema,
  executorRequestV1Schema,
  executorRequestV2Schema,
  preparedRepositorySchema,
  preparedRepositoryV1Schema,
  preparedRepositoryV2Schema,
  reviewContextSchema,
  reviewContextV1Schema,
  reviewContextV2Schema,
  runIdSchema,
  type ExecutorRequest,
  type ExecutorRequestV1,
  type ExecutorRequestV2,
  type PreparedRepository,
  type PreparedRepositoryV1,
  type PreparedRepositoryV2,
  type RepositoryToolCall,
  type ReviewContext,
  type ReviewContextV1,
  type ReviewContextV2,
} from "@holon/contracts";
import { buildCheckoutPlan } from "@holon/repository-analysis";

import { createGitHubEgressUrl } from "./egress-policy.js";
import type { GitHubEgressAuthorization } from "./egress-policy.js";
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
  const transientFetchFailure =
    stage === "fetch" &&
    /could not resolve host|failed to connect|connection (?:reset|timed out)|operation timed out|requested url returned error: (?:408|409|425|429|5\d\d)|remote end hung up unexpectedly|early eof/iu.test(
      result.stderr,
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
  const installationId =
    "installationId" in request ? request.installationId : undefined;
  if (
    installationId !== undefined &&
    (!Number.isSafeInteger(installationId) || installationId <= 0)
  ) {
    throw new TypeError("installationId must be a positive safe integer");
  }
  const repositoryUrl = new URL(request.cloneUrl);
  const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\.git$/u.exec(
    repositoryUrl.pathname,
  );
  if (match === null) {
    throw new TypeError("cloneUrl must identify one GitHub repository");
  }
  const matchedOwner = match[1];
  const matchedName = match[2];
  if (matchedOwner === undefined || matchedName === undefined) {
    throw new TypeError("cloneUrl must identify one GitHub repository");
  }
  const repositoryOwner =
    "repositoryOwner" in request ? request.repositoryOwner : matchedOwner;
  const repositoryName =
    "repositoryName" in request ? request.repositoryName : matchedName;
  if (repositoryOwner !== matchedOwner || repositoryName !== matchedName) {
    throw new TypeError("Repository identity does not match cloneUrl");
  }
  return {
    ...(installationId === undefined ? {} : { installationId }),
    repositoryId: request.repositoryId,
    repositoryName,
    repositoryOwner,
    repositoryPath: repositoryUrl.pathname,
    runId: request.runId,
  };
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

export class RepositoryExecutorService {
  public constructor(private readonly sandboxes: SandboxProvider) {}

  public async prepare(
    rawRequest: ExecutorRequestV1,
    installationToken: string,
  ): Promise<PreparedRepositoryV1> {
    if (
      installationToken.length < 20 ||
      installationToken.length > 1_000 ||
      containsControlCharacter(installationToken)
    ) {
      throw new TypeError("installationToken has an invalid format");
    }
    // N-1 callers still send this argument. It is intentionally never passed
    // to the sandbox, persisted, written, or logged; the egress handler asks
    // the trusted broker for a fresh installation credential just in time.
    const request = executorRequestV1Schema.parse(rawRequest);
    return preparedRepositoryV1Schema.parse(
      await this.prepareInternal(request),
    );
  }

  public async prepareRepositoryV2(
    rawRequest: ExecutorRequestV2,
  ): Promise<PreparedRepositoryV2> {
    const request = executorRequestV2Schema.parse(rawRequest);
    return preparedRepositoryV2Schema.parse(
      await this.prepareInternal(request),
    );
  }

  private async prepareInternal(
    rawRequest: ExecutorRequest,
  ): Promise<PreparedRepository> {
    const request = executorRequestSchema.parse(rawRequest);
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
      );
      const artifacts = buildReviewArtifacts(
        request,
        repositoryInventory.files,
        repositoryInventory.truncated,
      );
      await sandbox.writeFile(reviewScopePolicyPath, artifacts.policy);
      await sandbox.writeFile(contextPath, artifacts.serializedContext);
      return preparedRepositorySchema.parse({
        changedLineCount: artifacts.context.changedLines.length,
        contextBytes: artifacts.contextBytes,
        fileCount: artifacts.fileCount,
        runId: request.runId,
        schemaVersion: request.schemaVersion,
        truncated: artifacts.context.truncated ?? false,
      });
    } catch (error) {
      await destroyAfterFailure(sandbox);
      throw preparationFailure(error, stage);
    }
  }

  private async loadAnyContext(runId: string): Promise<ReviewContext> {
    const requestRunId = runIdSchema.parse(runId);
    const serialized = await this.sandboxes
      .get(requestRunId)
      .readFile(contextPath);
    return reviewContextSchema.parse(JSON.parse(serialized) as unknown);
  }

  public async loadContext(runId: string): Promise<ReviewContextV1> {
    return reviewContextV1Schema.parse(await this.loadAnyContext(runId));
  }

  public async loadContextV2(runId: string): Promise<ReviewContextV2> {
    return reviewContextV2Schema.parse(await this.loadAnyContext(runId));
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
