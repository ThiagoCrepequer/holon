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
import {
  consoleErrorReporter,
  reportError,
  withErrorReporting,
  withErrorReportingSync,
} from "@holon/observability";
import { WorkerEntrypoint } from "cloudflare:workers";

import {
  authenticateGitHubRequest,
  githubEgressHost,
  validateGitHubEgressRequest,
  type GitHubEgressAuthorization,
} from "./egress-policy.js";
import { RepositoryExecutorService } from "./executor-service.js";
import { SandboxRuntimeError } from "./sandbox-errors.js";
import { createSandboxId, resolveContainerId } from "./sandbox-identity.js";
import type { SandboxPort, SandboxProvider } from "./sandbox-port.js";

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
    reportError(
      consoleErrorReporter,
      "executor.sandbox_operation_failed",
      error,
      {
        component: "repository-executor",
        operation: "sandbox.operation",
      },
    );
    throw mapSandboxSdkError(error);
  }
}

export class HolonSandbox extends Sandbox<RepositoryExecutorEnv> {
  public override enableInternet = false;
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
  } catch (error) {
    reportError(
      consoleErrorReporter,
      "executor.credential_broker_failed",
      error,
      {
        component: "repository-executor",
        operation: "github.credential_broker",
        runId: authorization.runId,
        repositoryId: authorization.repositoryId,
        installationId: authorization.installationId,
      },
    );
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
  ) {}

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
      async () => (await this.sandbox.exists(path)).exists,
    );
  }

  public async readFile(path: string): Promise<string> {
    return await runSandboxOperation(async () => {
      const result = await this.sandbox.readFile(path, { encoding: "utf8" });
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
      process = await this.sandbox.exec(argv as [string, ...string[]], {
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.timeoutMs === undefined
          ? {}
          : { timeout: options.timeoutMs }),
      });
      const output = await process.output({
        encoding: "utf8",
        ...(options.maxOutputBytes === undefined
          ? {}
          : { maxBytes: options.maxOutputBytes }),
        ...(options.timeoutMs === undefined
          ? {}
          : { timeout: options.timeoutMs }),
      });
      return {
        exitCode: output.exitCode,
        stderr: output.stderr,
        stdout: output.stdout,
        timedOut: output.timedOut,
        truncated: output.truncated,
      };
    } catch (error) {
      try {
        await process?.kill();
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
        // Tool calls recreate the checkout if this ephemeral context slept.
        sleepAfter: "30s",
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

  private observed<T>(
    operation: string,
    runId: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    return withErrorReporting(
      "executor.rpc_failed",
      consoleErrorReporter,
      { component: "repository-executor", operation, runId },
      fn,
    );
  }

  public prepareRepository(
    request: ExecutorRequest,
  ): Promise<PreparedRepository> {
    return this.observed("executor.prepare_repository", request.runId, () =>
      this.service().prepareRepository(request),
    );
  }

  public resolveContainerId(runId: string): string {
    return withErrorReportingSync(
      "executor.rpc_failed",
      consoleErrorReporter,
      {
        component: "repository-executor",
        operation: "executor.resolve_container_id",
        runId,
      },
      () => resolveContainerId(this.env.SANDBOXES, runId),
    );
  }

  public loadContext(runId: string): Promise<ReviewContext> {
    return this.observed("executor.load_context", runId, () =>
      this.service().loadContext(runId),
    );
  }

  public hasContext(runId: string): Promise<boolean> {
    return this.observed("executor.has_context", runId, () =>
      this.service().hasContext(runId),
    );
  }

  public discoverProjectMetadata(request: unknown) {
    return this.observed("executor.discover_project_metadata", undefined, () =>
      this.service().discoverProjectMetadata(request),
    );
  }

  public runTool(runId: string, call: RepositoryToolCall) {
    return this.observed("executor.run_tool", runId, () =>
      this.service().runTool(runId, call),
    );
  }

  public cleanup(runId: string): Promise<void> {
    return this.observed("executor.cleanup", runId, () =>
      this.service().cleanup(runId),
    );
  }
}

export { ContainerProxy };
