import { identifySnapshot } from "@holon/project-identification";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { it, expect } from "vitest";
async function project() {
  return (
    await identifySnapshot({
      snapshotSha: "a".repeat(40),
      policyDigest: "p",
      modelRevision: "m",
      files: [
        {
          path: "package.json",
          content: '{"dependencies":{"react":"19.0.0"}}',
        },
      ],
    })
  ).projects[0]!;
}
it("shares results across runs", async () => {
  const p = await project(),
    s = env.PROJECT_IDENTIFICATION_CACHE.getByName(crypto.randomUUID()),
    c = await s.claim(p.fingerprint, "a");
  if (c.status !== "claimed") throw new Error("claim");
  expect(await s.attempt(p.fingerprint, "a", c.token)).toBe(true);
  expect(await s.complete(p.fingerprint, "a", c.token, p)).toBe(true);
  expect((await s.claim(p.fingerprint, "b")).status).toBe("hit");
  expect(await s.complete("b".repeat(64), "a", c.token, p)).toBe(false);
});
it("deduplicates and fences expired owners", async () => {
  const p = await project(),
    s = env.PROJECT_IDENTIFICATION_CACHE.getByName(crypto.randomUUID()),
    c = await s.claim(p.fingerprint, "a");
  if (c.status !== "claimed") throw new Error("claim");
  expect((await s.claim(p.fingerprint, "b")).status).toBe("pending");
  await runInDurableObject(s, (_i, state) => {
    state.storage.sql.exec("UPDATE entries SET lease=0");
  });
  const b = await s.claim(p.fingerprint, "b");
  if (b.status !== "claimed") throw new Error("claim");
  expect(b.token).toBeGreaterThan(c.token);
  expect(await s.complete(p.fingerprint, "a", c.token, p)).toBe(false);
  expect(await s.attempt(p.fingerprint, "wrong", b.token)).toBe(false);
});
it("retains retry budget and cooldown", async () => {
  const p = await project(),
    s = env.PROJECT_IDENTIFICATION_CACHE.getByName(crypto.randomUUID()),
    c = await s.claim(p.fingerprint, "a");
  if (c.status !== "claimed") throw new Error("claim");
  expect(await s.attempt(p.fingerprint, "a", c.token)).toBe(true);
  expect(await s.attempt(p.fingerprint, "a", c.token)).toBe(true);
  expect(await s.attempt(p.fingerprint, "a", c.token)).toBe(false);
  await s.fail(p.fingerprint, "a", c.token);
  expect((await s.claim(p.fingerprint, "b")).status).toBe("pending");
  await runInDurableObject(s, (_i, state) => {
    state.storage.sql.exec("UPDATE entries SET lease=0");
  });
  expect((await s.claim(p.fingerprint, "a")).status).toBe("unavailable");
});
it("prevents in-flight writes after purge", async () => {
  const p = await project(),
    s = env.PROJECT_IDENTIFICATION_CACHE.getByName(crypto.randomUUID()),
    c = await s.claim(p.fingerprint, "a");
  if (c.status !== "claimed") throw new Error("claim");
  await s.revoke();
  expect(await s.complete(p.fingerprint, "a", c.token, p)).toBe(false);
  expect(await s.attempt(p.fingerprint, "a", c.token)).toBe(false);
  expect((await s.claim(p.fingerprint, "b")).status).toBe("unavailable");
});
it("rejects invalid inputs and recovers corrupt entries", async () => {
  const p = await project(),
    s = env.PROJECT_IDENTIFICATION_CACHE.getByName(crypto.randomUUID());
  await runInDurableObject(s, async (instance) => {
    await expect(instance.claim("bad", "a")).rejects.toThrow();
    await expect(instance.claim(p.fingerprint, "")).rejects.toThrow();
  });
  await s.claim(p.fingerprint, "a");
  await runInDurableObject(s, (_i, state) => {
    state.storage.sql.exec("UPDATE entries SET payload='invalid',lease=0");
  });
  expect((await s.claim(p.fingerprint, "b")).status).toBe("claimed");
});
it("expires cache via alarm", async () => {
  const p = await project(),
    s = env.PROJECT_IDENTIFICATION_CACHE.getByName(crypto.randomUUID());
  await s.claim(p.fingerprint, "a");
  await runInDurableObject(s, (_i, state) => {
    state.storage.sql.exec("UPDATE entries SET expires=0,lease=0");
  });
  await runDurableObjectAlarm(s);
  expect((await s.claim(p.fingerprint, "b")).status).toBe("claimed");
});
it("revokes even before an unseen repo registers", async () => {
  const s = env.PROJECT_IDENTIFICATION_REGISTRY.getByName(crypto.randomUUID());
  await s.revoke(99, [10]);
  expect(await s.register(99, 10)).toBeNull();
  expect(await s.register(99, 11)).toBe("99/11");
  await s.revoke(99, null);
  expect(await s.register(99, 12)).toBeNull();
});
it("restores access using a new cache generation without resurrecting purged data", async () => {
  const registry = env.PROJECT_IDENTIFICATION_REGISTRY.getByName(
    crypto.randomUUID(),
  );
  const old = await registry.register(55, 1);
  await registry.register(55, 2);
  await registry.revoke(55, [2]);
  await registry.revoke(55, null);
  await registry.restore(55, null);
  expect(await registry.register(55, 1)).not.toBe(old);
  expect(await registry.register(55, 2)).toBeNull();
  await registry.restore(55, [2]);
  expect(await registry.register(55, 2)).not.toBeNull();
  expect(
    (
      await env.PROJECT_IDENTIFICATION_CACHE.getByName(old!).claim(
        "a".repeat(64),
        "run",
      )
    ).status,
  ).toBe("unavailable");
});
it("never reuses a fencing token after entry eviction", async () => {
  const p = await project(),
    s = env.PROJECT_IDENTIFICATION_CACHE.getByName(crypto.randomUUID());
  const first = await s.claim(p.fingerprint, "a");
  await runInDurableObject(s, (_i, state) => {
    state.storage.sql.exec("DELETE FROM entries");
  });
  const second = await s.claim(p.fingerprint, "a");
  if (first.status !== "claimed" || second.status !== "claimed")
    throw new Error("claim");
  expect(second.token).toBeGreaterThan(first.token);
  expect(await s.complete(p.fingerprint, "a", first.token, p)).toBe(false);
});
