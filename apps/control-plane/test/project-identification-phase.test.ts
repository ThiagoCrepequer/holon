import { reviewJobSchema } from "@holon/contracts";
import { identifySnapshot } from "@holon/project-identification";
import type { WorkflowStep } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import { runProjectIdentification } from "../src/review/project-identification-phase.js";
import type { ReviewServices } from "../src/review/review-services.js";
import {
  defaultRunConfiguration,
  defaultScopePolicy,
} from "./configuration-fixtures.js";

afterEach(() => vi.restoreAllMocks());

async function scenario() {
  const headSha = "a".repeat(40);
  const baseSha = "b".repeat(40);
  const job = reviewJobSchema.parse({
    runId: `github:42:pr:7:head:${headSha}:base:${baseSha}`,
    envelope: {
      action: "opened",
      deliveryId: "github:identification-phase",
      event: "pull_request",
      installationId: 99,
      pullRequest: {
        title: "Synthetic review",
        author: "synthetic",
        state: "open",
        baseSha,
        headSha,
        number: 7,
        updatedAt: "2026-09-09T12:00:00.000Z",
      },
      receivedAt: "2026-09-09T12:00:00.000Z",
      repository: { id: 42, name: "api", owner: "acme", fullName: "acme/api" },
    },
  });
  const snapshot = await defaultRunConfiguration(job);
  const configuration = {
    identity: snapshot.identity,
    sourceDigest: snapshot.sourceDigest,
    configDigest: snapshot.configDigest,
    scopeDigest: snapshot.scopeDigest,
  };
  const discovered = await identifySnapshot({
    snapshotSha: headSha,
    policyDigest: "p",
    modelRevision: "m",
    files: [
      { path: "package.json", content: '{"dependencies":{"react":"19.0.0"}}' },
    ],
  });
  return {
    job,
    policy: await defaultScopePolicy(baseSha),
    configuration,
    snapshot,
    discovered,
  };
}

function immediateStep(after?: (name: string) => void): WorkflowStep {
  return {
    do: async <T>(
      name: string,
      _options: unknown,
      callback: () => Promise<T>,
    ) => {
      const result = await callback();
      after?.(name);
      return result;
    },
    sleep: async () => {},
  } as unknown as WorkflowStep;
}

it("persists a partial identification when model inference is unavailable", async () => {
  const input = await scenario();
  const identifyProjects = vi.fn(
    async (
      ...args: Parameters<NonNullable<ReviewServices["identifyProjects"]>>
    ) => (args[2] ? input.discovered : null),
  );
  const saveProjectIdentification = vi.fn(async () => {});
  const emit = vi.fn();
  await runProjectIdentification({
    ...input,
    services: {
      identifyProjects,
      ledger: {
        loadRunConfiguration: async () => input.snapshot,
        saveProjectIdentification,
      },
    },
    step: immediateStep(),
    emit,
  });
  expect(saveProjectIdentification).toHaveBeenCalledWith(
    input.job.runId,
    expect.objectContaining({
      status: "partial",
      projects: [
        expect.objectContaining({
          status: "partial",
          limitations: expect.arrayContaining(["identification-unavailable"]),
        }),
      ],
    }),
  );
  expect(emit).toHaveBeenCalledWith(
    "project.identification_partial",
    expect.objectContaining({ partialProjects: 1, totalProjects: 1 }),
  );
});

it("stops model inference at the durable deadline and records its limitation", async () => {
  const input = await scenario();
  const started = Date.now();
  let now = started;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const identifyProjects = vi.fn(async () => input.discovered);
  const saveProjectIdentification = vi.fn(async () => {});
  await runProjectIdentification({
    ...input,
    services: {
      identifyProjects,
      ledger: {
        loadRunConfiguration: async () => input.snapshot,
        saveProjectIdentification,
      },
    },
    step: immediateStep((name) => {
      if (name === "discover-project-metadata") now = started + 120_000;
    }),
    emit: vi.fn(),
  });
  expect(identifyProjects).toHaveBeenCalledTimes(1);
  expect(saveProjectIdentification).toHaveBeenCalledWith(
    input.job.runId,
    expect.objectContaining({
      status: "partial",
      projects: [
        expect.objectContaining({
          limitations: expect.arrayContaining(["identification-deadline"]),
        }),
      ],
    }),
  );
});
