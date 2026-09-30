import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import {
  executorRequestSchema,
  repositoryToolCallSchema,
} from "@holon/contracts";
import { reviewTimeBudget } from "@holon/model";

import { repositoryToolFailure } from "../../repository-executor/src/repository-tool-failure.js";
import {
  executeRepositoryTool,
  contextPath,
  reviewScopePolicyPath,
} from "../../repository-executor/src/repository-tools.js";
import { buildReviewArtifacts } from "../../repository-executor/src/review-context.js";
import { collectStructuralRepositoryInventory } from "../../repository-executor/src/structural-repository-inventory.js";
import { incidentCase, injectedDefect } from "./case.js";
import { command, localSandbox } from "./docker.js";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
let sandbox = await localSandbox(root);
let destroyed = false;
let cleanupFlight: Promise<void> | undefined;
async function cleanup() {
  if (destroyed) return;
  cleanupFlight ??= sandbox.destroy().then(() => {
    destroyed = true;
    return undefined;
  });
  try {
    await cleanupFlight;
  } finally {
    cleanupFlight = undefined;
  }
}
const capability = randomUUID();
const liveAll = process.argv.includes("--live-all");
const live = liveAll || process.argv.includes("--live");
const liveDeepSeek = process.argv.includes("--live-deepseek");
if (liveDeepSeek && !live)
  throw new Error("--live-deepseek requires --live or --live-all");
const liveModel = liveDeepSeek
  ? "openrouter/deepseek/deepseek-v4.1-flash"
  : "dynamic/pr-review";
const maximumLiveCalls = liveAll ? 64 : liveDeepSeek ? 8 : 4;
const maximumLiveInputBytes = liveAll
  ? 4_800_000
  : liveDeepSeek
    ? 600_000
    : 300_000;
let liveCalls = 0;
let liveInputBytes = 0;
let lastDeepSeekStartAt = 0;
let deepSeekStartQueue: Promise<void> = Promise.resolve();
let headSha: string = incidentCase.headSha;
let artifacts: ReturnType<typeof buildReviewArtifacts> | undefined;
const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  const disconnected = new AbortController();
  res.once("close", () => {
    if (!res.writableEnded) disconnected.abort();
  });
  try {
    if (req.headers.authorization !== `Bearer ${capability}`) {
      res.writeHead(403).end();
      return;
    }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 2_100_000) throw new Error("Local request too large");
      chunks.push(chunk);
    }
    const body = length
      ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
      : {};
    let output: unknown;
    if (req.url === "/model") {
      if (
        !live ||
        liveCalls >= maximumLiveCalls ||
        liveInputBytes + length > maximumLiveInputBytes
      ) {
        res
          .writeHead(429)
          .end('{"error":{"message":"local_live_budget_exhausted"}}');
        return;
      }
      liveCalls++;
      const call = liveCalls;
      liveInputBytes += length;
      const token =
        process.env.CLOUDFLARE_API_TOKEN ??
        (process.env.HOLON_CREDENTIAL_FILE
          ? parseEnv(readFileSync(process.env.HOLON_CREDENTIAL_FILE, "utf8"))
              .CLOUDFLARE_API_TOKEN
          : undefined);
      if (
        !/^[a-f0-9]{32}$/.test(process.env.AI_GATEWAY_ACCOUNT_ID ?? "") ||
        !/^[a-z0-9-]+$/.test(process.env.AI_GATEWAY_ID ?? "")
      )
        throw new Error("Explicit gateway configuration required");
      if (!token) throw new Error("Local live token unavailable");
      if (liveDeepSeek) {
        const pacedStart = deepSeekStartQueue.then(async () => {
          const waitMs = Math.max(0, lastDeepSeekStartAt + 15_000 - Date.now());
          if (waitMs)
            await new Promise<void>((done) => setTimeout(done, waitMs));
          disconnected.signal.throwIfAborted();
          lastDeepSeekStartAt = Date.now();
          return undefined;
        });
        deepSeekStartQueue = pacedStart.catch(() => undefined);
        await pacedStart;
      }
      const effectiveToolChoice = body.tool_choice;
      const response = await fetch(
        `https://gateway.ai.cloudflare.com/v1/${process.env.AI_GATEWAY_ACCOUNT_ID}/${process.env.AI_GATEWAY_ID}/compat/chat/completions`,
        {
          method: "POST",
          signal: AbortSignal.any([
            AbortSignal.timeout(reviewTimeBudget.callMs),
            disconnected.signal,
          ]),
          headers: {
            "content-type": "application/json",
            "cf-aig-authorization": `Bearer ${token}`,
            "cf-aig-collect-log-payload": "false",
            "cf-aig-skip-cache": "true",
            "cf-aig-metadata": JSON.stringify({
              stage: "local-evaluation",
              fixture: liveAll ? "pr106-all-shards" : "pr106-shard3",
            }),
          },
          body: JSON.stringify({
            ...body,
            model: liveModel,
            tool_choice: effectiveToolChoice,
          }),
        },
      );
      const responseChunks: Uint8Array[] = [];
      let responseBytes = 0;
      if (response.body)
        for await (const chunk of response.body) {
          responseBytes += chunk.byteLength;
          if (responseBytes > 1_000_000)
            throw new Error("Live response exceeds local bound");
          responseChunks.push(chunk);
        }
      const responseBody = Buffer.concat(responseChunks);
      let responseToolCalls = 0;
      let responseFinishReason = "unknown";
      let responseModel = "unknown";
      let responseProvider = "unknown";
      let responseOutputTokens: number | undefined;
      let responseErrorCode: number | undefined;
      try {
        const parsed = JSON.parse(responseBody.toString("utf8"));
        const choice = parsed.choices?.[0];
        if (
          typeof parsed.model === "string" &&
          /^[A-Za-z0-9_.:/-]{1,100}$/.test(parsed.model)
        )
          responseModel = parsed.model;
        if (
          typeof parsed.provider === "string" &&
          /^[A-Za-z0-9._-]{1,100}$/.test(parsed.provider)
        )
          responseProvider = parsed.provider;
        if (
          Number.isSafeInteger(parsed.usage?.completion_tokens) &&
          parsed.usage.completion_tokens >= 0
        )
          responseOutputTokens = parsed.usage.completion_tokens;
        if (Number.isSafeInteger(parsed.error?.code))
          responseErrorCode = parsed.error.code;
        responseToolCalls = Array.isArray(choice?.message?.tool_calls)
          ? choice.message.tool_calls.length
          : 0;
        if (
          ["stop", "tool_calls", "length", "content_filter", "error"].includes(
            choice?.finish_reason,
          )
        )
          responseFinishReason = choice.finish_reason;
      } catch {
        // Report only safe metadata; the raw response is forwarded unchanged.
      }
      console.log(
        JSON.stringify({
          event: "local.live_call",
          call,
          status: response.status,
          inputBytes: length,
          responseBytes,
          durationMs: Date.now() - startedAt,
          requestedToolChoice:
            body.tool_choice === "required" ||
            body.tool_choice === "auto" ||
            body.tool_choice === "none"
              ? body.tool_choice
              : body.tool_choice?.type === "function"
                ? "specific_function"
                : "other",
          effectiveToolChoice:
            effectiveToolChoice === "auto" ||
            effectiveToolChoice === "required" ||
            effectiveToolChoice === "none"
              ? effectiveToolChoice
              : "specific_function",
          responseToolCalls,
          responseFinishReason,
          responseModel,
          responseProvider,
          responseOutputTokens,
          responseErrorCode,
          retryAfterSeconds: /^[0-9]{1,5}$/.test(
            response.headers.get("retry-after") ?? "",
          )
            ? Number(response.headers.get("retry-after"))
            : undefined,
        }),
      );
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(responseBody);
      return;
    } else if (req.url === "/case") {
      if (destroyed) {
        sandbox = await localSandbox(root);
        destroyed = false;
      }
      artifacts = undefined;
      headSha = incidentCase.headSha;
      if (body.scenario === "injected-defect") {
        await sandbox.writeFile(
          "/workspace/repository/" + injectedDefect.path,
          injectedDefect.content,
        );
        for (const argv of [
          ["git", "read-tree", incidentCase.headSha],
          ["git", "add", "--", injectedDefect.path],
        ]) {
          if ((await sandbox.run(argv)).exitCode)
            throw new Error("Mutation fixture preparation failed");
        }
        const tree = await sandbox.run(["git", "write-tree"]);
        const commit = await sandbox.run([
          "git",
          "-c",
          "user.name=Local Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit-tree",
          tree.stdout.trim(),
          "-p",
          incidentCase.headSha,
          "-m",
          "Isolated boundary regression fixture",
        ]);
        if (commit.exitCode || !/^[a-f0-9]{40}$/.test(commit.stdout.trim()))
          throw new Error("Mutation commit failed");
        headSha = commit.stdout.trim();
      }
      output = { headSha };
    } else if (req.url === "/cleanup") {
      await cleanup();
      output = { destroyed };
    } else if (req.url === "/cleanup-state") {
      output = { destroyed };
    } else if (req.url === "/diff") {
      const result = await sandbox.run([
        "git",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        `${incidentCase.baseSha}...${headSha}`,
      ]);
      if (result.exitCode || result.truncated)
        throw new Error("Local diff failed");
      output = result.stdout;
    } else if (req.url === "/config") {
      if (
        typeof body.path !== "string" ||
        !/^[A-Za-z0-9_./-]+$/.test(body.path) ||
        body.path.includes("..")
      )
        throw new Error("Invalid configuration path");
      const result = await sandbox.run([
        "git",
        "show",
        `${incidentCase.baseSha}:${body.path}`,
      ]);
      output = result.exitCode
        ? { kind: "absent" }
        : { kind: "found", content: result.stdout };
    } else if (req.url === "/prepare") {
      const request = executorRequestSchema.parse(body);
      const inventory = await collectStructuralRepositoryInventory(
        sandbox,
        request.canonicalDiff,
        request.effectivePolicy.additionalExcludes,
      );
      artifacts = buildReviewArtifacts(
        request,
        inventory.files,
        inventory.truncated,
      );
      await sandbox.writeFile(contextPath, artifacts.serializedContext);
      await sandbox.writeFile(reviewScopePolicyPath, artifacts.policy);
      output = {
        changedLineCount: artifacts.context.changedLines.length,
        contextBytes: artifacts.contextBytes,
        fileCount: artifacts.fileCount,
        runId: request.runId,
        effectivePolicyDigest: request.effectivePolicy.effectivePolicyDigest,
        waiversCount: artifacts.context.waiversCount,
        truncated: artifacts.context.truncated,
      };
    } else if (req.url === "/context") output = artifacts?.context;
    else if (req.url === "/tool") {
      try {
        output = await executeRepositoryTool(
          sandbox,
          body.runId,
          repositoryToolCallSchema.parse(body.call),
        );
      } catch (error) {
        const failure = repositoryToolFailure(error);
        console.log(
          JSON.stringify({
            event: "local.repository_tool_failed",
            kind: failure.kind,
            code: failure.code,
          }),
        );
        output = { error: failure };
      }
    } else if (req.url === "/report") {
      console.log(JSON.stringify(body));
      output = { saved: true };
    } else throw new Error("Unknown local endpoint");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(output));
  } catch (error) {
    if (req.url === "/model")
      console.log(
        JSON.stringify({
          event: "local.live_transport_failed",
          durationMs: Date.now() - startedAt,
          reason: disconnected.signal.aborted
            ? "client_cancelled"
            : error instanceof Error && error.name === "TimeoutError"
              ? "transport_timeout"
              : "transport_or_setup_failure",
        }),
      );
    res
      .writeHead(500, { "Content-Type": "application/json" })
      .end('{"error":"local_execution_failed"}');
  }
});
try {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Invalid local address");
  process.env.HOLON_LOCAL_REVIEW_URL = `http://127.0.0.1:${address.port}`;
  process.env.HOLON_LOCAL_REVIEW_CAPABILITY = capability;
  process.env.HOLON_LOCAL_REVIEW_LIVE = String(live);
  process.env.HOLON_LOCAL_REVIEW_ALL = String(liveAll);
  process.env.HOLON_LOCAL_REVIEW_TIMEOUT_MS = String(
    reviewTimeBudget.analysisMs + 60_000,
  );
  const result = await command(
    [
      "pnpm",
      "--dir",
      resolve(root, "apps/control-plane"),
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.local-review.config.ts",
    ],
    undefined,
    reviewTimeBudget.analysisMs + 120_000,
    100_000,
  );
  // Test output contains counts/assertions only; provider and repository payloads are never logged.
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
} finally {
  await new Promise<void>((done) => server.close(() => done()));
  await cleanup();
}
