import { createReviewRun } from "@holon/application";
import {
  reviewJobSchema,
  type ReviewContext,
  type PreparedRepository,
} from "@holon/contracts";
import {
  reset,
  runInDurableObject,
  runDurableObjectAlarm,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { WorkflowStep } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import { CheckRunReconciliationStore } from "../src/check-run-reconciliation.js";
import {
  executeReviewWorkflow,
  type ReviewRuntime,
} from "../src/review-workflow.js";
import { unconfiguredExecutor } from "../test/executor-fixture.js";
import { incidentCase as fixture, injectedDefect } from "./case.js";

const settings = env as typeof env & {
  HOLON_LOCAL_REVIEW_LIVE: string;
  HOLON_LOCAL_REVIEW_URL: string;
  HOLON_LOCAL_REVIEW_CAPABILITY: string;
};
const nativeFetch = globalThis.fetch;
async function bridge<T = unknown>(
  path: string,
  body: unknown = {},
): Promise<T> {
  const response = await nativeFetch(settings.HOLON_LOCAL_REVIEW_URL + path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${settings.HOLON_LOCAL_REVIEW_CAPABILITY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Local executor failed: ${path}`);
  return (await response.json()) as T;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

it
  .skipIf(!settings.HOLON_LOCAL_REVIEW_URL)
  .each(
    settings.HOLON_LOCAL_REVIEW_LIVE === "true"
      ? ["live-small-shard"]
      : [
          "normal",
          "checkpoint-repair",
          "injected-defect",
          "provider-failure",
          "checkpoint-invalid",
        ],
  )(
  "replays PR106 through the real review composition: %s",
  async (scenario) => {
    const { headSha } = await bridge<{ headSha: string }>("/case", {
      scenario,
    });
    const now = new Date().toISOString();
    const job = reviewJobSchema.parse({
      runId: `github:${fixture.repositoryId}:pr:106:head:${headSha}:base:${fixture.baseSha}`,
      envelope: {
        action: "opened",
        deliveryId: `github:local-${scenario}`,
        event: "pull_request",
        installationId: 99,
        receivedAt: now,
        repository: {
          id: fixture.repositoryId,
          owner: fixture.repositoryOwner,
          name: fixture.repositoryName,
          fullName: `${fixture.repositoryOwner}/${fixture.repositoryName}`,
        },
        pullRequest: {
          number: 106,
          baseSha: fixture.baseSha,
          headSha: headSha,
          updatedAt: now,
        },
      },
    });
    const runId = createReviewRun(job).id;
    const defectShards = new Set<string>();
    const ledger = env.REVIEW_LEDGERS.getByName(
      `github:${fixture.repositoryId}:pr:106`,
    );
    const posts: Array<{ route: string; parameters: Record<string, unknown> }> =
      [];
    const events: Array<{ event: string; [key: string]: unknown }> = [];
    const rounds = new Map<string, number>();
    let prepared = false;
    let providerCalls = 0;
    let tools = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      if (!request.url.startsWith("https://gateway.ai.cloudflare.com/"))
        throw new Error("Unexpected external request during offline replay");
      const body = (await request.json()) as {
        messages: Array<{ role: string; content: string }>;
      };
      const metadata = JSON.parse(
        request.headers.get("cf-aig-metadata") ?? "{}",
      );
      const key = String(metadata.shard_index);
      if (scenario === "live-small-shard" && key === "3") {
        rounds.set(key, (rounds.get(key) ?? 0) + 1);
        providerCalls++;
        return await nativeFetch(settings.HOLON_LOCAL_REVIEW_URL + "/model", {
          method: "POST",
          headers: {
            authorization: `Bearer ${settings.HOLON_LOCAL_REVIEW_CAPABILITY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        });
      }
      providerCalls++;
      if (scenario === "provider-failure" && key === "0") {
        rounds.set(key, 1);
        return Response.json(
          {
            error: {
              message: "Fixture invalid provider request",
              type: "invalid_request_error",
            },
          },
          { status: 400 },
        );
      }
      let content: string | null = JSON.stringify({
        findings: [],
        summary: "Local fixture: changed behavior checked.",
      });
      let toolCalls: unknown[] | undefined;
      if (metadata.phase === "investigation") {
        const round = rounds.get(key) ?? 0;
        rounds.set(key, round + 1);
        const system =
          body.messages.find((message) => message.role === "system")?.content ??
          "";
        const match =
          /Host coverage checklist \(untrusted paths and model notes\): (\[.*?\])\./s.exec(
            system,
          );
        if (!match)
          throw new Error("Provider did not receive coverage checklist");
        const checks = JSON.parse(match[1]!) as Array<{
          id: string;
          path: string;
        }>;
        if (checks.some((check) => check.path === injectedDefect.path))
          defectShards.add(key);
        const checkpoint =
          (scenario === "checkpoint-repair" && (round === 1 || round === 2)) ||
          scenario === "checkpoint-invalid"
            ? {
                checks: [
                  {
                    id: "invalid-fixture-id",
                    status: "reviewed",
                    note: "Invalid identifier fixture",
                  },
                ],
                summary: "",
                finished: false,
              }
            : {
                checks: checks.map((check) => ({
                  id: check.id,
                  status: "reviewed",
                  note: "Fixture verified snapshot",
                })),
                summary: "Local fixture: no confirmed regression.",
                finished: true,
              };
        toolCalls = [
          {
            id: `fixture-${key}-${round}`,
            type: "function",
            function: {
              name: round === 0 ? "read_file" : "review_checkpoint",
              arguments: JSON.stringify(
                round === 0
                  ? { path: checks[0]!.path, startLine: 1, endLine: 30 }
                  : checkpoint,
              ),
            },
          },
        ];
        content = null;
      }
      if (metadata.phase !== "investigation" && defectShards.has(key))
        content = JSON.stringify({
          summary: "Boundary regression in injected fixture.",
          findings: [
            {
              suggestion: null,
              confidence: 1,
              severity: "high",
              diagnostic:
                "At attempt === limit this permits an extra attempt, violating the strict upper bound.",
              location: {
                path: injectedDefect.path,
                line: injectedDefect.line,
                startLine: null,
                side: "RIGHT",
              },
              evidence: [
                {
                  path: injectedDefect.path,
                  startLine: injectedDefect.line,
                  endLine: null,
                  excerpt: injectedDefect.excerpt,
                  reason: "Equality incorrectly permits an extra attempt.",
                },
              ],
            },
          ],
        });
      return Response.json({
        id: `local-${providerCalls}`,
        object: "chat.completion",
        created: 1,
        model: "local-fixture",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content,
              ...(toolCalls ? { tool_calls: toolCalls } : {}),
            },
            finish_reason: toolCalls ? "tool_calls" : "stop",
          },
        ],
        usage: {
          prompt_tokens: Math.ceil(JSON.stringify(body).length / 4),
          completion_tokens: 300,
          total_tokens: 300,
        },
      });
    });
    const session = {
      api: {
        async *iterate() {
          yield [];
        },
        request: async (route: string, parameters: Record<string, unknown>) => {
          posts.push({ route, parameters });
          return { data: { id: posts.length } };
        },
      },
      configurationReader: () => ({
        readFile: async (path: string) => {
          const value = await bridge<
            { kind: "found"; content: string } | { kind: "absent" }
          >("/config", { path });
          return value.kind === "found"
            ? {
                kind: "found" as const,
                bytes: new TextEncoder().encode(value.content),
              }
            : { kind: "absent" as const };
        },
        directoryExists: async () => true,
        isReferenceAllowed: () => true,
      }),
      currentHeadSha: async () => headSha,
      currentPullRequestRefs: async () => ({
        baseSha: fixture.baseSha,
        headSha: headSha,
      }),
      expectedAuthorLogin: "holon-reviewer[bot]",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      pullRequestDiff: async () => await bridge<string>("/diff"),
      token: "local-fixture-token-only",
    };
    const runtime: ReviewRuntime = {
      createSession: async () => session,
      reconcileCheckRun: async (_runId, connect) => {
        await runInDurableObject(ledger, async (_object, state) => {
          await new CheckRunReconciliationStore(state.storage).processDue(
            env,
            new Date().toISOString(),
            connect,
            runId,
          );
        });
        return await ledger.checkRunId(runId);
      },
      executor: {
        ...unconfiguredExecutor,
        resolveContainerId: async () => "f".repeat(64),
        hasContext: async () => prepared,
        prepareRepository: async (request) => {
          const result = await bridge<PreparedRepository>("/prepare", request);
          prepared = true;
          return result;
        },
        loadContext: async () => await bridge<ReviewContext>("/context"),
        cleanup: async () => {
          await bridge("/cleanup");
        },
        startTool: async (toolRunId, call) => ({
          result: async () => {
            tools++;
            return await bridge<{ content: string; truncated: boolean }>(
              "/tool",
              { runId: toolRunId, call },
            );
          },
          cancel: async () => {},
          [Symbol.dispose]: () => {},
        }),
      },
      logger: {
        emit: (event, fields) => {
          events.push({ event, ...fields });
        },
      },
      wait: async () => {},
      now: () => now,
    };
    const step = {
      async do<T>(
        _name: string,
        configOrCallback: unknown,
        callback?: unknown,
      ): Promise<T> {
        const execute = (
          typeof configOrCallback === "function" ? configOrCallback : callback
        ) as () => Promise<T>;
        return await execute();
      },
      sleep: async () => {},
      sleepUntil: async () => {},
      waitForEvent: async () => {
        throw new Error("Unexpected event wait in local replay");
      },
    } as WorkflowStep;
    await executeReviewWorkflow(
      {
        ...env,
        AI_GATEWAY_ACCOUNT_ID: "0".repeat(32),
        AI_GATEWAY_ID: "local",
        AI_GATEWAY_API_TOKEN: "local",
        AI_MODEL_ID: "dynamic/local",
      },
      {
        instanceId: `local-${scenario}`,
        payload: job,
        timestamp: new Date(now),
        workflowName: "local-review",
      },
      step,
      runtime,
    );
    console.log(
      JSON.stringify({
        scenario,
        events: events
          .map(({ event, reason, errorName, errorCode, limitationCodes }) => ({
            event,
            reason,
            errorName,
            errorCode,
            limitationCodes,
          }))
          .filter(
            (item) =>
              item.event.includes("fail") ||
              item.event.includes("reject") ||
              item.event.includes("limits"),
          ),
      }),
    );
    const coverage = events.find(
      (event) => event.event === "review.coverage_planned",
    )!;
    if (scenario !== "injected-defect")
      expect(coverage).toMatchObject({
        totalEligibleFiles: fixture.expected.files,
        totalEligibleLines: fixture.expected.lines,
        plannedShards: fixture.expected.shards,
      });
    else expect(coverage.totalEligibleFiles).toBe(33);
    expect(
      events.filter((event) => event.event === "model.output_limits"),
    ).toHaveLength(scenario === "checkpoint-invalid" ? 8 : 0);
    const failures = events.filter(
      (event) => event.event === "model.phase_failed",
    );
    if (scenario === "provider-failure")
      expect(failures.length).toBeGreaterThan(0);
    else expect(failures).toHaveLength(0);
    expect(rounds.size).toBe(coverage.plannedShards);
    expect(tools).toBeGreaterThan(0);
    await runDurableObjectAlarm(ledger);
    await vi.waitFor(
      async () =>
        expect((await ledger.cleanupState(runId))?.state).toBe("completed"),
      { timeout: 10_000, interval: 25 },
    );
    expect(await bridge("/cleanup-state")).toEqual({ destroyed: true });
    const reviews = posts.filter((post) => post.route.includes("/reviews"));
    expect(reviews).toHaveLength(1);
    if (scenario === "live-small-shard")
      expect(["APPROVE", "REQUEST_CHANGES"]).toContain(
        reviews[0]!.parameters.event,
      );
    else
      expect(reviews[0]!.parameters.event).toBe(
        scenario === "injected-defect"
          ? "REQUEST_CHANGES"
          : scenario === "provider-failure" || scenario === "checkpoint-invalid"
            ? "COMMENT"
            : "APPROVE",
      );
    if (scenario === "injected-defect")
      expect(
        posts
          .filter((post) => post.route.endsWith("/comments"))
          .map((post) => post.parameters),
      ).toEqual([
        expect.objectContaining({
          path: injectedDefect.path,
          line: injectedDefect.line,
          side: "RIGHT",
        }),
      ]);
    await bridge("/report", {
      scenario,
      files: coverage.totalEligibleFiles,
      shards: coverage.plannedShards,
      providerCalls,
      tools,
      verdict: reviews[0]!.parameters.event,
      checkpointRejections: events.filter(
        (event) => event.event === "model.checkpoint_rejected",
      ).length,
    });
  },
);
