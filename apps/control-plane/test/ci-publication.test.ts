import { buildPublicationMarker } from "@holon/domain";
import { createInstallationSessionWithKeyring } from "@holon/github";
import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import { CiEvidenceStore } from "../src/ci-evidence-store.js";
vi.mock("@holon/github", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@holon/github")>()),
  createInstallationSessionWithKeyring: vi.fn(),
}));
afterEach(() => reset());
const key = "github:42:pr:7" as const;
const head = "a".repeat(40);
const runId = `${key}:head:${head}` as const;
const target = {
  installationId: 99,
  repositoryId: 42,
  owner: "acme",
  repo: "api",
  pullNumber: 7,
};
const testEnv = {
  GITHUB_APP_ID: "123",
  GITHUB_APP_SLUG: "holon-reviewer",
  GITHUB_APP_PRIVATE_KEY_CURRENT: "test-key",
} as Cloudflare.Env;
it("retries before the review exists and republishes the union after a concurrent CI save", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName(key);
  let body: string | undefined;
  let additionalSaved = false;
  let currentStore: CiEvidenceStore;
  const request = vi.fn(
    async (_route: string, parameters: Record<string, unknown>) => {
      body = parameters.body as string;
      if (!additionalSaved) {
        additionalSaved = true;
        currentStore.save(key, head, {
          target,
          markdown: "second workflow",
          workflowRunId: 2,
          workflowRunAttempt: 1,
        });
      }
      return { data: { id: 77 } };
    },
  );
  vi.mocked(createInstallationSessionWithKeyring).mockResolvedValue({
    expectedAuthorLogin: "holon-reviewer[bot]",
    api: {
      request,
      iterate: async function* () {
        yield body
          ? [
              {
                id: 77,
                body,
                user: { type: "Bot", login: "holon-reviewer[bot]" },
              },
            ]
          : [];
      },
    },
  } as never);
  await ledger.saveCiEvidence(key, head, {
    target,
    markdown: "first workflow",
    workflowRunId: 1,
    workflowRunAttempt: 1,
  });
  await runInDurableObject(ledger, async (_object, state) => {
    const store = new CiEvidenceStore(state.storage);
    currentStore = store;
    await store.processDue(testEnv, "2099-01-01T00:00:00Z");
    expect(
      state.storage.sql.exec("SELECT attempts FROM ci_publication_tasks").one()
        .attempts,
    ).toBe(1);
  });
  body = "Review summary\n" + buildPublicationMarker(runId, "summary");
  await runInDurableObject(ledger, async (_object, state) => {
    const store = new CiEvidenceStore(state.storage);
    currentStore = store;
    await store.processDue(testEnv, "2099-01-01T00:00:00Z");
    expect(
      state.storage.sql
        .exec("SELECT revision,completed_revision FROM ci_publication_tasks")
        .one(),
    ).toMatchObject({ revision: 2, completed_revision: 0 });
    await store.processDue(testEnv, "2099-01-01T00:00:00Z");
    await store.processDue(testEnv, "2099-01-01T00:00:00Z");
  });
  expect(body).toContain("first workflow");
  expect(body).toContain("second workflow");
  expect(body).toContain("Review summary");
  expect(request).toHaveBeenCalledTimes(2);
});
