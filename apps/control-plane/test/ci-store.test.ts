import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it } from "vitest";
afterEach(() => reset());
const localized = (en: string) => ({ en, "pt-BR": en, es: en });
it("keeps distinct CI runs and rejects a late older attempt", async () => {
  const key = "github:42:pr:7" as const;
  const ledger = env.REVIEW_LEDGERS.getByName(key);
  const evidence = {
    markdownByLanguage: localized("attempt 2"),
    workflowRunId: 10,
    workflowRunAttempt: 2,
    target: {
      installationId: 99,
      repositoryId: 42,
      owner: "acme",
      repo: "api",
      pullNumber: 7,
    },
  };
  await ledger.saveCiEvidence(key, "a".repeat(40), evidence);
  await ledger.saveCiEvidence(key, "a".repeat(40), {
    ...evidence,
    workflowRunId: 11,
    markdownByLanguage: localized("workflow B"),
  });
  await ledger.saveCiEvidence(key, "a".repeat(40), {
    ...evidence,
    workflowRunAttempt: 1,
    markdownByLanguage: localized("late attempt 1"),
  });
  const loaded = await ledger.loadCiEvidence(key, "a".repeat(40));
  expect(loaded?.markdownByLanguage.en).toContain("attempt 2");
  expect(loaded?.markdownByLanguage.en).toContain("workflow B");
  expect(loaded?.markdownByLanguage.en).not.toContain("late attempt 1");
  await runInDurableObject(ledger, (_object, state) =>
    expect(
      state.storage.sql.exec("SELECT * FROM ci_publication_tasks").toArray(),
    ).toHaveLength(1),
  );
});

it("bounds large multi-workflow summaries and keeps structured counts across attempts", async () => {
  const key = "github:42:pr:7" as const;
  const ledger = env.REVIEW_LEDGERS.getByName(key);
  const head = "a".repeat(40);
  const target = {
    installationId: 99,
    repositoryId: 42,
    owner: "acme",
    repo: "api",
    pullNumber: 7,
  };
  const structuredCi = {
    durationMs: null,
    failed: 1,
    passed: 2,
    skipped: 1,
    total: 4,
    status: "partial" as const,
    workflowName: "CI",
  };
  for (let index = 1; index <= 22; index++)
    await ledger.saveCiEvidence(key, head, {
      target,
      workflowRunId: index,
      workflowRunAttempt: 1,
      markdownByLanguage: localized("界".repeat(4000)),
      structuredCi,
    });
  const loaded = await ledger.loadCiEvidence(key, head);
  expect(
    new TextEncoder().encode(loaded!.markdownByLanguage.en).length,
  ).toBeLessThan(25000);
  expect(loaded?.markdownByLanguage.en).toContain(
    "omitted from this bounded summary: 21.",
  );
  expect(loaded?.structuredCi).toMatchObject({
    total: 80,
    durationMs: null,
    status: "partial",
    workflowName: "20 workflow runs",
  });
  const latest = {
    target,
    workflowRunId: 22,
    workflowRunAttempt: 2,
    markdownByLanguage: localized("new attempt"),
    structuredCi: {
      ...structuredCi,
      durationMs: 100,
      status: "available" as const,
    },
  };
  await ledger.saveCiEvidence(key, head, latest);
  await ledger.saveCiEvidence(key, head, latest);
  expect(
    (await ledger.loadCiEvidence(key, head))?.markdownByLanguage.en,
  ).toContain("new attempt");
});
it("rejects an evidence target for a different PR", async () => {
  const ledger = env.REVIEW_LEDGERS.getByName("github:42:pr:7");
  await runInDurableObject(ledger, async (object) => {
    await expect(
      object.saveCiEvidence("github:42:pr:7", "a".repeat(40), {
        target: {
          installationId: 99,
          repositoryId: 42,
          owner: "acme",
          repo: "api",
          pullNumber: 8,
        },
        workflowRunId: 1,
        workflowRunAttempt: 1,
        markdownByLanguage: localized("CI"),
      }),
    ).rejects.toThrow("target mismatch");
  });
});
