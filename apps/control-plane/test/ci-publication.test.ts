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
const base = "b".repeat(40);
const runId = `${key}:head:${head}:base:${base}` as const;
const localized = (en: string) => ({ en, "pt-BR": `PT ${en}`, es: `ES ${en}` });
async function recordDecision(language: "en" | "pt-BR" | "es" = "en") {
  const ledger = env.REVIEW_LEDGERS.getByName(key);
  await ledger.claimRun(
    {
      id: runId,
      prKey: key,
      state: "queued",
      attempt: 0,
      createdAt: "2026-09-27T00:00:00Z",
      causalVersion: "2026-09-27T00:00:00Z",
    },
    "ci-publication",
  );
  await ledger.recordReviewDecision(runId, {
    headSha: head,
    scopeStatus: "complete",
    shardsAnalyzed: 1,
    totalShards: 1,
    isDegraded: false,
    output: { language, detail: "concise", maxInlineComments: 40 },
    verdictPolicy: { mediumSeverityThreshold: 2 },
  });
  return ledger;
}
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
  const ledger = await recordDecision();
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
          markdownByLanguage: localized("second workflow"),
          workflowRunId: 2,
          workflowRunAttempt: 1,
        });
      }
      return { data: { id: 77 } };
    },
  );
  vi.mocked(createInstallationSessionWithKeyring).mockResolvedValue({
    currentPullRequestRefs: async () => ({ headSha: head, baseSha: base }),
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
    markdownByLanguage: localized("first workflow"),
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

it.each(["en", "pt-BR", "es"] as const)(
  "publishes %s through the default publisher and skips an unchanged body",
  async (language) => {
    const ledger = await recordDecision(language);
    let body = "Original summary\n" + buildPublicationMarker(runId, "summary");
    const request = vi.fn(
      async (_route: string, parameters: Record<string, unknown>) => {
        body = parameters.body as string;
        return { data: { id: 999 } };
      },
    );
    vi.mocked(createInstallationSessionWithKeyring).mockResolvedValue({
      currentPullRequestRefs: async () => ({ headSha: head, baseSha: base }),
      expectedAuthorLogin: "holon-reviewer[bot]",
      api: {
        request,
        iterate: async function* () {
          yield [
            {
              id: 999,
              body,
              user: { login: "holon-reviewer[bot]", type: "Bot" },
            },
          ];
        },
      },
    } as never);
    const evidence = {
      target,
      workflowRunId: 1,
      workflowRunAttempt: 1,
      markdownByLanguage: localized("tests passed"),
    };
    await ledger.saveCiEvidence(key, head, evidence);
    await runInDurableObject(ledger, async (_object, state) => {
      const store = new CiEvidenceStore(state.storage);
      await store.processDue(testEnv, "2099-01-01T00:00:00Z");
      expect(body).toContain(evidence.markdownByLanguage[language]);
      expect(body).toContain(
        {
          en: "Workflow run",
          "pt-BR": "Execução de workflow",
          es: "Ejecución de workflow",
        }[language],
      );
      expect(body).toContain("Original summary");
      // A replayed task with an already correct remote body must not PATCH again.
      state.storage.sql.exec(
        "UPDATE ci_publication_tasks SET completed_revision=0",
      );
      await store.processDue(testEnv, "2099-01-01T00:00:00Z");
    });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
      expect.objectContaining({ review_id: 999 }),
    );
  },
);

it.each(["head", "base"])(
  "does not update a review for an obsolete %s",
  async (changed) => {
    const ledger = await recordDecision();
    const request = vi.fn();
    vi.mocked(createInstallationSessionWithKeyring).mockResolvedValue({
      currentPullRequestRefs: async () => ({
        headSha: changed === "head" ? "c".repeat(40) : head,
        baseSha: changed === "base" ? "c".repeat(40) : base,
      }),
      expectedAuthorLogin: "holon-reviewer[bot]",
      api: {
        request,
        iterate: async function* () {
          yield [];
        },
      },
    } as never);
    await ledger.saveCiEvidence(key, head, {
      target,
      workflowRunId: 1,
      workflowRunAttempt: 1,
      markdownByLanguage: localized("tests"),
    });
    await runInDurableObject(ledger, async (_object, state) => {
      await new CiEvidenceStore(state.storage).processDue(
        testEnv,
        "2099-01-01T00:00:00Z",
      );
      expect(
        state.storage.sql
          .exec("SELECT completed_revision, attempts FROM ci_publication_tasks")
          .one(),
      ).toMatchObject(
        changed === "head"
          ? { completed_revision: 1 }
          : { attempts: 1, completed_revision: 0 },
      );
    });
    expect(request).not.toHaveBeenCalled();
  },
);
