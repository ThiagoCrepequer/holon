import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import {
  createReviewEvidenceReceipt,
  repositoryToolCallSchema,
  type ReviewEvidencePack,
} from "@holon/contracts";
import { buildToolExecution } from "@holon/repository-analysis";

import { SnapshotToolCache } from "../../repository-executor/src/snapshot-tool-cache.js";

const execute = promisify(execFile);
const image = "holon-repository-executor-holonsandbox:worker";
export async function fixtureImageDigest(): Promise<string> {
  const { stdout } = await execute(
    "docker",
    ["image", "inspect", "--format", "{{.Id}}", image],
    { timeout: 5_000 },
  );
  const digest = stdout.trim();
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest))
    throw new Error("Missing local executor image");
  return digest;
}

/** The transport is controlled; command policy, tools inside the existing image and cache are real. */
export class LiveFixtureExecutor {
  private readonly cache = new SnapshotToolCache();
  private readonly evidence = new Map<string, ReviewEvidencePack[number]>();
  private readonly events: Array<{
    tool: string;
    path?: string;
    reused: boolean;
    durationMs: number;
  }> = [];

  constructor(
    private readonly directory: string,
    private readonly files: Readonly<Record<string, string>>,
    private readonly imageDigest: string,
  ) {}

  async run(runId: string, raw: unknown) {
    const call = repositoryToolCallSchema.parse(raw);
    const paths =
      call.name === "read_file"
        ? [call.arguments.path]
        : (call.arguments.paths ?? []);
    if (paths.some((path) => !(path in this.files)))
      return { error: { kind: "query", code: "path_unavailable" } };
    const policy = buildToolExecution(call, "/workspace/repository");
    const started = performance.now();
    const cached = await this.cache.read(
      JSON.stringify({ runId, call }),
      async () => {
        const argv =
          "kind" in policy
            ? [
                "sed",
                "-n",
                `${policy.startLine},${policy.endLine}p`,
                policy.path,
              ]
            : [...policy.argv];
        let stdout: string;
        try {
          const result = await execute(
            "docker",
            [
              "run",
              "--rm",
              "--network",
              "none",
              "--read-only",
              "--entrypoint",
              "/usr/bin/env",
              "--mount",
              `type=bind,src=${this.directory},dst=/workspace/repository,readonly`,
              "--workdir",
              "/workspace/repository",
              this.imageDigest,
              ...argv,
            ],
            { timeout: 20_000, maxBuffer: 100_000, encoding: "utf8" },
          );
          stdout = result.stdout;
        } catch (error) {
          // rg/ast-grep use exit 1 for a valid empty match set. Other failures stay visible.
          if (
            call.name === "read_file" ||
            !(error instanceof Error) ||
            !("code" in error) ||
            error.code !== 1 ||
            !("stdout" in error) ||
            typeof error.stdout !== "string"
          )
            throw new Error("fixture_tool_failed", { cause: error });
          stdout = error.stdout;
        }
        const lines = stdout.trimEnd().split("\n").filter(Boolean);
        const truncated =
          call.name !== "read_file" && lines.length > call.arguments.maxResults;
        return {
          content:
            call.name === "read_file"
              ? stdout.replace(/\n$/u, "")
              : lines.slice(0, call.arguments.maxResults).join("\n"),
          truncated,
        };
      },
    );
    this.events.push({
      tool: call.name,
      ...(call.name === "read_file" ? { path: call.arguments.path } : {}),
      reused: cached.reused,
      durationMs: performance.now() - started,
    });
    if (
      call.name === "read_file" &&
      cached.result.content.length &&
      !cached.result.truncated
    ) {
      const start = call.arguments.startLine ?? 1;
      const end = Math.min(
        call.arguments.endLine ?? start + 199,
        start + cached.result.content.split("\n").length - 1,
      );
      const receipt = await createReviewEvidenceReceipt(
        runId,
        call.arguments.path,
        start,
        end,
        cached.result.content,
        false,
      );
      this.evidence.set(receipt.id, {
        receipt,
        content: cached.result.content,
      });
    }
    return cached.result;
  }

  pack(): ReviewEvidencePack {
    const selected: ReviewEvidencePack = [];
    for (const item of [...this.evidence.values()].toReversed()) {
      if (selected.length >= 8) break;
      const candidate = [...selected, item];
      if (
        item.content.length <= 16_000 &&
        Buffer.byteLength(JSON.stringify(candidate)) <= 20_000
      )
        selected.push(item);
    }
    return selected;
  }

  metrics() {
    return {
      logicalTools: this.events.length,
      physicalTools: this.events.filter((event) => !event.reused).length,
      cacheHits: this.events.filter((event) => event.reused).length,
      events: this.events,
    };
  }

  async cleanup() {
    await this.cache.clear();
  }
}

export async function validateFixtureOracle(
  directory: string,
  expectedFailure: boolean,
) {
  // No arbitrary repository input: the CLI materializes only the versioned liveFixtures constants.
  const source = await readFile(`${directory}/src/consumer.ts`, "utf8");
  if (!source.includes('from "./producer.ts"'))
    throw new Error("Invalid fixture oracle");
  let failed = false;
  try {
    await execute(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `const {run}=await import(${JSON.stringify(`${directory}/src/consumer.ts`)}); run();`,
      ],
      { timeout: 5_000, maxBuffer: 2_000 },
    );
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== 1)
      throw new Error("Oracle execution failed", { cause: error });
    failed = true;
  }
  if (failed !== expectedFailure)
    throw new Error("Oracle disagrees with the predeclared label");
  return { executed: true, failed };
}
