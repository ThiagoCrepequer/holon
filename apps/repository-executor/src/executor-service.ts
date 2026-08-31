import {
  executorRequestSchema,
  preparedRepositorySchema,
  repositoryToolCallSchema,
  reviewContextSchema,
  type ExecutorRequest,
  type PreparedRepository,
  type RepositoryToolCall,
  type ReviewContext,
  type ReviewFileMode,
} from "@holon/contracts";
import {
  collectChangedLines,
  buildCheckoutPlan,
  buildToolExecution,
  classifyReviewPath,
  isNonBinaryPullRequestPatch,
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
const maximumContextBytes = 500_000;

interface ReviewFileCandidate {
  readonly mode: ReviewFileMode;
  readonly patch: string;
  readonly path: string;
}

function prioritizeReviewFiles(
  files: readonly ReviewFileCandidate[],
): readonly ReviewFileCandidate[] {
  const structural = files
    .filter((file) => file.mode === "structural")
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const textual = files
    .filter((file) => file.mode === "textual")
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const prioritized: ReviewFileCandidate[] = [];
  let structuralIndex = 0;
  let textualIndex = 0;
  const takeStructural = () => {
    const file = structural[structuralIndex];
    if (file !== undefined) {
      prioritized.push(file);
      structuralIndex += 1;
    }
  };
  const takeTextual = () => {
    const file = textual[textualIndex];
    if (file !== undefined) {
      prioritized.push(file);
      textualIndex += 1;
    }
  };

  // Give each mode an early opportunity, then favor structural analysis 3:1.
  takeStructural();
  takeTextual();
  while (structuralIndex < structural.length || textualIndex < textual.length) {
    for (let index = 0; index < 3; index += 1) takeStructural();
    takeTextual();
  }
  return prioritized;
}

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
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let end = maximumBytes;
  while (end > 0) {
    try {
      return {
        content: decoder.decode(encoded.slice(0, end)),
        truncated: true,
      };
    } catch {
      end -= 1;
    }
  }
  return {
    content: "",
    truncated: true,
  };
}

function serializeBoundedContext(context: ReviewContext): {
  readonly context: ReviewContext;
  readonly serialized: string;
} {
  const encode = (changedLineCount: number) => {
    const candidate = reviewContextSchema.parse({
      ...context,
      changedLines: context.changedLines.slice(0, changedLineCount),
      truncated:
        (context.truncated ?? false) ||
        changedLineCount < context.changedLines.length,
    });
    const serialized = JSON.stringify(candidate);
    return {
      bytes: new TextEncoder().encode(serialized).byteLength,
      context: candidate,
      serialized,
    };
  };

  const complete = encode(context.changedLines.length);
  if (complete.bytes <= maximumContextBytes) return complete;

  let lowerBound = 0;
  let upperBound = context.changedLines.length - 1;
  let selected = encode(0);
  if (selected.bytes > maximumContextBytes) {
    throw new RangeError("Review context metadata exceeds the byte limit");
  }
  while (lowerBound <= upperBound) {
    const midpoint = Math.floor((lowerBound + upperBound) / 2);
    const candidate = encode(midpoint);
    if (candidate.bytes <= maximumContextBytes) {
      selected = candidate;
      lowerBound = midpoint + 1;
    } else {
      upperBound = midpoint - 1;
    }
  }
  return selected;
}

function searchResultPath(
  call: Exclude<RepositoryToolCall, { readonly name: "read_file" }>,
  line: string,
): string | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null) return undefined;
    if (call.name === "search_structure") {
      if (!("file" in value) || typeof value.file !== "string")
        return undefined;
      return value.file.replace(/^\.\//u, "");
    }
    if (!("type" in value) || value.type !== "match" || !("data" in value))
      return undefined;
    const data = value.data;
    if (
      typeof data !== "object" ||
      data === null ||
      !("path" in data) ||
      typeof data.path !== "object" ||
      data.path === null ||
      !("text" in data.path) ||
      typeof data.path.text !== "string"
    ) {
      return undefined;
    }
    return data.path.text.replace(/^\.\//u, "");
  } catch {
    return undefined;
  }
}

function boundSearchOutput(
  call: Exclude<RepositoryToolCall, { readonly name: "read_file" }>,
  content: string,
): { readonly content: string; readonly truncated: boolean } {
  const lines = content
    .split("\n")
    .filter((line) => line.length > 0)
    .filter((line) => {
      const path = searchResultPath(call, line);
      const mode = path === undefined ? undefined : classifyReviewPath(path);
      return (
        mode !== undefined &&
        (call.name !== "search_structure" || mode === "structural")
      );
    });
  const selected = lines.slice(0, call.arguments.maxResults).join("\n");
  const bounded = limitUtf8(selected, 100_000);
  return {
    content: bounded.content,
    truncated: bounded.truncated || lines.length > call.arguments.maxResults,
  };
}

async function resolveReviewablePaths(
  sandbox: SandboxPort,
  paths: readonly string[],
): Promise<readonly string[]> {
  if (paths.length === 0) return [];
  const resolved = await sandbox.run(
    ["realpath", "--", ...paths.map((path) => `${repositoryPath}/${path}`)],
    {
      cwd: repositoryPath,
      maxOutputBytes: Math.min(50_000, paths.length * 2_048),
      timeoutMs: 10_000,
    },
  );
  assertSuccessful(resolved);
  const resolvedPaths = resolved.stdout.trimEnd().split("\n");
  if (resolved.truncated || resolvedPaths.length !== paths.length) {
    throw new Error("Repository tool paths could not be resolved safely");
  }
  for (const resolvedPath of resolvedPaths) {
    if (!resolvedPath.startsWith(`${repositoryPath}/`)) {
      throw new Error("Resolved file path escapes the repository workspace");
    }
    const relativePath = resolvedPath.slice(repositoryPath.length + 1);
    if (classifyReviewPath(relativePath) === undefined) {
      throw new TypeError(
        "Resolved repository tool path is excluded from review",
      );
    }
  }
  return resolvedPaths;
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

      const supportedFiles = prioritizeReviewFiles(
        splitPullRequestDiff(request.canonicalDiff).flatMap((file) => {
          const mode = classifyReviewPath(file.path);
          return mode === undefined || !isNonBinaryPullRequestPatch(file.patch)
            ? []
            : [{ ...file, mode }];
        }),
      );
      let totalBytes = 0;
      let truncated = supportedFiles.length > maximumFiles;
      const reviewFiles: Array<{
        mode: ReviewFileMode;
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
          mode: file.mode,
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
      const unboundedContext = reviewContextSchema.parse({
        changedLines,
        diff: reviewFiles.map((file) => file.patch).join("\n"),
        reviewedFiles: reviewFiles.map(({ mode, path }) => ({ mode, path })),
        surface: mapReviewSurface(
          reviewFiles.filter((file) => file.mode === "structural"),
          50,
        ),
        truncated,
      });
      const { context, serialized } = serializeBoundedContext(unboundedContext);
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
    if (call.name === "search_structure") {
      const context = reviewContextSchema.parse(
        JSON.parse(await sandbox.readFile(contextPath)) as unknown,
      );
      if (!context.reviewedFiles.some((file) => file.mode === "structural")) {
        throw new TypeError(
          "Structural search is unavailable without structural review files",
        );
      }
    }
    const execution = buildToolExecution(call, repositoryPath);
    if (call.name === "read_file") {
      if (!("kind" in execution))
        throw new TypeError("Read-file policy returned a command execution");
      const [resolvedPath] = await resolveReviewablePaths(sandbox, [
        call.arguments.path,
      ]);
      if (resolvedPath === undefined)
        throw new Error("Repository file path could not be resolved safely");
      const result = await sandbox.run(
        [
          "sed",
          "-n",
          "-e",
          `${execution.startLine},${execution.endLine}p`,
          resolvedPath,
        ],
        {
          cwd: repositoryPath,
          maxOutputBytes: 100_000,
          timeoutMs: 20_000,
        },
      );
      assertSuccessful(result);
      const content = result.stdout.endsWith("\n")
        ? result.stdout.slice(0, -1)
        : result.stdout;
      const bounded = limitUtf8(content, 100_000);
      return {
        content: bounded.content,
        truncated: result.truncated || bounded.truncated,
      };
    }
    if ("kind" in execution)
      throw new TypeError("Search policy returned a read-file execution");
    await resolveReviewablePaths(sandbox, call.arguments.paths ?? []);
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
