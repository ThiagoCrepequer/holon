import type { GitHubEgressAuthorization } from "./egress-policy.js";

export interface SandboxCommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly timedOut?: boolean;
  readonly truncated: boolean;
}

export interface SandboxPort {
  configureGitHubEgress(
    authorization: GitHubEgressAuthorization,
  ): Promise<void>;
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
