import { unavailableClarification } from "@holon/application";
import { withGenerationBudget } from "@holon/model";
import { getAgentByName } from "agents";
import { MockLanguageModelV4 } from "ai/test";
import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";

import * as services from "../src/clarification/clarification-services.js";
import type { FindingClarificationAgent } from "../src/clarification/finding-clarification-agent.js";
import {
  admission,
  clarificationLedger,
  prKey,
  questionSession,
} from "./clarification-fixtures.js";
import { configurationReader } from "./configuration-fixtures.js";
const questionToolContext = (toolName: string) =>
  ({ toolName }) as Parameters<FindingClarificationAgent["beforeToolCall"]>[0];
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});

it("investigates a validation and publishes one evidenced correction through the real Think workflow", async () => {
  const ledger = await clarificationLedger();
  await ledger.admitClarification(admission);
  const session = questionSession();
  const requestSpy = vi.spyOn(session.api, "request");
  session.configurationReader = () =>
    configurationReader({
      "src/input.ts":
        "export function process(input) {\nif (!input) return;\nrun(input);\n}",
    });
  vi.spyOn(services, "clarificationSession").mockResolvedValue(session);
  let generation = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          const input =
            generation++ === 0
              ? { path: "src/input.ts", startLine: 1, endLine: 4 }
              : {
                  outcome: "refuted",
                  confidence: 0.99,
                  explanation:
                    "A validação impede a chamada quando a entrada é vazia.",
                  scenario:
                    "A entrada vazia retorna na linha 2, antes da execução na linha 3.",
                  evidence: [
                    {
                      path: "src/input.ts",
                      startLine: 2,
                      endLine: 2,
                      excerpt: "if (!input) return;",
                    },
                  ],
                };
          controller.enqueue({
            type: "tool-call",
            toolCallId: `step-${generation}`,
            toolName: generation === 1 ? "read_file" : "think_final_answer",
            input: JSON.stringify(input),
          });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage: {
              inputTokens: {
                total: 10,
                noCache: 10,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 10, text: 10, reasoning: 0 },
            },
          });
          controller.close();
        },
      }),
    }),
  });
  const agent = await getAgentByName(
    env.FINDING_CLARIFICATION_AGENTS,
    `${prKey}:question:202`,
  );
  const id = await runInDurableObject(
    agent,
    async (instance: FindingClarificationAgent) => {
      vi.spyOn(instance, "getModel").mockReturnValue(
        withGenerationBudget(
          model,
          {
            reserve: (request) =>
              env.REVIEW_LEDGERS.getByName(
                prKey,
              ).reserveClarificationGeneration(202, request),
            settle: (reservationId, tokens) =>
              env.REVIEW_LEDGERS.getByName(prKey).settleClarificationGeneration(
                202,
                reservationId,
                tokens,
              ),
          },
          "finding_clarification",
        ),
      );
      const first = await instance.startClarification({
        prKey,
        questionId: 202,
      });
      expect(
        await instance.startClarification({ prKey, questionId: 202 }),
      ).toBe(first);
      return first;
    },
  );
  const workflow = await env.FINDING_CLARIFICATION_WORKFLOW.get(id);
  let status = await workflow.status();
  for (
    let i = 0;
    i < 150 && !["complete", "errored"].includes(status.status);
    i++
  ) {
    await scheduler.wait(50);
    status = await workflow.status();
  }
  expect(status).toMatchObject({
    status: "complete",
    output: { questionId: 202 },
  });
  expect(await ledger.loadClarification(202)).toMatchObject({
    state: "published",
    correctionApplied: true,
    answer: { outcome: "refuted", evidence: [{ startLine: 2 }] },
    replyCommentId: 303,
  });
  expect(await ledger.loadPrFindings(prKey)).toMatchObject([
    { status: "dismissed" },
  ]);
  expect(requestSpy).toHaveBeenCalledWith(
    "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies",
    expect.objectContaining({
      comment_id: 101,
      body: expect.stringContaining(
        `/blob/${admission.headSha}/src/input.ts#L2-L2`,
      ),
    }),
  );
  expect(model.doStreamCalls).toHaveLength(2);
}, 20_000);

it("recovers a failed workflow with an inconclusive reply and sanitizes model errors", async () => {
  const ledger = await clarificationLedger();
  await ledger.admitClarification(admission);
  const session = questionSession();
  vi.spyOn(services, "clarificationSession").mockResolvedValue(session);
  const agent = await getAgentByName(
    env.FINDING_CLARIFICATION_AGENTS,
    `${prKey}:question:202`,
  );
  await runInDurableObject(
    agent,
    async (instance: FindingClarificationAgent) => {
      instance.configure({ prKey, questionId: 202 });
      expect(
        instance.onChatError(new Error("private provider payload")),
      ).toMatchObject({ message: "Finding clarification inference failed" });
      await instance.onWorkflowError(
        "FINDING_CLARIFICATION_WORKFLOW",
        "failed-workflow",
        "private provider payload",
      );
      expect(await instance.authorized()).toBe(false);
      await instance.retryAnswerPublication();
    },
  );
  expect(await ledger.loadClarification(202)).toMatchObject({
    state: "published",
    correctionApplied: false,
    answer: { outcome: "inconclusive" },
  });
  expect(await ledger.loadPrFindings(prKey)).toMatchObject([{ status: "new" }]);
});

it("ends publication recovery after one day and preserves the finding when no evidence was produced", async () => {
  const ledger = await clarificationLedger();
  await ledger.admitClarification(admission);
  const record = await ledger.answerClarification(
    202,
    unavailableClarification("pt-BR"),
  );
  const session = vi
    .spyOn(services, "clarificationSession")
    .mockResolvedValue(questionSession());
  const agent = await getAgentByName(
    env.FINDING_CLARIFICATION_AGENTS,
    `${prKey}:question:202`,
  );
  await runInDurableObject(
    agent,
    async (instance: FindingClarificationAgent) => {
      instance.configure({ prKey, questionId: 202 });
      const clock = vi
        .spyOn(Date, "now")
        .mockReturnValue(record.deadlineAt + 24 * 60 * 60_000 + 1);
      try {
        await instance.retryAnswerPublication();
      } finally {
        clock.mockRestore();
      }
    },
  );
  expect(session).not.toHaveBeenCalled();
  expect(await ledger.loadClarification(202)).toMatchObject({
    state: "obsolete",
    correctionApplied: false,
  });
  expect(await ledger.loadPrFindings(prKey)).toMatchObject([{ status: "new" }]);
});

it("blocks excluded files, excessive ranges and tools after losing question authority", async () => {
  const ledger = await clarificationLedger();
  await ledger.admitClarification({
    ...admission,
    additionalExcludes: ["private/**"],
  });
  const session = vi
    .spyOn(services, "clarificationSession")
    .mockResolvedValue(questionSession());
  const agent = await getAgentByName(
    env.FINDING_CLARIFICATION_AGENTS,
    `${prKey}:question:202`,
  );
  await runInDurableObject(
    agent,
    async (instance: FindingClarificationAgent) => {
      instance.configure({ prKey, questionId: 202 });
      const turnContext = {} as Parameters<
        FindingClarificationAgent["beforeTurn"]
      >[0];
      expect(await instance.beforeTurn(turnContext)).toMatchObject({
        activeTools: ["read_file", "think_final_answer"],
        maxRetries: 0,
        maxOutputTokens: 2000,
      });
      const tools = instance.getTools();
      expect(Object.keys(tools)).toEqual(["read_file"]);
      const execute = tools.read_file.execute;
      if (!execute) throw new Error("Expected read_file execution capability");
      const options = {
        toolCallId: "bounded-read",
        messages: [],
        context: {},
      };
      await expect(
        execute({ path: "private/secret.ts" }, options),
      ).rejects.toThrow("outside clarification scope");
      await expect(
        execute({ path: "src/input.ts", startLine: 1, endLine: 201 }, options),
      ).rejects.toThrow("outside clarification scope");
      expect(
        await instance.beforeToolCall(questionToolContext("bash")),
      ).toMatchObject({
        action: "block",
      });
      expect(
        await instance.beforeToolCall(questionToolContext("read_file")),
      ).toBeUndefined();
      await env.REVIEW_LEDGERS.getByName(prKey).completeClarification(202);
      expect(
        await instance.beforeToolCall(questionToolContext("read_file")),
      ).toMatchObject({ action: "block" });
      await expect(instance.beforeTurn(turnContext)).rejects.toThrow(
        "obsolete",
      );
      await expect(execute({ path: "src/input.ts" }, options)).rejects.toThrow(
        "obsolete or read budget",
      );
      await expect(
        instance.startClarification({ prKey, questionId: 203 }),
      ).rejects.toThrow("identity changed");
    },
  );
  expect(session).not.toHaveBeenCalled();
});
