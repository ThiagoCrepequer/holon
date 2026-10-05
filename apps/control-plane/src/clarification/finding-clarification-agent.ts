import {
  Think,
  type ToolCallContext,
  type TurnContext,
} from "@cloudflare/think";
import {
  ThinkWorkflow,
  type ThinkWorkflowStep,
} from "@cloudflare/think/workflows";
import { unavailableClarification } from "@holon/application";
import {
  clarificationAgentConfigSchema,
  clarificationAnswerSchema,
  clarificationHistorySchema,
  clarificationRecordSchema,
  clarificationLimits,
  readFileArgumentsSchema,
  type ClarificationAgentConfig,
} from "@holon/contracts";
import { redactSecrets } from "@holon/domain";
import {
  buildFindingClarificationPrompt,
  createGatewayLanguageModel,
  createRepositoryModelTools,
  findingClarificationInstructions,
  withGenerationBudget,
} from "@holon/model";
import { isReviewablePath } from "@holon/repository-analysis";
import type { AgentWorkflowEvent } from "agents/workflows";

import {
  clarificationSession,
  publishClarification,
  validateQuestion,
} from "./clarification-services.js";

/** A question has separate authority and budget; it cannot reopen or supersede a review run. */
export class FindingClarificationAgent extends Think<Cloudflare.Env> {
  override includeMcpTools = false;
  override workspaceBash = false;
  override storeMessages = false;
  override storeTools = false;
  override sendReasoning = false;
  override maxSteps = 8;
  config(): ClarificationAgentConfig {
    return clarificationAgentConfigSchema.parse(
      this.getConfig<ClarificationAgentConfig>(),
    );
  }
  async question() {
    const config = this.config();
    const record = await this.env.REVIEW_LEDGERS.getByName(
      config.prKey,
    ).loadClarification(config.questionId);
    if (!record || record.prKey !== config.prKey)
      throw new Error("Question unavailable");
    return clarificationRecordSchema.parse(record);
  }
  async authorized(): Promise<boolean> {
    const config = this.config();
    return this.env.REVIEW_LEDGERS.getByName(
      config.prKey,
    ).isClarificationAuthorized(config.questionId);
  }
  override onChatError(_error: unknown): Error {
    // Think persists/logs the returned error; never forward provider payloads.
    return new Error("Finding clarification inference failed");
  }
  override async onWorkflowComplete(
    _name: string,
    _id: string,
    _result?: unknown,
  ): Promise<void> {
    await this.schedule(86400, "cleanupQuestionAgent");
  }
  override async onWorkflowError(
    _name: string,
    _id: string,
    _error: string,
  ): Promise<void> {
    const record = await this.question();
    const ledger = this.env.REVIEW_LEDGERS.getByName(record.prKey);
    if (record.state === "pending")
      await ledger.answerClarification(
        record.id,
        unavailableClarification(record.language),
      );
    await this.schedule(60, "retryAnswerPublication");
  }
  async retryAnswerPublication(): Promise<void> {
    const record = await this.question();
    const ledger = this.env.REVIEW_LEDGERS.getByName(record.prKey);
    if (
      Date.now() >=
        record.deadlineAt + clarificationLimits.publicationRetryMs ||
      !(await ledger.canPublishClarification(record.id))
    ) {
      if (record.state === "answered")
        await ledger.completeClarification(record.id);
      await this.schedule(86400, "cleanupQuestionAgent");
      return;
    }
    try {
      await publishClarification(
        this.env,
        record,
        await clarificationSession(this.env, record),
      );
      await this.schedule(86400, "cleanupQuestionAgent");
    } catch {
      await this.schedule(300, "retryAnswerPublication");
    }
  }
  async cleanupQuestionAgent(): Promise<void> {
    await this.destroy();
  }
  async startClarification(raw: ClarificationAgentConfig): Promise<string> {
    const config = clarificationAgentConfigSchema.parse(raw);
    const previous = this.getConfig<ClarificationAgentConfig>();
    if (
      previous !== null &&
      JSON.stringify(clarificationAgentConfigSchema.parse(previous)) !==
        JSON.stringify(config)
    )
      throw new Error("Question identity changed");
    if (previous === null) this.configure(config);
    const record = await this.question();
    const workflowId = `clarification-${record.event.repository.id}-${record.event.pullRequestNumber}-${record.id}`;
    if (record.state === "published" || record.state === "obsolete")
      return workflowId;
    if (this.getWorkflow(workflowId)) return workflowId;
    try {
      return await this.runWorkflow("FINDING_CLARIFICATION_WORKFLOW", config, {
        id: workflowId,
        agentBinding: "FINDING_CLARIFICATION_AGENTS",
      });
    } catch (error) {
      // A create may succeed remotely before local workflow tracking commits.
      try {
        await (
          await this.env.FINDING_CLARIFICATION_WORKFLOW.get(workflowId)
        ).status();
        return workflowId;
      } catch {
        throw error;
      }
    }
  }
  override getModel() {
    const config = this.config();
    const ledger = this.env.REVIEW_LEDGERS.getByName(config.prKey);
    return withGenerationBudget(
      createGatewayLanguageModel({
        accountId: this.env.AI_GATEWAY_ACCOUNT_ID,
        apiToken: this.env.AI_GATEWAY_API_TOKEN,
        gatewayId: this.env.AI_GATEWAY_ID,
        model: this.env.AI_MODEL_ID,
        metadata: {
          stage: "finding_clarification",
          question_id: String(config.questionId),
        },
      }),
      {
        reserve: (request) =>
          ledger.reserveClarificationGeneration(config.questionId, request),
        settle: (id, tokens) =>
          ledger.settleClarificationGeneration(config.questionId, id, tokens),
      },
      "finding_clarification",
    );
  }
  override getSystemPrompt(): string {
    return findingClarificationInstructions;
  }
  override getTools() {
    const tools = createRepositoryModelTools({
      run: async (raw, execution) => {
        if (raw.name !== "read_file")
          throw new Error("Only bounded file reading is available");
        execution?.abortSignal?.throwIfAborted();
        const args = readFileArgumentsSchema.parse(raw.arguments);
        const startLine = args.startLine ?? 1;
        const endLine =
          args.endLine ?? startLine + clarificationLimits.readLines - 1;
        const record = await this.question();
        const ledger = this.env.REVIEW_LEDGERS.getByName(record.prKey);
        if (
          endLine - startLine >= clarificationLimits.readLines ||
          !isReviewablePath(args.path, record.additionalExcludes)
        )
          throw new Error("File or line range outside clarification scope");
        if (!(await ledger.reserveClarificationRead(record.id)))
          throw new Error("Question obsolete or read budget exhausted");
        const session = await clarificationSession(this.env, record);
        const result = await session
          .configurationReader(
            record.event.repository.owner,
            record.event.repository.name,
            record.headSha,
            {
              maximumRequests: 32,
              maximumTreeBytes: 262_144,
              deadlineAt: record.deadlineAt,
            },
          )
          .readFile(args.path, clarificationLimits.fileBytes);
        execution?.abortSignal?.throwIfAborted();
        if (result.kind !== "found")
          throw new Error(`File unavailable: ${result.kind}`);
        const lines = new TextDecoder("utf-8", { fatal: true })
          .decode(result.bytes)
          .replace(/\r\n/gu, "\n")
          .split("\n");
        const content = redactSecrets(
          lines.slice(startLine - 1, endLine).join("\n"),
        );
        if (
          !content ||
          !(await ledger.recordClarificationRead(record.id, {
            path: args.path,
            startLine,
            content,
          }))
        )
          throw new Error("Question obsolete or evidence budget exhausted");
        return {
          content: `File: ${args.path}\nSHA: ${record.headSha}\n${content
            .split("\n")
            .map((line, index) => `${startLine + index}: ${line}`)
            .join("\n")}`,
          truncated: endLine < lines.length,
        };
      },
    });
    tools.read_file.description =
      "Read at most 200 lines of a regular file at the finding's fixed SHA (maximum file size 64 KiB).";
    return { read_file: tools.read_file };
  }
  override async beforeTurn(_context: TurnContext) {
    if (!(await this.authorized())) throw new Error("Question obsolete");
    return {
      activeTools: ["read_file", "think_final_answer"],
      instructions: this.getSystemPrompt(),
      maxSteps: 8,
      maxOutputTokens: clarificationLimits.turnOutputTokens,
      maxRetries: 0,
      sendReasoning: false,
    };
  }
  override async beforeToolCall(context: ToolCallContext) {
    if (
      !["read_file", "think_final_answer"].includes(context.toolName) ||
      !(await this.authorized())
    )
      return {
        action: "block" as const,
        reason: "Question tool unavailable or obsolete",
      };
    return undefined;
  }
}

export class FindingClarificationWorkflow extends ThinkWorkflow<
  FindingClarificationAgent,
  ClarificationAgentConfig,
  unknown,
  Cloudflare.Env
> {
  override async run(
    event: AgentWorkflowEvent<ClarificationAgentConfig>,
    step: ThinkWorkflowStep,
  ) {
    const config = clarificationAgentConfigSchema.parse(event.payload);
    let record = clarificationRecordSchema.parse(await this.agent.question());
    if (record.id !== config.questionId || record.prKey !== config.prKey)
      throw new Error("Question workflow identity mismatch");
    const ledger = this.env.REVIEW_LEDGERS.getByName(record.prKey);
    if (record.state === "pending") {
      const history = await step.do("load-previous-exchanges", async () =>
        clarificationHistorySchema.parse(
          await ledger.clarificationHistory(record.id),
        ),
      );
      let answer: unknown = unavailableClarification(record.language);
      try {
        answer = await step.prompt("investigate-finding-question", {
          prompt: buildFindingClarificationPrompt(record, history),
          output: clarificationAnswerSchema,
          timeout: "4 minutes",
          cancelOnTimeout: true,
        });
      } catch {
        // A failed investigation never silently confirms or retracts a diagnosis.
      }
      record = await step.do(
        "verify-and-record-answer",
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
        async () => {
          const session = await clarificationSession(this.env, record);
          const current = await validateQuestion(
            session,
            record.event,
            this.env.GITHUB_APP_SLUG,
          );
          if (
            !current ||
            current.headSha !== record.headSha ||
            current.baseSha !== record.baseSha
          ) {
            await ledger.completeClarification(record.id);
            return clarificationRecordSchema.parse(
              await ledger.loadClarification(record.id),
            );
          }
          return clarificationRecordSchema.parse(
            await ledger.answerClarification(record.id, answer),
          );
        },
      );
    }
    if (record.state === "answered")
      await step.do(
        "publish-finding-answer",
        { retries: { limit: 5, delay: "10 seconds", backoff: "exponential" } },
        async () =>
          publishClarification(
            this.env,
            record,
            await clarificationSession(this.env, record),
          ),
      );
    return { questionId: record.id };
  }
}
