import {
  executorRequestSchema,
  preparedRepositorySchema,
  repositoryToolCallSchema,
  reviewContextSchema,
  type ExecutorRequest,
  type PreparedRepository,
  type RepositoryToolCall,
  type ReviewContext,
} from "@holon/contracts";
import {
  collectChangedLines,
  buildCheckoutPlan,
  buildToolExecution,
  isSupportedSourcePath,
  mapReviewSurface,
  splitPullRequestDiff,
} from "@holon/repository-analysis";

import { createGitHubEgressUrl } from "./egress-policy.js";

export interface SandboxCommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly truncated: boolean;
}

export interface SandboxPort {
  configureGitHubEgress(token: string, repositoryPath: string): Promise<void>;
  blockGitHubEgress(): Promise<void>;
  destroy(): Promise<void>;
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  run(
    argv: readonly string[],
    options?: {
      readonly cwd?: string;
      readonly maxOutputBytes?: number;
      readonly timeoutMs?: number;
    },
  ): Promise<SandboxCommandResult>;
}

export interface SandboxProvider {
  get(runId: string): SandboxPort;
}

const repositoryPath = "/workspace/repository";
const contextPath = "/workspace/holon-review-context.json";
const maximumFiles = 50;
const maximumDiffBytes = 120_000;
const maximumFileDiffBytes = 60_000;
const maximumChangedLines = 5_000;

type RepositoryPreparationStage =
  | "block-egress"
  | "checkout"
  | "configure-egress"
  | "fetch"
  | "initialize"
  | "prepare-context";
const transientSandboxErrors = new Set([
  "ContainerUnavailableError",
  "OperationInterruptedError",
  "ProcessReadyTimeoutError",
  "ProcessWaitTimeoutError",
  "RPCTransportError",
  "RuntimeIdentityInactiveError",
  "ServiceNotRespondingError",
]);

export class RepositoryPreparationError extends Error {
  public constructor(
    public readonly retryable: boolean,
    public readonly stage: RepositoryPreparationStage,
    reason: "command-failed" | "terminated" | "timed-out" | "unavailable",
  ) {
    super(
      `${retryable ? "HOLON_REPOSITORY_TRANSIENT" : "HOLON_REPOSITORY_PERMANENT"}:${stage}:${reason}`,
    );
    this.name = retryable
      ? "RepositoryTransientError"
      : "RepositoryPermanentError";
  }
}

function isTransientSandboxError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return transientSandboxErrors.has(error.name);
}

function preparationFailure(
  error: unknown,
  stage: RepositoryPreparationStage,
): RepositoryPreparationError {
  if (error instanceof RepositoryPreparationError) return error;
  const retryable = isTransientSandboxError(error);
  return new RepositoryPreparationError(
    retryable,
    stage,
    retryable ? "timed-out" : "unavailable",
  );
}

async function destroyAfterFailure(sandbox: SandboxPort): Promise<void> {
  try {
    await sandbox.destroy();
  } catch {
    // Preserve the causal error. The workflow also performs final cleanup.
  }
}

function assertSuccessful(result: SandboxCommandResult): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `Repository command failed with exit code ${result.exitCode}`,
    );
  }
}

function assertPreparationSuccessful(
  result: SandboxCommandResult,
  stage: RepositoryPreparationStage,
): void {
  if (result.exitCode === 0) return;
  throw new RepositoryPreparationError(
    result.exitCode === 143,
    stage,
    result.exitCode === 143 ? "terminated" : "command-failed",
  );
}

function cloneRepositoryPath(cloneUrl: string): string {
  return new URL(cloneUrl).pathname;
}

function limitUtf8(
  value: string,
  maximumBytes: number,
): { readonly content: string; readonly truncated: boolean } {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maximumBytes)
    return { content: value, truncated: false };
  return {
    content: new TextDecoder().decode(encoded.slice(0, maximumBytes)),
    truncated: true,
  };
}

function isRipgrepMatch(line: string): boolean {
  try {
    const value: unknown = JSON.parse(line);
    return (
      typeof value === "object" &&
      value !== null &&
      "type" in value &&
      value.type === "match"
    );
  } catch {
    return false;
  }
}

function boundSearchOutput(
  call: Exclude<RepositoryToolCall, { readonly name: "read_file" }>,
  content: string,
): { readonly content: string; readonly truncated: boolean } {
  const lines = content
    .split("\n")
    .filter((line) => line.length > 0)
    .filter((line) => call.name !== "search_text" || isRipgrepMatch(line));
  const selected = lines.slice(0, call.arguments.maxResults).join("\n");
  const bounded = limitUtf8(selected, 100_000);
  return {
    content: bounded.content,
    truncated: bounded.truncated || lines.length > call.arguments.maxResults,
  };
}

export class RepositoryExecutorService {
  public constructor(private readonly sandboxes: SandboxProvider) {}

  public async prepare(
    rawRequest: ExecutorRequest,
    installationToken: string,
  ): Promise<PreparedRepository> {
    const request = executorRequestSchema.parse(rawRequest);
    if (installationToken.length < 1)
      throw new TypeError("installationToken is required");
    const sandbox = this.sandboxes.get(request.runId);
    let stage: RepositoryPreparationStage = "configure-egress";
    try {
      await sandbox.configureGitHubEgress(
        installationToken,
        cloneRepositoryPath(request.cloneUrl),
      );
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

      const supportedFiles = splitPullRequestDiff(request.canonicalDiff)
        .filter((file) => isSupportedSourcePath(file.path))
        .toSorted((left, right) => left.path.localeCompare(right.path));
      let totalBytes = 0;
      let truncated = supportedFiles.length > maximumFiles;
      const reviewFiles: Array<{
        patch: string;
        path: string;
        truncated: boolean;
      }> = [];
      const selectedPaths = new Set<string>();

      for (const file of supportedFiles) {
        if (selectedPaths.has(file.path)) continue;
        if (reviewFiles.length === maximumFiles) {
          truncated = true;
          break;
        }
        const separatorBytes = reviewFiles.length === 0 ? 0 : 1;
        const patchBytes = new TextEncoder().encode(file.patch).byteLength;
        if (
          patchBytes > maximumFileDiffBytes ||
          totalBytes + separatorBytes + patchBytes > maximumDiffBytes
        ) {
          truncated = true;
          continue;
        }
        selectedPaths.add(file.path);
        totalBytes += separatorBytes + patchBytes;
        reviewFiles.push({
          patch: file.patch,
          path: file.path,
          truncated: false,
        });
      }

      const changedLines: Array<{
        line: number;
        path: string;
        side: "RIGHT";
      }> = [];
      for (const file of reviewFiles) {
        const remaining = maximumChangedLines - changedLines.length;
        if (remaining <= 0) {
          truncated = true;
          break;
        }
        const fileLines = collectChangedLines(
          file.path,
          file.patch,
          remaining + 1,
        );
        if (fileLines.length > remaining) truncated = true;
        changedLines.push(...fileLines.slice(0, remaining));
      }
      const context = reviewContextSchema.parse({
        changedLines,
        diff: reviewFiles.map((file) => file.patch).join("\n"),
        surface: mapReviewSurface(reviewFiles, 50),
        truncated,
      });
      const serialized = JSON.stringify(context);
      await sandbox.writeFile(contextPath, serialized);
      return preparedRepositorySchema.parse({
        changedLineCount: context.changedLines.length,
        contextBytes: new TextEncoder().encode(serialized).byteLength,
        fileCount: reviewFiles.length,
        runId: request.runId,
        schemaVersion: 1,
        truncated: context.truncated ?? false,
      });
    } catch (error) {
      await destroyAfterFailure(sandbox);
      throw preparationFailure(error, stage);
    }
  }

  public async loadContext(runId: string): Promise<ReviewContext> {
    const requestRunId = executorRequestSchema.shape.runId.parse(runId);
    const serialized = await this.sandboxes
      .get(requestRunId)
      .readFile(contextPath);
    return reviewContextSchema.parse(JSON.parse(serialized) as unknown);
  }

  public async hasContext(runId: string): Promise<boolean> {
    const requestRunId = executorRequestSchema.shape.runId.parse(runId);
    return await this.sandboxes.get(requestRunId).exists(contextPath);
  }

  public async runTool(
    runId: string,
    rawCall: RepositoryToolCall,
  ): Promise<{ content: string; truncated: boolean }> {
    const call = repositoryToolCallSchema.parse(rawCall);
    const sandbox = this.sandboxes.get(runId);
    const execution = buildToolExecution(call, repositoryPath);
    if (call.name === "read_file") {
      if (!("kind" in execution))
        throw new TypeError("Read-file policy returned a command execution");
      const resolved = await sandbox.run(["realpath", "--", execution.path], {
        cwd: repositoryPath,
        maxOutputBytes: 4_096,
        timeoutMs: 10_000,
      });
      assertSuccessful(resolved);
      const resolvedPath = resolved.stdout.trim();
      if (
        resolved.truncated ||
        !resolvedPath.startsWith(`${repositoryPath}/`)
      ) {
        throw new Error("Resolved file path escapes the repository workspace");
      }
      const content = await sandbox.readFile(resolvedPath);
      const selected = content
        .split("\n")
        .slice(execution.startLine - 1, execution.endLine)
        .join("\n");
      return limitUtf8(selected, 100_000);
    }
    if ("kind" in execution)
      throw new TypeError("Search policy returned a read-file execution");
    const result = await sandbox.run(execution.argv, {
      cwd: execution.cwd,
      ...(execution.maxOutputBytes === undefined
        ? {}
        : { maxOutputBytes: execution.maxOutputBytes }),
      timeoutMs: 20_000,
    });
    if (result.exitCode !== 0 && result.exitCode !== 1)
      assertSuccessful(result);
    const bounded = boundSearchOutput(call, result.stdout);
    return {
      content: bounded.content,
      truncated: result.truncated || bounded.truncated,
    };
  }

  public async cleanup(runId: string): Promise<void> {
    await this.sandboxes.get(runId).destroy();
  }
}
