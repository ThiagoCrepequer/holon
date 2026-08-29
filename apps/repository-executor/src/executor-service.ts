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
  selectReviewFiles,
} from "@holon/repository-analysis";

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
const maximumFiles = 100;
const maximumDiffBytes = 2_000_000;
const maximumChangedLines = 20_000;

function assertSuccessful(result: SandboxCommandResult): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `Repository command failed with exit code ${result.exitCode}`,
    );
  }
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
    await sandbox.configureGitHubEgress(
      installationToken,
      cloneRepositoryPath(request.cloneUrl),
    );
    try {
      for (const execution of buildCheckoutPlan(request, repositoryPath)) {
        const result = await sandbox.run(execution.argv, {
          cwd: execution.cwd,
          timeoutMs: 120_000,
        });
        assertSuccessful(result);
      }
    } finally {
      await sandbox.blockGitHubEgress();
    }

    const resolvedHead = await sandbox.run(["git", "rev-parse", "HEAD"], {
      cwd: repositoryPath,
      maxOutputBytes: 1_000,
      timeoutMs: 10_000,
    });
    assertSuccessful(resolvedHead);
    if (resolvedHead.stdout.trim() !== request.headSha)
      throw new Error("Resolved head SHA does not match the signed webhook");

    const namesResult = await sandbox.run(
      [
        "git",
        "diff",
        "--name-only",
        "--no-ext-diff",
        "--no-textconv",
        "-z",
        request.baseSha,
        request.headSha,
        "--",
      ],
      { cwd: repositoryPath, maxOutputBytes: 500_000, timeoutMs: 30_000 },
    );
    assertSuccessful(namesResult);
    const allPaths = namesResult.stdout
      .split("\0")
      .filter((path) => path.length > 0);
    const files = selectReviewFiles(allPaths, maximumFiles);
    let totalBytes = 0;
    let truncated =
      namesResult.truncated ||
      allPaths.filter(isSupportedSourcePath).length > files.length;
    const reviewFiles: Array<{
      patch: string;
      path: string;
      truncated: boolean;
    }> = [];

    for (const path of files) {
      const separatorBytes = reviewFiles.length === 0 ? 0 : 1;
      const remainingBytes = maximumDiffBytes - totalBytes - separatorBytes;
      if (remainingBytes <= 0) {
        truncated = true;
        break;
      }
      const patchResult = await sandbox.run(
        [
          "git",
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--unified=80",
          request.baseSha,
          request.headSha,
          "--",
          path,
        ],
        {
          cwd: repositoryPath,
          maxOutputBytes: Math.min(remainingBytes, 250_000),
          timeoutMs: 30_000,
        },
      );
      assertSuccessful(patchResult);
      const boundedPatch = limitUtf8(
        patchResult.stdout,
        Math.min(remainingBytes, 250_000),
      );
      totalBytes +=
        separatorBytes +
        new TextEncoder().encode(boundedPatch.content).byteLength;
      const patchTruncated = patchResult.truncated || boundedPatch.truncated;
      truncated ||= patchTruncated;
      reviewFiles.push({
        patch: boundedPatch.content,
        path,
        truncated: patchTruncated,
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
      surface: mapReviewSurface(reviewFiles),
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
