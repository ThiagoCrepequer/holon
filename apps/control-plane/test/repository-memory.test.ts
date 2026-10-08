import { type MemoryObservation } from "@holon/contracts";
import { reviewJobSchema } from "@holon/contracts";
import { reset, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it } from "vitest";

import {
  createMemoryRule,
  memoryDigest,
} from "../src/memory/memory-content.js";
import { resolveRunMemory } from "../src/memory/run-memory.js";

const identity = { installationId: 99, repositoryId: 42 };
const headSha = "a".repeat(40),
  baseSha = "b".repeat(40);
function source(pr = 7) {
  return {
    ...identity,
    pullRequestNumber: pr,
    headSha,
    baseSha,
    runId: `github:42:pr:${pr}:head:${headSha}:base:${baseSha}`,
  };
}
function observation(
  pr = 7,
  kind: MemoryObservation["kind"] = "feedback",
): MemoryObservation {
  return {
    id: `comment:${pr}`,
    kind,
    source: source(pr),
    path: "src/index.ts",
    summary: "A autorização já ocorre no gateway antes do handler.",
    feedbackReason: "A autorização já ocorre no gateway antes do handler.",
    createdAt: new Date().toISOString(),
    ...(kind === "feedback"
      ? {
          authorLogin: "alice",
          commentId: pr,
          label: "false_positive" as const,
        }
      : {}),
  };
}
const memory = () => env.REPOSITORY_MEMORIES.getByName("99/42");
async function proposal(overrides = {}) {
  return await createMemoryRule({
    root: "src",
    guidance:
      "Verifique a autorização no gateway antes de apontar sua ausência no handler.",
    topic: await memoryDigest("gateway"),
    evidence: [observation()],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  });
}
afterEach(() => reset());
it.each([99, 100, 256])(
  "selects matching observations across %i changed paths",
  async (count) => {
    const paths = Array.from(
      { length: count },
      (_, index) => `src/file-${index}.ts`,
    );
    const first = {
      ...observation(7, "investigation"),
      id: "first-path",
      path: paths[0]!,
    };
    const last = {
      ...observation(8, "investigation"),
      id: "last-path",
      path: paths.at(-1)!,
    };
    const unrelated = {
      ...observation(9, "investigation"),
      id: "unrelated",
      path: "other/file.ts",
    };
    await memory().record(first);
    await memory().record(last);
    await memory().record(unrelated);
    await memory().record({ ...observation(10), path: paths.at(-1)! });
    const snapshot = await memory().snapshot(source(), "99/42", paths);
    expect(snapshot.observations.map((item) => item.id).toSorted()).toEqual([
      "first-path",
      "last-path",
    ]);
    await evictDurableObject(memory());
    expect(
      (await memory().snapshot(source(), "99/42", paths)).observations,
    ).toEqual(snapshot.observations);
  },
);
it("keeps the global newest-observation limit and deterministic tie order with 256 paths", async () => {
  const paths = Array.from(
    { length: 256 },
    (_, index) => `src/file-${index}.ts`,
  );
  const createdAt = new Date().toISOString();
  const items = Array.from({ length: 20 }, (_, index) => ({
    ...observation(7, "investigation"),
    id: `selection-${String(index).padStart(2, "0")}`,
    path: paths[index % 2 === 0 ? index : 255 - index]!,
    createdAt,
  }));
  for (const item of items.toReversed()) await memory().record(item);
  const newer = {
    ...items[0]!,
    id: "newest",
    path: paths[255]!,
    createdAt: new Date(Date.parse(createdAt) + 1000).toISOString(),
  };
  await memory().record(newer);
  const result = await memory().snapshot(source(), "99/42", paths);
  expect(result.observations.map((item) => item.id)).toEqual([
    newer.id,
    ...items.slice(0, 15).map((item) => item.id),
  ]);
  expect(
    (
      await memory().snapshot(source(), "99/42", [
        ...paths.slice(0, 255),
        paths[0]!,
      ])
    ).observations.some((item) => item.id === newer.id),
  ).toBe(false);
});
it("matches quoted and Unicode paths literally without expanding their scope", async () => {
  const path = "src/ação' OR 1=1 --\".ts";
  const exact = { ...observation(7, "investigation"), id: "quoted-path", path };
  await memory().record(exact);
  await memory().record({
    ...observation(8, "investigation"),
    id: "unrelated",
  });
  expect(
    (await memory().snapshot(source(), "99/42", [path, path])).observations,
  ).toEqual([exact]);
});
it("rejects paths beyond the admitted limit and invalid paths", async () => {
  await runInDurableObject(memory(), (object) => {
    expect(() =>
      object.snapshot(
        source(),
        "99/42",
        Array.from({ length: 257 }, (_, index) => `src/${index}.ts`),
      ),
    ).toThrow("Memory path limit exceeded");
    expect(() =>
      object.snapshot(source(), "99/42", ["../outside.ts"]),
    ).toThrow();
  });
});
it("persists observations after eviction, deduplicates and rejects identity conflicts", async () => {
  const item = observation();
  await memory().record(item);
  await memory().record(item);
  await evictDurableObject(memory());
  await runInDurableObject(memory(), async (object) => {
    await expect(
      object.record({ ...item, summary: "Different claim" }),
    ).rejects.toThrow("identity conflict");
  });
  await runInDurableObject(memory(), async (object) => {
    await expect(
      object.record({ ...item, source: { ...source(), installationId: 100 } }),
    ).rejects.toThrow("identity mismatch");
  });
  await runInDurableObject(memory(), (_, state) =>
    expect(
      state.storage.sql.exec("SELECT id FROM observations").toArray(),
    ).toHaveLength(1),
  );
});
it("counts distinct PRs rather than repeated comments before proposing a rule", async () => {
  const first = observation();
  await memory().record(first);
  await memory().record({ ...first, id: "extra-comment", commentId: 55 });
  await memory().record(observation(8));
  expect(await memory().list(identity)).toEqual([]);
  await memory().record(observation(9));
  const rules = await memory().list(identity);
  expect(rules).toHaveLength(1);
  expect(rules[0]?.state).toBe("proposed");
  expect(
    rules[0]?.evidence.map((item) => item.source.pullRequestNumber),
  ).toEqual([7, 8, 9]);
  expect((await memory().snapshot(source(), "99/42")).rules).toEqual([]);
  await memory().record(observation(10));
  expect(await memory().list(identity)).toHaveLength(1);
});
it("never promotes model observations or thread resolution into automatic rules", async () => {
  for (const pr of [7, 8, 9]) {
    await memory().record(observation(pr, "investigation"));
    await memory().record({
      ...observation(pr),
      id: `resolved:${pr}`,
      label: "thread_resolved",
    });
  }
  expect(await memory().list(identity)).toEqual([]);
});
it("requires justified feedback in each distinct PR supporting an automatic proposal", async () => {
  for (const pr of [7, 8]) {
    const { feedbackReason: _reason, ...unjustified } = observation(pr);
    await memory().record(unjustified);
  }
  await memory().record(observation(9));
  expect(await memory().list(identity)).toEqual([]);
  for (const pr of [7, 8]) {
    await memory().record({ ...observation(pr), id: `justified:${pr}` });
  }
  const rules = await memory().list(identity);
  expect(rules).toHaveLength(1);
  expect(rules[0]?.evidence).toHaveLength(3);
  expect(rules[0]?.evidence.every((item) => Boolean(item.feedbackReason))).toBe(
    true,
  );
});
it("requires exact content approval, survives eviction and records one decision on redelivery", async () => {
  const rule = await memory().propose(identity, await proposal());
  expect((await memory().snapshot(source(), "99/42")).rules).toEqual([]);
  await runInDurableObject(memory(), async (object) => {
    expect(() =>
      object.decide(identity, {
        deliveryId: "github:bad",
        action: "approve",
        id: rule.id,
        digest: "c".repeat(64),
        authorLogin: "alice",
      }),
    ).toThrow("digest mismatch");
  });
  const input = {
    deliveryId: "github:approval",
    action: "approve" as const,
    id: rule.id,
    digest: rule.digest,
    authorLogin: "alice",
  };
  const approved = await memory().decide(identity, input);
  await evictDurableObject(memory());
  expect(await memory().decide(identity, input)).toEqual(approved);
  expect((await memory().snapshot(source(), "99/42")).rules).toEqual([
    approved,
  ]);
  await runInDurableObject(memory(), async (object) => {
    expect(() =>
      object.decide(identity, { ...input, authorLogin: "bob" }),
    ).toThrow("identity conflict");
  });
  await runInDurableObject(memory(), (_, state) =>
    expect(
      state.storage.sql.exec("SELECT id FROM decisions").toArray(),
    ).toHaveLength(1),
  );
});
it("rejects forged proposals, invalid sources and invalid replacement targets", async () => {
  const rule = await proposal();
  await runInDurableObject(memory(), async (object) => {
    await expect(
      object.propose(identity, { ...rule, guidance: "Changed guidance" }),
    ).rejects.toThrow("digest mismatch");
  });
  await runInDurableObject(memory(), async (object) => {
    await expect(
      object.propose(identity, { ...rule, state: "active" }),
    ).rejects.toThrow("Invalid memory proposal");
  });
  await runInDurableObject(memory(), async (object) => {
    await expect(
      object.propose(identity, {
        ...rule,
        evidence: [
          { ...observation(), source: { ...source(), installationId: 88 } },
        ],
      }),
    ).rejects.toThrow("Invalid memory proposal");
  });
  await runInDurableObject(memory(), async (object) => {
    await expect(
      object.propose(identity, await proposal({ supersedes: "e".repeat(64) })),
    ).rejects.toThrow("not active");
  });
});
it("rejects competing decisions and revokes only future snapshots", async () => {
  const rule = await memory().propose(identity, await proposal());
  await memory().decide(identity, {
    deliveryId: "github:approve",
    action: "approve",
    id: rule.id,
    digest: rule.digest,
    authorLogin: "alice",
  });
  const before = await memory().snapshot(source(), "99/42");
  await memory().decide(identity, {
    deliveryId: "github:revoke",
    action: "revoke",
    id: rule.id,
    digest: rule.digest,
    authorLogin: "alice",
  });
  expect(before.rules).toHaveLength(1);
  expect((await memory().snapshot(source(), "99/42")).rules).toEqual([]);
  await runInDurableObject(memory(), async (object) => {
    expect(() =>
      object.decide(identity, {
        deliveryId: "github:competing",
        action: "approve",
        id: rule.id,
        digest: rule.digest,
        authorLogin: "bob",
      }),
    ).toThrow("transition rejected");
  });
});
it("supersedes an active rule atomically and prevents approving a stale replacement", async () => {
  const original = await memory().propose(identity, await proposal());
  await memory().decide(identity, {
    deliveryId: "github:approve",
    action: "approve",
    id: original.id,
    digest: original.digest,
    authorLogin: "alice",
  });
  const replacement = await memory().propose(
    identity,
    await proposal({
      guidance:
        "Verifique o novo middleware antes de apontar autorização ausente.",
      supersedes: original.id,
    }),
  );
  await memory().decide(identity, {
    deliveryId: "github:replace",
    action: "approve",
    id: replacement.id,
    digest: replacement.digest,
    authorLogin: "alice",
  });
  expect(
    (await memory().list(identity)).find((item) => item.id === original.id)
      ?.state,
  ).toBe("superseded");
  expect(
    (await memory().snapshot(source(), "99/42")).rules.map((item) => item.id),
  ).toEqual([replacement.id]);
});
it("expires rules and rejects invalid decisions", async () => {
  const expired = await memory().propose(
    identity,
    await proposal({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
  );
  await runInDurableObject(memory(), async (object) => {
    expect(() =>
      object.decide(identity, {
        deliveryId: "github:expired",
        action: "approve",
        id: expired.id,
        digest: expired.digest,
        authorLogin: "alice",
      }),
    ).toThrow("transition rejected");
  });
  await runInDurableObject(memory(), async (object) => {
    expect(() =>
      object.decide(identity, {
        deliveryId: "bad",
        action: "approve",
        id: expired.id,
        digest: expired.digest,
        authorLogin: "alice",
      }),
    ).toThrow("Invalid memory decision");
  });
});
it("retains historical provenance for revalidation and redacts secret-like values", async () => {
  const item = {
    ...observation(7, "finding"),
    summary: 'token="abcdefghijklmno"',
  };
  await memory().record(item);
  const snapshot = await memory().snapshot(source(), "99/42");
  expect(snapshot.observations[0]?.summary).toContain("[REDACTED_SECRET]");
  expect(
    (
      await memory().snapshot(
        {
          ...source(),
          headSha: "c".repeat(40),
          runId: `github:42:pr:7:head:${"c".repeat(40)}:base:${baseSha}`,
        },
        "99/42",
      )
    ).observations,
  ).toHaveLength(1);
  await runInDurableObject(memory(), async (object) => {
    await expect(
      object.record({
        ...item,
        id: "future",
        createdAt: new Date(Date.now() + 600_000).toISOString(),
      }),
    ).rejects.toThrow("Future");
  });
  await memory().record({
    ...item,
    id: "old",
    createdAt: new Date(Date.now() - 91 * 86_400_000).toISOString(),
  });
  expect(
    (await memory().snapshot(source(), "99/42")).observations,
  ).toHaveLength(1);
});
it("purges memory on repository removal and rejects delayed deliveries to the old generation", async () => {
  const registry = env.PROJECT_IDENTIFICATION_REGISTRY.getByName("99");
  expect(await registry.register(99, 42)).toBe("99/42");
  await memory().record(observation());
  await registry.revoke(99, [42]);
  await runInDurableObject(memory(), async (object) => {
    expect(() => object.list(identity)).toThrow("revoked");
  });
  expect(await registry.register(99, 42)).toBeNull();
  await registry.restore(99, [42]);
  const name = await registry.register(99, 42);
  expect(name).not.toBe("99/42");
  expect(
    await env.REPOSITORY_MEMORIES.getByName(name ?? "missing").list(identity),
  ).toEqual([]);
});
it("seals run snapshots and keeps the same selection across retries", async () => {
  const run = source();
  const job = reviewJobSchema.parse({
    runId: run.runId,
    envelope: {
      action: "opened",
      event: "pull_request",
      deliveryId: "github:memory",
      installationId: 99,
      receivedAt: new Date().toISOString(),
      repository: { id: 42, name: "api", owner: "acme", fullName: "acme/api" },
      pullRequest: {
        number: 7,
        headSha,
        baseSha,
        updatedAt: new Date().toISOString(),
      },
    },
  });
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  const runId =
    job.runId as `github:${number}:pr:${number}:head:${string}:base:${string}`;
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
    "memory-run",
  );
  await ledger.transition(runId, "queued", "running", now, "start");
  const snapshot = await resolveRunMemory(env, job, ledger);
  const rule = await memory().propose(identity, await proposal());
  await memory().decide(identity, {
    deliveryId: "github:approval",
    action: "approve",
    id: rule.id,
    digest: rule.digest,
    authorLogin: "alice",
  });
  await evictDurableObject(ledger);
  expect(await resolveRunMemory(env, job, ledger)).toEqual(snapshot);
  await runInDurableObject(ledger, async (object) => {
    await expect(
      object.saveRunMemory({ ...snapshot, revision: 999 }),
    ).rejects.toThrow("sealed");
  });
});
it("rejects snapshot overflow without silently dropping approved rules", async () => {
  for (let index = 0; index < 35; index++) {
    const rule = await memory().propose(
      identity,
      await proposal({
        guidance: `Rule ${index}: ` + "x".repeat(1480),
        topic: await memoryDigest(index),
      }),
    );
    await memory().decide(identity, {
      deliveryId: `github:approval-${index}`,
      action: "approve",
      id: rule.id,
      digest: rule.digest,
      authorLogin: "alice",
    });
  }
  await runInDurableObject(memory(), async (object) => {
    expect(() => object.snapshot(source(), "99/42")).toThrow(
      "snapshot budget exceeded",
    );
  });
});
