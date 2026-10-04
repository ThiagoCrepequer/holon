import { createInstallationSessionWithKeyring } from "@holon/github";
import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import { CheckRunReconciliationStore } from "../src/ledger/check-run-reconciliation.js";
vi.mock("@holon/github", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@holon/github")>()),
  createInstallationSessionWithKeyring: vi.fn(),
}));
afterEach(() => reset());
const key = "github:42:pr:7" as const;
const runId = `${key}:head:${"a".repeat(40)}:base:${"b".repeat(40)}` as const;
const desired = {
  language: "en" as const,
  baseSha: "b".repeat(40),
  installationId: 99,
  repositoryId: 42,
  owner: "acme",
  repo: "api",
  pullNumber: 7,
  input: {
    externalId: runId,
    headSha: "a".repeat(40),
    status: "in_progress" as const,
    output: { title: "Review", summary: "Reviewing" },
  },
};
const testEnv = {
  GITHUB_APP_ID: "123",
  GITHUB_APP_SLUG: "holon-reviewer",
  GITHUB_APP_PRIVATE_KEY_CURRENT: "test-key",
} as Cloudflare.Env;
async function setup() {
  const ledger = env.REVIEW_LEDGERS.getByName(key);
  await ledger.claimRun(
    {
      id: runId,
      prKey: key,
      state: "queued",
      attempt: 0,
      createdAt: new Date().toISOString(),
      causalVersion: new Date().toISOString(),
    },
    "checks",
  );
  return ledger;
}
it("does not let late completion acknowledge a newer desired status", async () => {
  const ledger = await setup();
  await runInDurableObject(ledger, (_object, state) => {
    const store = new CheckRunReconciliationStore(state.storage);
    const first = store.schedule(runId, desired);
    expect(store.schedule(runId, desired)).toBe(first);
    const second = store.schedule(runId, {
      ...desired,
      input: { ...desired.input, status: "completed", conclusion: "success" },
    });
    store.complete(runId, second);
    store.complete(runId, first);
    const row = state.storage.sql
      .exec("SELECT revision,completed_revision FROM check_run_tasks")
      .one();
    expect(row).toMatchObject({ revision: second, completed_revision: 0 });
    expect(store.schedule(runId, desired)).toBe(second);
  });
});
it("reconciles an ambiguous create using external identity and retries transient failures", async () => {
  const ledger = await setup();
  const request = vi.fn().mockResolvedValue({ data: { id: 77 } });
  const currentPullRequestRefs = vi
    .fn()
    .mockResolvedValue({ headSha: "a".repeat(40), baseSha: "b".repeat(40) });
  const session = {
    expectedAuthorLogin: "holon-reviewer[bot]",
    currentPullRequestRefs,
    api: {
      request,
      listCheckRuns: async () => [
        {
          id: 77,
          externalId: runId,
          name: "Holon Review",
          status: "in_progress",
        },
      ],
      iterate: async function* () {
        yield [
          {
            id: 77,
            external_id: runId,
            name: "Holon Review",
            app: { slug: "holon-reviewer" },
          },
        ];
      },
    },
  };
  vi.mocked(createInstallationSessionWithKeyring)
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValue(session as never);
  await runInDurableObject(ledger, async (_object, state) => {
    const store = new CheckRunReconciliationStore(state.storage);
    store.schedule(runId, desired);
    await store.processDue(testEnv, "2099-01-01T00:00:00Z");
    expect(
      state.storage.sql.exec("SELECT attempts FROM check_run_tasks").one()
        .attempts,
    ).toBe(1);
    await store.processDue(testEnv, "2099-01-01T00:00:00Z");
    expect(
      state.storage.sql
        .exec("SELECT revision,completed_revision FROM check_run_tasks")
        .one(),
    ).toEqual({ revision: 1, completed_revision: 1 });
  });
  expect(request).toHaveBeenCalledWith(
    "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
    expect.objectContaining({ check_run_id: 77, status: "in_progress" }),
  );
});
it("cancels the old check when the live head has changed", async () => {
  const ledger = await setup();
  const request = vi.fn().mockResolvedValue({ data: { id: 88 } });
  vi.mocked(createInstallationSessionWithKeyring).mockResolvedValue({
    expectedAuthorLogin: "holon-reviewer[bot]",
    currentPullRequestRefs: async () => ({
      headSha: "c".repeat(40),
      baseSha: "b".repeat(40),
    }),
    api: {
      request,
      iterate: async function* () {
        yield [];
      },
    },
  } as never);
  await runInDurableObject(ledger, async (_object, state) => {
    const store = new CheckRunReconciliationStore(state.storage);
    store.schedule(runId, desired);
    await store.processDue(testEnv, "2099-01-01T00:00:00Z");
  });
  expect(request).toHaveBeenCalledWith(
    "POST /repos/{owner}/{repo}/check-runs",
    expect.objectContaining({
      status: "completed",
      conclusion: "cancelled",
      head_sha: "a".repeat(40),
    }),
  );
});

it("serializes immediate reconcilers in the Durable Object while a newer status arrives", async () => {
  const ledger = await setup();
  await runInDurableObject(ledger, (object) => {
    (object as unknown as { env: Cloudflare.Env }).env = { ...env, ...testEnv };
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const request = vi
    .fn()
    .mockImplementationOnce(async () => {
      await gate;
      return { data: { id: 99 } };
    })
    .mockResolvedValue({ data: { id: 99 } });
  vi.mocked(createInstallationSessionWithKeyring).mockResolvedValue({
    expectedAuthorLogin: "holon-reviewer[bot]",
    currentPullRequestRefs: async () => ({
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
    }),
    api: {
      request,
      listCheckRuns: async () => [],
      iterate: async function* () {
        yield [];
      },
    },
  } as never);
  await ledger.scheduleCheckRun(runId, desired);
  const first = ledger.reconcileCheckRun(runId);
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  await ledger.scheduleCheckRun(runId, {
    ...desired,
    input: { ...desired.input, status: "completed", conclusion: "success" },
  });
  const second = ledger.reconcileCheckRun(runId);
  expect(request).toHaveBeenCalledOnce();
  release();
  await Promise.all([first, second]);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]?.[1]).toMatchObject({
    status: "completed",
    conclusion: "success",
    check_run_id: 99,
  });
  await runInDurableObject(ledger, (_object, state) =>
    expect(
      state.storage.sql
        .exec("SELECT revision,completed_revision FROM check_run_tasks")
        .one(),
    ).toEqual({ revision: 2, completed_revision: 2 }),
  );
});
it("rejects unknown runs and mismatched identities before scheduling network work", async () => {
  const ledger = await setup();
  await runInDurableObject(ledger, (_object, state) => {
    const store = new CheckRunReconciliationStore(state.storage);
    expect(() => store.schedule(runId, { ...desired, pullNumber: 8 })).toThrow(
      "identity mismatch",
    );
    const absent = `${key}:head:${"b".repeat(40)}:base:${"b".repeat(40)}`;
    expect(() =>
      store.schedule(absent, {
        ...desired,
        input: {
          ...desired.input,
          externalId: absent,
          headSha: "b".repeat(40),
        },
      }),
    ).toThrow("authority is unavailable");
  });
});

it("retries a corrupted pending task and safely skips an empty outbox", async () => {
  const ledger = await setup();
  await runInDurableObject(ledger, async (_object, state) => {
    const store = new CheckRunReconciliationStore(state.storage);
    await store.processDue(testEnv, "2099-01-01T00:00:00Z");
    store.schedule(runId, desired);
    state.storage.sql.exec(
      "UPDATE check_run_tasks SET payload='{}',attempts=20",
    );
    await store.processDue(testEnv, "2099-01-01T00:00:00Z");
    expect(
      state.storage.sql
        .exec("SELECT attempts,completed_revision FROM check_run_tasks")
        .one(),
    ).toMatchObject({ attempts: 21, completed_revision: 0 });
  });
});
