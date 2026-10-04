import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import { handleFindingQuestionWebhook } from "../src/clarification/finding-question-handler.js";
import {
  admission,
  clarificationLedger,
  questionSession,
  prKey,
} from "./clarification-fixtures.js";
afterEach(() => reset());

it("starts one durable finding clarification for a validated inline question and resumes redelivery", async () => {
  const ledger = await clarificationLedger();
  const session = questionSession();
  const start = vi.fn().mockResolvedValue(undefined);
  const runtime = { ...env, GITHUB_APP_SLUG: "holon-reviewer" };
  expect(
    await handleFindingQuestionWebhook(runtime, admission.event, {
      createSession: async () => session,
      start,
    }),
  ).toBe(true);
  expect(start).toHaveBeenCalledWith(prKey, 202);
  expect(await ledger.loadClarification(202)).toMatchObject({
    question: admission.question,
    state: "pending",
  });
  await handleFindingQuestionWebhook(runtime, admission.event, {
    createSession: async () => session,
    start,
  });
  expect(start).toHaveBeenCalledTimes(2);
});

it("ignores ordinary replies and bot loops without opening a session", async () => {
  const createSession = vi.fn();
  expect(
    await handleFindingQuestionWebhook(
      { ...env, GITHUB_APP_SLUG: "holon-reviewer" },
      { ...admission.event, body: "Obrigado pela análise." },
      { createSession },
    ),
  ).toBe(false);
  expect(
    await handleFindingQuestionWebhook(
      { ...env, GITHUB_APP_SLUG: "holon-reviewer" },
      { ...admission.event, authorLogin: "holon-reviewer[bot]" },
      { createSession },
    ),
  ).toBe(true);
  expect(createSession).not.toHaveBeenCalled();
});

it("allows the PR author without requiring repository collaborator permission", async () => {
  const ledger = await clarificationLedger();
  const session = questionSession();
  const permission = vi
    .fn()
    .mockRejectedValue(new Error("Collaborator permission unavailable"));
  session.repositoryPermission = permission;
  const start = vi.fn();
  await handleFindingQuestionWebhook(env, admission.event, {
    createSession: async () => session,
    start,
  });
  expect(permission).not.toHaveBeenCalled();
  expect(start).toHaveBeenCalledWith(prKey, 202);
  expect(await ledger.loadClarification(202)).toMatchObject({
    state: "pending",
  });
});

it.each([
  "foreign_bot",
  "foreign_pr",
  "edited_question",
  "unauthorized",
  "closed",
  "changed_head",
])("does not admit a question with %s", async (reason) => {
  const ledger = await clarificationLedger();
  const session = questionSession();
  const base = session.discussionReader("acme", "api");
  session.discussionReader = () => ({
    comment: async (id) => {
      const comment = await base.comment(id);
      if (reason === "foreign_bot" && id === 101)
        return { ...comment, user: { login: "other[bot]", type: "Bot" } };
      if (reason === "foreign_pr")
        return {
          ...comment,
          pull_request_url: "https://api.github.com/repos/acme/api/pulls/8",
        };
      if (reason === "edited_question" && id === 202)
        return { ...comment, body: "@holon Outra pergunta?" };
      return comment;
    },
    pullRequest: async (number) => {
      const pr = await base.pullRequest(number);
      if (reason === "closed") return { ...pr, state: "closed" };
      if (reason === "unauthorized")
        return { ...pr, user: { login: "bob", type: "User" } };
      if (reason === "changed_head")
        return { ...pr, head: { sha: "e".repeat(40) } };
      return pr;
    },
  });
  if (reason === "unauthorized")
    session.repositoryPermission = async () => "read";
  const start = vi.fn();
  await handleFindingQuestionWebhook(
    { ...env, GITHUB_APP_SLUG: "holon-reviewer" },
    admission.event,
    { createSession: async () => session, start },
  );
  expect(await ledger.loadClarification(202)).toBeUndefined();
  expect(start).not.toHaveBeenCalled();
});
