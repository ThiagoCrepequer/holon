import type { RunId } from "@holon/domain";
import { identifySnapshot } from "@holon/project-identification";
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { AdminReadEntrypoint } from "../src/admin-read-entrypoint.js";

describe("AdminReadEntrypoint", () => {
  const validSha = "a".repeat(40);
  const validRunId = `github:42:pr:7:head:${validSha}` as RunId;

  it("responds to pingV1 with schemaVersion 1", async () => {
    const entrypoint = new AdminReadEntrypoint(createExecutionContext(), env);
    const ping = await entrypoint.pingV1();
    expect(ping).toEqual({ schemaVersion: 1 });
    expect(entrypoint).not.toHaveProperty("getRunDetailV1");
  });

  it("fails fast with strict error if request is invalid", async () => {
    const entrypoint = new AdminReadEntrypoint(createExecutionContext(), env);
    await expect(entrypoint.getRunDetailV2({})).rejects.toThrow();
    await expect(
      entrypoint.getRunDetailV2({ runId: "not-a-valid-run-id" }),
    ).rejects.toThrow();
  });

  it("returns null if the run does not exist in the ledger", async () => {
    const entrypoint = new AdminReadEntrypoint(createExecutionContext(), env);
    const detail = await entrypoint.getRunDetailV2({ runId: validRunId });
    expect(detail).toBeNull();
    expect(await entrypoint.getRunDetailV2({ runId: validRunId })).toBeNull();
  });

  it("returns sanitized DTO when the run exists in the ledger", async () => {
    const entrypoint = new AdminReadEntrypoint(createExecutionContext(), env);
    const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");

    const telemetry = {
      cost: {
        currency: "USD" as const,
        estimatedCostMicroUsd: 2500,
        estimatedCostUsd: 0.0025,
        pricingModel: "deepseek-chat",
      },
      createdAt: new Date().toISOString(),
      durationMs: 35000,
      headSha: validSha,
      isDegraded: false,
      prKey: "github:42:pr:7",
      queueWaitMs: 500,
      runId: validRunId,
      scopeStatus: "complete" as const,
      shardsCount: 1,
      stepTimings: [
        {
          attempt: 1,
          durationMs: 1200,
          status: "success" as const,
          stepName: "analyze",
        },
      ],
      terminalState: "completed" as const,
      tokens: {
        inputTokens: 5000,
        outputTokens: 1000,
        reasoningTokens: undefined,
        totalTokens: 6000,
      },
      toolCallsCount: 3,
      verdict: "APPROVE" as const,
    };

    await ledger.saveRunTelemetry(telemetry);
    await ledger.claimRun(
      {
        id: validRunId,
        prKey: "github:42:pr:7",
        state: "queued",
        attempt: 0,
        createdAt: telemetry.createdAt,
      },
      "admin-versions",
    );
    const versions = await identifySnapshot({
      snapshotSha: validSha,
      policyDigest: "p",
      modelRevision: "m",
      files: [
        {
          path: "package.json",
          content: '{"dependencies":{"react":"19.0.0"}}',
        },
      ],
    });
    await ledger.saveProjectIdentification(validRunId, versions);

    const detail = await entrypoint.getRunDetailV2({ runId: validRunId });
    expect(detail).not.toBeNull();
    expect(detail?.schemaVersion).toBe(2);
    expect(detail?.run.runId).toBe(validRunId);
    expect(detail?.run.headSha).toBe(validSha);
    expect(detail?.run.verdict).toBe("APPROVE");
    expect(detail?.currentFindings).toEqual([]);
    expect(detail?.structuredCi).toBeNull();
    expect(detail?.projectIdentification).toEqual(versions);
    expect(
      await entrypoint.getRunDetailV2({ runId: validRunId }),
    ).toMatchObject({
      schemaVersion: 2,
      projectIdentification: {
        projects: [{ technologies: [{ name: "react" }] }],
      },
    });

    // Test getRunDetailV3
    const detailV3 = await entrypoint.getRunDetailV3({ runId: validRunId });
    expect(detailV3).not.toBeNull();
    expect(detailV3?.schemaVersion).toBe(3);
    expect(detailV3?.run.runId).toBe(validRunId);
    expect(detailV3?.run.runState).toBe("completed");
    expect(detailV3?.run.terminalState).toBe("completed");
    expect(detailV3?.projectIdentification).toEqual(versions);
    expect(Array.isArray(detailV3?.stepExecutions)).toBe(true);
  });

  it("handles getRunDetailV3 validations and missing runs", async () => {
    const entrypoint = new AdminReadEntrypoint(createExecutionContext(), env);
    await expect(entrypoint.getRunDetailV3({})).rejects.toThrow();
    await expect(
      entrypoint.getRunDetailV3({ runId: "bad-id" }),
    ).rejects.toThrow();

    const missingSha = "9".repeat(40);
    const missingRunId = `github:42:pr:7:head:${missingSha}` as RunId;
    expect(await entrypoint.getRunDetailV3({ runId: missingRunId })).toBeNull();
  });
});
