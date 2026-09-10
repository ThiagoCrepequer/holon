import { compileRepositoryConfiguration } from "@holon/application";
import { parseRepositoryConfigurationYaml } from "@holon/repository-config";
import { reset, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it } from "vitest";

import { configurationReader } from "./configuration-fixtures.js";

afterEach(() => reset());
const identity = {
  installationId: 99,
  repositoryId: 42,
  pullRequestNumber: 7,
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  runId: `github:42:pr:7:head:${"a".repeat(40)}:base:${"b".repeat(40)}`,
};
async function setup(
  config = {},
  files: Readonly<Record<string, string>> = {},
) {
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  const runId =
    identity.runId as `github:${number}:pr:${number}:head:${string}:base:${string}`;
  const now = new Date().toISOString();
  await ledger.claimRun(
    {
      id: runId,
      prKey: "github:42:pr:7",
      state: "queued",
      attempt: 0,
      causalVersion: now,
      createdAt: now,
    },
    "configuration-test",
  );
  await ledger.transition(runId, "queued", "running", now, "start");
  const compile = (value: unknown) =>
    compileRepositoryConfiguration(
      identity,
      configurationReader({ ...files, ".holon.yml": JSON.stringify(value) }),
      parseRepositoryConfigurationYaml,
    );
  return { ledger, snapshot: await compile(config), compile };
}
it("persists a bounded reference and losslessly restores private UTF-8 chunks after eviction", async () => {
  const secret = "private-instruction-語".repeat(500);
  const { ledger, snapshot } = await setup(
    {
      instructions: Array.from({ length: 7 }, (_, i) => ({
        path: `guidance${i}.md`,
      })),
    },
    Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [`guidance${i}.md`, secret]),
    ),
  );
  const ref = await ledger.saveRunConfiguration(snapshot);
  expect(new TextEncoder().encode(JSON.stringify(ref)).byteLength).toBeLessThan(
    4096,
  );
  expect(JSON.stringify(ref)).not.toContain("private-instruction");
  await runInDurableObject(ledger, (_object, state) => {
    expect(
      state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM run_configuration_artifacts",
        )
        .one().count,
    ).toBeGreaterThan(1);
    expect(
      state.storage.sql
        .exec<{ summary_json: string }>(
          "SELECT summary_json FROM run_configurations",
        )
        .one().summary_json,
    ).not.toContain("private-instruction");
  });
  await evictDurableObject(ledger);
  await expect(ledger.loadRunConfiguration(ref)).resolves.toEqual(snapshot);
  await expect(ledger.saveRunConfiguration(snapshot)).resolves.toEqual(ref);
});
it("rejects replacement and forged identity without overwriting the admitted snapshot", async () => {
  const { ledger, snapshot, compile } = await setup();
  const ref = await ledger.saveRunConfiguration(snapshot);
  const replacement = await compile({ output: { language: "pt-BR" } });
  await runInDurableObject(ledger, async (object) => {
    await expect(object.saveRunConfiguration(replacement)).rejects.toThrow(
      "snapshot_conflict",
    );
  });
  await runInDurableObject(ledger, async (object) => {
    await expect(
      object.loadRunConfiguration({
        ...ref,
        identity: { ...ref.identity, installationId: 100 },
      }),
    ).rejects.toThrow("snapshot_mismatch");
  });
  await expect(ledger.loadRunConfiguration(ref)).resolves.toEqual(snapshot);
});
it("fails closed for missing or damaged artifacts", async () => {
  const { ledger, snapshot } = await setup();
  const ref = await ledger.saveRunConfiguration(snapshot);
  await runInDurableObject(ledger, (_object, state) => {
    state.storage.sql.exec(
      "UPDATE run_configuration_artifacts SET payload = ?",
      new Uint8Array([255]).buffer,
    );
  });
  await runInDurableObject(ledger, async (object) => {
    await expect(object.loadRunConfiguration(ref)).rejects.toThrow(
      "snapshot_corrupt",
    );
  });
  await runInDurableObject(ledger, (_object, state) =>
    state.storage.sql.exec("DELETE FROM run_configuration_artifacts"),
  );
  await runInDurableObject(ledger, async (object) => {
    await expect(object.loadRunConfiguration(ref)).rejects.toThrow(
      "snapshot_unavailable",
    );
  });
  // An idempotent save cannot resurrect cleaned private instructions.
  await expect(ledger.saveRunConfiguration(snapshot)).resolves.toEqual(ref);
  await runInDurableObject(ledger, async (object) => {
    await expect(object.loadRunConfiguration(ref)).rejects.toThrow(
      "snapshot_unavailable",
    );
  });
});

it("serializes concurrent equal seals and rejects a divergent seal without replacement", async () => {
  const { ledger, snapshot, compile } = await setup();
  const [first, duplicate] = await Promise.all([
    ledger.saveRunConfiguration(snapshot),
    ledger.saveRunConfiguration(snapshot),
  ]);
  expect(duplicate).toEqual(first);
  const changed = await compile({ output: { max_inline_comments: 0 } });
  await runInDurableObject(ledger, async (object) => {
    const results = await Promise.allSettled([
      object.saveRunConfiguration(snapshot),
      object.saveRunConfiguration(changed),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
  });
  expect(await ledger.loadRunConfiguration(first)).toEqual(snapshot);
});
