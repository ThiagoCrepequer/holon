import { ContainerProxy, Sandbox, getSandbox } from "@cloudflare/sandbox";
import type {
  ExecutorRequest,
  PreparedRepository,
  RepositoryToolCall,
  ReviewContext,
} from "@holon/contracts";
import { WorkerEntrypoint } from "cloudflare:workers";

import {
  authenticateGitHubRequest,
  githubEgressHost,
} from "./egress-policy.js";
import {
  RepositoryExecutorService,
  type SandboxPort,
  type SandboxProvider,
} from "./executor-service.js";
import { createSandboxId } from "./sandbox-identity.js";

export class HolonSandbox extends Sandbox<Cloudflare.Env> {
  public override enableInternet = false;
}

HolonSandbox.outboundHandlers = {
  authenticatedGithub: async (request, _env, context) => {
    const authenticated = authenticateGitHubRequest(request, context.params);
    if (authenticated === undefined) {
      return new Response("Forbidden", { status: 403 });
    }
    return fetch(authenticated);
  },
  blocked: async () => new Response("Forbidden", { status: 403 }),
};

class CloudflareSandboxPort implements SandboxPort {
  public constructor(
    private readonly sandbox: ReturnType<typeof getSandbox<HolonSandbox>>,
  ) {}

  public configureGitHubEgress(
    token: string,
    repositoryPath: string,
  ): Promise<void> {
    return this.sandbox.setOutboundByHost(
      githubEgressHost,
      "authenticatedGithub",
      {
        repositoryPath,
        token,
      },
    );
  }

  public destroy(): Promise<void> {
    return this.sandbox.destroy();
  }

  public async exists(path: string): Promise<boolean> {
    return (await this.sandbox.exists(path)).exists;
  }

  public async readFile(path: string): Promise<string> {
    const result = await this.sandbox.readFile(path, { encoding: "utf8" });
    return result.content;
  }

  public async writeFile(path: string, content: string): Promise<void> {
    await this.sandbox.writeFile(path, content);
  }

  public blockGitHubEgress(): Promise<void> {
    return this.sandbox.setOutboundByHost(githubEgressHost, "blocked", {});
  }

  public async run(
    argv: readonly string[],
    options: {
      readonly cwd?: string;
      readonly maxOutputBytes?: number;
      readonly timeoutMs?: number;
    } = {},
  ) {
    const process = await this.sandbox.exec(argv as [string, ...string[]], {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.timeoutMs === undefined
        ? {}
        : { timeout: options.timeoutMs }),
    });
    try {
      return await process.output({
        encoding: "utf8",
        ...(options.maxOutputBytes === undefined
          ? {}
          : { maxBytes: options.maxOutputBytes }),
        ...(options.timeoutMs === undefined
          ? {}
          : { timeout: options.timeoutMs }),
      });
    } catch (error) {
      try {
        await process.kill();
      } catch {
        // The process may already have exited or the container may be gone.
      }
      throw error;
    }
  }
}

export class CloudflareSandboxProvider implements SandboxProvider {
  public constructor(private readonly env: Cloudflare.Env) {}

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

export class RepositoryExecutorEntrypoint extends WorkerEntrypoint {
  private service(): RepositoryExecutorService {
    return new RepositoryExecutorService(
      new CloudflareSandboxProvider(this.env),
    );
  }

  public prepare(
    request: ExecutorRequest,
    installationToken: string,
  ): Promise<PreparedRepository> {
    return this.service().prepare(request, installationToken);
  }

  public loadContext(runId: string): Promise<ReviewContext> {
    return this.service().loadContext(runId);
  }

  public hasContext(runId: string): Promise<boolean> {
    return this.service().hasContext(runId);
  }

  public runTool(runId: string, call: RepositoryToolCall) {
    return this.service().runTool(runId, call);
  }

  public cleanup(runId: string): Promise<void> {
    return this.service().cleanup(runId);
  }
}

export { ContainerProxy };
