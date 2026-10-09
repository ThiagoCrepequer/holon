import { reviewJobSchema } from "@holon/contracts";
import { reset, evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import { resolveRunConfiguration } from "../src/review/run-configuration-resolver.js";
import { configurationReader } from "./configuration-fixtures.js";

afterEach(() => reset());
function job(baseSha = "b".repeat(40)) {
  return reviewJobSchema.parse({
    runId: `github:42:pr:7:head:${"a".repeat(40)}:base:${baseSha}`,
    envelope: {
      action: "opened",
      deliveryId: "github:configuration-replay",
      event: "pull_request",
      installationId: 99,
      pullRequest: {
        title: "Synthetic review",
        author: "synthetic",
        state: "open",
        baseSha,
        headSha: "a".repeat(40),
        number: 7,
        updatedAt: "2026-09-09T12:00:00.000Z",
      },
      receivedAt: "2026-09-09T12:00:00.000Z",
      repository: { id: 42, name: "api", owner: "acme", fullName: "acme/api" },
    },
  });
}
async function admit(value: ReturnType<typeof job>, time: string) {
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  await ledger.claimRun(
    {
      id: value.runId as import("@holon/domain").RunId,
      prKey: "github:42:pr:7",
      state: "queued",
      attempt: 0,
      causalVersion: time,
      createdAt: time,
    },
    `wf-${value.envelope.pullRequest.baseSha}`,
  );
  await ledger.transition(
    value.runId as import("@holon/domain").RunId,
    "queued",
    "running",
    time,
    `start-${value.envelope.pullRequest.baseSha}`,
  );
  return ledger;
}
function configurationLedger(
  ledger: ReturnType<typeof env.REVIEW_LEDGERS.getByName>,
): Parameters<typeof resolveRunConfiguration>[1] {
  return {
    findRunConfiguration: async (runId) =>
      await ledger.findRunConfiguration(runId),
    loadRunConfiguration: async (reference) =>
      await ledger.loadRunConfiguration(reference),
    saveRunConfiguration: async (snapshot) =>
      await ledger.saveRunConfiguration(snapshot),
  };
}
it("recovers a sealed snapshot after response loss and eviction without recreating its reader", async () => {
  const value = job();
  const ledger = await admit(value, "2026-09-09T12:00:00.000Z");
  const originalReader = vi.fn(async () =>
    configurationReader({ ".holon.yml": "output:\n  language: es\n" }),
  );
  const ref = await resolveRunConfiguration(
    value,
    configurationLedger(ledger),
    originalReader,
  );
  // The seal committed; the caller lost the response before checkpointing it.
  await evictDurableObject(ledger);
  const unavailable = vi.fn(async () => {
    throw new Error("must not access changed or unavailable source");
  });
  const emit = vi.fn();
  await expect(
    resolveRunConfiguration(
      value,
      configurationLedger(ledger),
      unavailable,
      emit,
    ),
  ).resolves.toEqual(ref);
  expect(unavailable).not.toHaveBeenCalled();
  expect(originalReader).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith(
    "configuration.snapshot_reused",
    expect.objectContaining({ configDigest: ref.configDigest }),
  );
  expect((await ledger.loadRunConfiguration(ref)).config.output.language).toBe(
    "es",
  );
});
it("does not alias a new base with the same head", async () => {
  const first = job();
  const ledger = await admit(first, "2026-09-09T12:00:00.000Z");
  const firstRef = await resolveRunConfiguration(
    first,
    configurationLedger(ledger),
    async () =>
      configurationReader({ ".holon.yml": "output:\n  language: en\n" }),
  );
  const second = job("c".repeat(40));
  await admit(second, "2026-09-09T12:00:01.000Z");
  const secondReader = vi.fn(async () =>
    configurationReader({ ".holon.yml": "output:\n  language: pt-BR\n" }),
  );
  const secondRef = await resolveRunConfiguration(
    second,
    configurationLedger(ledger),
    secondReader,
  );
  expect(secondReader).toHaveBeenCalledTimes(1);
  expect(secondRef.identity.headSha).toBe(firstRef.identity.headSha);
  expect(secondRef.identity.runId).not.toBe(firstRef.identity.runId);
  expect(secondRef.configDigest).not.toBe(firstRef.configDigest);
  expect(
    (await ledger.loadRunConfiguration(secondRef)).config.output.language,
  ).toBe("pt-BR");
  expect(await ledger.findRunConfiguration(first.runId)).toEqual(firstRef);
});
it("refuses a reused manifest for another installation before any source access", async () => {
  const value = job();
  const ledger = await admit(value, "2026-09-09T12:00:00.000Z");
  await resolveRunConfiguration(value, configurationLedger(ledger), async () =>
    configurationReader(),
  );
  const unavailable = vi.fn(async () => configurationReader());
  const forged = {
    ...value,
    envelope: { ...value.envelope, installationId: 100 },
  };
  await expect(
    resolveRunConfiguration(forged, configurationLedger(ledger), unavailable),
  ).rejects.toMatchObject({ code: "identity_mismatch" });
  expect(unavailable).not.toHaveBeenCalled();
});
