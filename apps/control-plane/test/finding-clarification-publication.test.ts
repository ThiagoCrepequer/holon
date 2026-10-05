import { clarificationMarker } from "@holon/application";
import { reset, runInDurableObject, evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import { publishClarification } from "../src/clarification/clarification-services.js";
import { CheckRunReconciliationStore } from "../src/ledger/check-run-reconciliation.js";
import {
  admission,
  clarificationLedger,
  prKey,
  questionSession,
  runId,
} from "./clarification-fixtures.js";

afterEach(() => reset());
const answer = {
  outcome: "refuted",
  confidence: 0.99,
  explanation: "A validação impede o erro antes da chamada.",
  scenario: "A entrada vazia retorna antes da execução.",
  evidence: [
    {
      path: "src/input.ts",
      startLine: 2,
      endLine: 2,
      excerpt: "if (!input) return;",
    },
  ],
};
async function answered() {
  const ledger = await clarificationLedger();
  await ledger.admitClarification(admission);
  await ledger.reserveClarificationRead(202);
  await ledger.recordClarificationRead(202, {
    path: "src/input.ts",
    startLine: 2,
    content: "if (!input) return;",
  });
  return { ledger, record: await ledger.answerClarification(202, answer) };
}
it("reconciles an ambiguous POST without posting a duplicate answer", async () => {
  const { ledger, record } = await answered();
  const baseSession = questionSession();
  let posted = false;
  const request = vi.fn(async () => {
    posted = true;
    throw new Error("simulated response timeout");
  });
  const session = {
    ...baseSession,
    api: {
      request,
      iterate: async function* () {
        yield posted
          ? [
              {
                id: 303,
                body: `Resposta\n${clarificationMarker(202)}`,
                user: { login: baseSession.expectedAuthorLogin, type: "Bot" },
              },
            ]
          : [];
      },
    },
  };
  await expect(
    publishClarification(
      { ...env, GITHUB_APP_SLUG: "holon-reviewer" },
      record,
      session,
    ),
  ).rejects.toThrow("timeout");
  expect(await ledger.loadClarification(202)).toMatchObject({
    state: "answered",
  });
  await evictDurableObject(ledger);
  await publishClarification(
    { ...env, GITHUB_APP_SLUG: "holon-reviewer" },
    record,
    session,
  );
  expect(request).toHaveBeenCalledTimes(1);
  expect(await ledger.loadClarification(202)).toMatchObject({
    state: "published",
    replyCommentId: 303,
  });
});
it("schedules the corrected Check Run atomically and preserves partial review policy", async () => {
  const ledger = await clarificationLedger();
  await ledger.recordCheckRunId(runId, 55);
  await ledger.recordReviewDecision(runId, {
    headSha: admission.headSha,
    output: { language: "pt-BR", detail: "concise", maxInlineComments: 40 },
    verdictPolicy: { mediumSeverityThreshold: 2 },
    isDegraded: true,
    scopeStatus: "partial_by_failure",
    shardsAnalyzed: 1,
    totalShards: 2,
  });
  await ledger.admitClarification(admission);
  await ledger.reserveClarificationRead(202);
  await ledger.recordClarificationRead(202, {
    path: "src/input.ts",
    startLine: 2,
    content: "if (!input) return;",
  });
  await ledger.answerClarification(202, answer);
  await evictDurableObject(ledger);
  const session = questionSession();
  const request = vi.spyOn(session.api, "request");
  await runInDurableObject(ledger, async (_instance, state) => {
    await new CheckRunReconciliationStore(state.storage).processDue(
      env,
      new Date().toISOString(),
      async () => session,
      runId,
    );
  });
  expect(request).toHaveBeenCalledWith(
    "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
    expect.objectContaining({ check_run_id: 55, conclusion: "neutral" }),
  );
  expect(await ledger.loadPrFindings(prKey)).toMatchObject([
    { status: "dismissed" },
  ]);
});
it("withholds a reply if the current head changed before publication", async () => {
  const { ledger, record } = await answered();
  const session = questionSession();
  const request = vi.spyOn(session.api, "request");
  const base = session.discussionReader("acme", "api");
  session.discussionReader = () => ({
    ...base,
    pullRequest: async (number) => ({
      ...(await base.pullRequest(number)),
      head: { sha: "e".repeat(40) },
    }),
  });
  await publishClarification(
    { ...env, GITHUB_APP_SLUG: "holon-reviewer" },
    record,
    session,
  );
  expect(request).not.toHaveBeenCalled();
  expect(await ledger.loadClarification(202)).toMatchObject({
    state: "obsolete",
  });
});
