import {
  ContainerProxy,
  ContainerUnavailableError,
  OperationInterruptedError,
  ProcessReadyTimeoutError,
  ProcessWaitTimeoutError,
  RPCTransportError,
  RuntimeIdentityInactiveError,
  Sandbox,
  StaleProcessHandleError,
  getSandbox,
  isPlatformTransientError,
} from "@cloudflare/sandbox";
import type {
  ExecutorRequest,
  GitHubCredentialRequest,
  GitHubCredentialResponse,
  PreparedRepository,
  RepositoryToolCall,
  ReviewContext,
} from "@holon/contracts";
import {
  githubCredentialRequestSchema,
  githubCredentialResponseSchema,
} from "@holon/contracts";
import { type RepositoryToolOperation } from "@holon/contracts";
import { WorkerEntrypoint } from "cloudflare:workers";

import {
  authenticateGitHubRequest,
  githubEgressHost,
  validateGitHubEgressRequest,
  type GitHubEgressAuthorization,
} from "./egress-policy.js";
import { RepositoryExecutorService } from "./executor-service.js";
import { RepositoryToolTask } from "./repository-tool-task.js";
import { executeRepositoryTool } from "./repository-tools.js";
import { SandboxRuntimeError } from "./sandbox-errors.js";
import { createSandboxId, resolveContainerId } from "./sandbox-identity.js";
import { SandboxLease, type LeaseState } from "./sandbox-lease.js";
import type { SandboxPort, SandboxProvider } from "./sandbox-port.js";
import { ToolExecution } from "./tool-execution.js";

export interface GitHubCredentialBroker {
  getInstallationToken(
    request: GitHubCredentialRequest,
  ): Promise<GitHubCredentialResponse>;
}

type RepositoryExecutorEnv = Cloudflare.Env & {
  readonly GITHUB_CREDENTIAL_BROKER: GitHubCredentialBroker;
};

interface RepositoryOutboundHandlerContext {
  readonly containerId: string;
  readonly params?: unknown;
}

export function mapSandboxSdkError(error: unknown): SandboxRuntimeError {
  if (error instanceof SandboxRuntimeError) return error;
  if (
    error instanceof ProcessWaitTimeoutError ||
    error instanceof ProcessReadyTimeoutError
  ) {
    return new SandboxRuntimeError(true, "timed-out");
  }
  if (error instanceof OperationInterruptedError) {
    return new SandboxRuntimeError(error.retryable, "unavailable");
  }
  if (
    error instanceof ContainerUnavailableError ||
    error instanceof RPCTransportError ||
    error instanceof RuntimeIdentityInactiveError ||
    error instanceof StaleProcessHandleError ||
    isPlatformTransientError(error)
  ) {
    return new SandboxRuntimeError(true, "unavailable");
  }
  return new SandboxRuntimeError(false, "unavailable");
}

async function runSandboxOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw mapSandboxSdkError(error);
  }
}

export class HolonSandbox extends Sandbox<RepositoryExecutorEnv> {
  public override enableInternet = false;
  private readonly reviewLease = new SandboxLease({
    now: Date.now,
    load: () => this.ctx.storage.get<LeaseState>("holonReviewLease"),
    save: (state) => this.ctx.storage.put("holonReviewLease", state),
    schedule: async (deadlineAt) => {
      await this.schedule(
        new Date(Math.ceil(deadlineAt / 1000) * 1000),
        "expireReviewLease",
      );
    },
    keepAlive: (enabled) => this.setKeepAlive(enabled),
    destroy: () => super.destroy(),
    cancelSchedules: () => this.deleteSchedules("expireReviewLease"),
  });
  public acquireReviewLease(deadlineAt: number): Promise<void> {
    return this.reviewLease.acquire(deadlineAt);
  }
  public assertReviewLease(deadlineAt: number): Promise<void> {
    return this.reviewLease.assertActive(deadlineAt);
  }
  public expireReviewLease(): Promise<void> {
    return this.reviewLease.expire();
  }
  public closeReviewLease(): Promise<void> {
    return this.reviewLease.close();
  }
}

async function authenticatedGithubHandler(
  request: Request,
  env: RepositoryExecutorEnv,
  context: RepositoryOutboundHandlerContext,
): Promise<Response> {
  const authorization = validateGitHubEgressRequest(request, context.params);
  if (authorization === undefined) {
    return new Response("Forbidden", { status: 403 });
  }
  const credentialRequest = githubCredentialRequestSchema.safeParse({
    containerId: context.containerId,
    installationId: authorization.installationId,
    repositoryId: authorization.repositoryId,
    repositoryName: authorization.repositoryName,
    repositoryOwner: authorization.repositoryOwner,
    runId: authorization.runId,
  });
  if (!credentialRequest.success) {
    return new Response("Forbidden", { status: 403 });
  }
  let installationToken: string;
  try {
    const response = githubCredentialResponseSchema.parse(
      await env.GITHUB_CREDENTIAL_BROKER.getInstallationToken(
        credentialRequest.data,
      ),
    );
    installationToken = response.token;
  } catch {
    return new Response("Credential service unavailable", { status: 503 });
  }
  const authenticated = authenticateGitHubRequest(
    request,
    authorization,
    installationToken,
  );
  if (authenticated === undefined) {
    return new Response("Forbidden", { status: 403 });
  }
  return fetch(authenticated);
}

HolonSandbox.outboundHandlers = {
  authenticatedGithub: authenticatedGithubHandler,
  blocked: async () => new Response("Forbidden", { status: 403 }),
};

export class CloudflareSandboxPort implements SandboxPort {
  public constructor(
    private readonly sandbox: ReturnType<typeof getSandbox<HolonSandbox>>,
    private readonly execution?: ToolExecution,
  ) {}

  private wait<T>(
    start: () => Promise<T>,
    discard?: (value: T) => Promise<unknown>,
    stage?: string,
  ): Promise<T> {
    return this.execution
      ? this.execution.wait(start, discard, stage)
      : start();
  }

  public configureGitHubEgress(
    authorization: GitHubEgressAuthorization,
  ): Promise<void> {
    return runSandboxOperation(() =>
      this.sandbox.setOutboundByHost(
        githubEgressHost,
        "authenticatedGithub",
        authorization,
      ),
    );
  }

  public destroy(): Promise<void> {
    return runSandboxOperation(() => this.sandbox.destroy());
  }

  public async exists(path: string): Promise<boolean> {
    return await runSandboxOperation(
      async () =>
        (
          await this.wait(
            () => this.sandbox.exists(path),
            undefined,
            "context_exists",
          )
        ).exists,
    );
  }

  public async readFile(path: string): Promise<string> {
    return await runSandboxOperation(async () => {
      const result = await this.wait(
        () => this.sandbox.readFile(path, { encoding: "utf8" }),
        undefined,
        "read_file",
      );
      return result.content;
    });
  }

  public async writeFile(path: string, content: string): Promise<void> {
    await runSandboxOperation(() => this.sandbox.writeFile(path, content));
  }

  public blockGitHubEgress(): Promise<void> {
    return runSandboxOperation(() =>
      this.sandbox.setOutboundByHost(githubEgressHost, "blocked", {}),
    );
  }

  public async run(
    argv: readonly string[],
    options: {
      readonly cwd?: string;
      readonly maxOutputBytes?: number;
      readonly timeoutMs?: number;
    } = {},
  ) {
    let process: Awaited<ReturnType<typeof this.sandbox.exec>> | undefined;
    try {
      process = await this.wait(
        () =>
          this.sandbox.exec(argv as [string, ...string[]], {
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            ...(options.timeoutMs === undefined
              ? {}
              : { timeout: options.timeoutMs }),
          }),
        (late) =>
          this.execution
            ? this.execution.cleanup(() => late.kill())
            : late.kill(),
        "command_start",
      );
      const activeProcess = process;
      const output = await this.wait(
        () =>
          activeProcess.output({
            encoding: "utf8",
            ...(this.execution ? { signal: this.execution.signal } : {}),
            ...(options.maxOutputBytes === undefined
              ? {}
              : { maxBytes: options.maxOutputBytes }),
            ...(options.timeoutMs === undefined
              ? {}
              : { timeout: options.timeoutMs }),
          }),
        undefined,
        "command_output",
      );
      return {
        exitCode: output.exitCode,
        stderr: output.stderr,
        stdout: output.stdout,
        timedOut: output.timedOut,
        truncated: output.truncated,
      };
    } catch (error) {
      try {
        if (process) {
          const activeProcess = process;
          if (this.execution)
            await this.execution.cleanup(() => activeProcess.kill());
          else await activeProcess.kill();
        }
      } catch {
        // The process may already have exited or the container may be gone.
      }
      throw mapSandboxSdkError(error);
    }
  }
}

export class CloudflareSandboxProvider implements SandboxProvider {
  public constructor(private readonly env: RepositoryExecutorEnv) {}

  public get(runId: string): SandboxPort {
    return new CloudflareSandboxPort(
      getSandbox(this.env.SANDBOXES, createSandboxId(runId), {
        normalizeId: true,
        // Preparation recreates the checkout if this ephemeral context slept.
        sleepAfter: "30s",
        containerTimeouts: {
          instanceGetTimeoutMS: 30_000,
          portReadyTimeoutMS: 60_000,
        },
      }),
    );
  }
}

export class RepositoryExecutorEntrypoint extends WorkerEntrypoint<RepositoryExecutorEnv> {
  private service(): RepositoryExecutorService {
    return new RepositoryExecutorService(
      new CloudflareSandboxProvider(this.env),
    );
  }

  public prepareRepository(
    request: ExecutorRequest,
  ): Promise<PreparedRepository> {
    return this.service().prepareRepository(request);
  }

  public resolveContainerId(runId: string): string {
    return resolveContainerId(this.env.SANDBOXES, runId);
  }

  public loadContext(runId: string): Promise<ReviewContext> {
    return this.service().loadContext(runId);
  }

  public hasContext(runId: string): Promise<boolean> {
    return this.service().hasContext(runId);
  }

  public discoverProjectMetadata(request: unknown) {
    return this.service().discoverProjectMetadata(request);
  }

  public startTool(
    runId: string,
    call: RepositoryToolCall,
    deadlineAt: number,
  ): RepositoryToolOperation {
    const execution = new ToolExecution(
      deadlineAt,
      (work) => this.ctx.waitUntil(work),
      (fields) => {
        console.info(
          JSON.stringify({
            event: "repository.tool_operation",
            runId,
            ...fields,
          }),
        );
      },
    );
    const sandbox = getSandbox(this.env.SANDBOXES, createSandboxId(runId));
    return new RepositoryToolTask(execution, async () => {
      await execution.wait(
        () => sandbox.assertReviewLease(deadlineAt),
        undefined,
        "lease_check",
      );
      return executeRepositoryTool(
        new CloudflareSandboxPort(sandbox, execution),
        runId,
        call,
      );
    });
  }

  public acquireReviewLease(runId: string, deadlineAt: number): Promise<void> {
    return getSandbox(
      this.env.SANDBOXES,
      createSandboxId(runId),
    ).acquireReviewLease(deadlineAt);
  }

  public cleanup(runId: string): Promise<void> {
    return getSandbox(
      this.env.SANDBOXES,
      createSandboxId(runId),
    ).closeReviewLease();
  }
}

export { ContainerProxy };
