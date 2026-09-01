import { Think, type StepContext } from "@cloudflare/think";
import {
  evalSubjectOutputSchema,
  thinkEvaluationStartRequestSchema,
  type ThinkEvaluationStartRequest,
  type ThinkEvaluationStatusResponse,
} from "@holon/evaluation";
import {
  createGatewayLanguageModel,
  gatewayModelProviderOptions,
  reviewInstructions,
} from "@holon/model";

import { harnessWorkflowResultSchema } from "./workflow.js";

interface AttemptRow {
  readonly finish_reason: string | null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly tool_call_count: number;
  readonly total_tokens: number | null;
}

interface RunRow {
  readonly case_id: string;
  readonly evaluation_run_id: string;
  readonly source_revision: string;
  readonly start_state: "started" | "starting";
  readonly started_at: number;
  readonly workflow_id: string;
}

function optionalNumber(value: number | null): number | undefined {
  return value === null ? undefined : value;
}

export function evaluationGatewayMetadata(
  agentName: string,
  sourceRevision: string,
  evaluationRunId: string,
) {
  return {
    agent_name: agentName,
    evaluation_run_id: evaluationRunId,
    source_revision: sourceRevision,
    stage: "harness-evaluation",
    harness: "think-workflow",
  } as const;
}

export class HarnessEvaluationAgent extends Think<Cloudflare.Env> {
  public override fetchTools = false as const;
  public override includeMcpTools = false;
  public override maxSteps = 7;
  public override sendReasoning = false;
  public override storeMessages = false;
  public override storeTools = false;
  public override workspaceBash = false;

  public override getModel() {
    this.ensureTables();
    const run = this.sql<Pick<RunRow, "evaluation_run_id">>`
      SELECT evaluation_run_id FROM harness_run LIMIT 1
    `[0];
    if (run === undefined) {
      throw new TypeError("evaluation run identity is unavailable");
    }
    return createGatewayLanguageModel({
      accountId: this.env.AI_GATEWAY_ACCOUNT_ID,
      apiToken: this.env.AI_GATEWAY_API_TOKEN,
      gatewayId: this.env.AI_GATEWAY_ID,
      metadata: evaluationGatewayMetadata(
        this.name,
        this.env.SOURCE_REVISION,
        run.evaluation_run_id,
      ),
      model: this.env.AI_MODEL_ID,
    });
  }

  public override getSystemPrompt(): string {
    return reviewInstructions;
  }

  public override getTools() {
    return {};
  }

  public override beforeTurn() {
    return {
      maxOutputTokens: 4_000,
      maxSteps: 7,
      providerOptions: gatewayModelProviderOptions,
      sendReasoning: false,
      temperature: 0,
    };
  }

  public override onStepFinish(context: StepContext): void {
    this.ensureTables();
    const usage = context.usage;
    void this.sql`
      INSERT INTO harness_attempts (
        finish_reason,
        input_tokens,
        output_tokens,
        tool_call_count,
        total_tokens
      ) VALUES (
        ${context.finishReason},
        ${usage.inputTokens ?? null},
        ${usage.outputTokens ?? null},
        ${context.toolCalls.length},
        ${usage.totalTokens ?? null}
      )
    `;
  }

  public async startReview(
    candidate: ThinkEvaluationStartRequest,
    workflowId: string,
  ): Promise<string> {
    const request = thinkEvaluationStartRequestSchema.parse(candidate);
    if (request.sourceRevision !== this.env.SOURCE_REVISION) {
      throw new TypeError("evaluation deployment revision does not match");
    }
    this.ensureTables();
    const rows = this.sql<RunRow>`SELECT * FROM harness_run LIMIT 1`;
    const existing = rows[0];
    if (existing !== undefined) {
      if (
        existing.case_id !== request.caseId ||
        existing.evaluation_run_id !== request.evaluationRunId ||
        existing.source_revision !== request.sourceRevision ||
        existing.workflow_id !== workflowId
      ) {
        throw new TypeError("evaluation agent identity collision");
      }
      return existing.start_state === "started"
        ? existing.workflow_id
        : await this.reconcileWorkflowStart(existing.workflow_id);
    }
    await this.schedule(
      86_400,
      "destroyEvaluationAgent",
      { workflowId },
      { idempotent: true },
    );
    const startedAt = Date.now();
    void this.sql`
      INSERT INTO harness_run (
        workflow_id,
        case_id,
        evaluation_run_id,
        source_revision,
        start_state,
        started_at
      ) VALUES (
        ${workflowId},
        ${request.caseId},
        ${request.evaluationRunId},
        ${request.sourceRevision},
        ${"starting"},
        ${startedAt}
      )
    `;
    try {
      await this.runWorkflow(
        "THINK_EVALUATION_WORKFLOW",
        { caseId: request.caseId },
        {
          id: workflowId,
          metadata: {
            caseId: request.caseId,
            sourceRevision: request.sourceRevision,
          },
          retention: {
            errorRetention: "1 day",
            successRetention: "1 day",
          },
        },
      );
    } catch (startError) {
      try {
        return await this.reconcileWorkflowStart(workflowId);
      } catch {
        throw startError;
      }
    }
    this.markWorkflowStarted(workflowId);
    return workflowId;
  }

  public async destroyEvaluationAgent(_payload: {
    readonly workflowId: string;
  }): Promise<void> {
    await this.destroy();
  }

  public async reviewStatus(
    workflowId: string,
  ): Promise<ThinkEvaluationStatusResponse> {
    this.ensureTables();
    const run = this.sql<RunRow>`
      SELECT * FROM harness_run WHERE workflow_id = ${workflowId} LIMIT 1
    `[0];
    if (run === undefined) {
      return { reason: "unknown", status: "errored" };
    }
    const workflow = await this.getWorkflowStatus(
      "THINK_EVALUATION_WORKFLOW",
      workflowId,
    );
    if (workflow.status === "queued") return { status: "queued" };
    if (workflow.status === "running") return { status: "running" };
    if (workflow.status === "waiting" || workflow.status === "paused") {
      return { status: "waiting" };
    }
    if (workflow.status !== "complete") {
      return { reason: "unknown", status: "errored" };
    }
    const result = harnessWorkflowResultSchema.safeParse(workflow.output);
    if (!result.success) {
      return { reason: "model_output", status: "errored" };
    }
    if (result.data.kind === "error") {
      return { reason: result.data.reason, status: "errored" };
    }
    const attempts = this.sql<AttemptRow>`
      SELECT
        finish_reason,
        input_tokens,
        output_tokens,
        tool_call_count,
        total_tokens
      FROM harness_attempts
      ORDER BY sequence ASC
    `.map((attempt) => ({
      attempt: "think-step" as const,
      ...(attempt.finish_reason === null
        ? {}
        : { finishReason: attempt.finish_reason }),
      ...(attempt.input_tokens === null
        ? {}
        : { inputTokens: optionalNumber(attempt.input_tokens) }),
      ...(attempt.output_tokens === null
        ? {}
        : { outputTokens: optionalNumber(attempt.output_tokens) }),
      toolCallCount: attempt.tool_call_count,
      ...(attempt.total_tokens === null
        ? {}
        : { totalTokens: optionalNumber(attempt.total_tokens) }),
    }));
    return {
      result: evalSubjectOutputSchema.parse({
        ...result.data.result,
        telemetry: {
          attempts,
          durationMs: Math.max(0, Date.now() - run.started_at),
        },
      }),
      status: "complete",
    };
  }

  private ensureTables(): void {
    void this.sql`
      CREATE TABLE IF NOT EXISTS harness_run (
        workflow_id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        evaluation_run_id TEXT NOT NULL,
        source_revision TEXT NOT NULL,
        start_state TEXT NOT NULL CHECK (start_state IN ('starting', 'started')),
        started_at INTEGER NOT NULL
      )
    `;
    void this.sql`
      CREATE TABLE IF NOT EXISTS harness_attempts (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        finish_reason TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        tool_call_count INTEGER NOT NULL,
        total_tokens INTEGER
      )
    `;
  }

  private markWorkflowStarted(workflowId: string): void {
    void this.sql`
      UPDATE harness_run
      SET start_state = 'started'
      WHERE workflow_id = ${workflowId}
    `;
  }

  private async reconcileWorkflowStart(workflowId: string): Promise<string> {
    await this.getWorkflowStatus("THINK_EVALUATION_WORKFLOW", workflowId);
    this.markWorkflowStarted(workflowId);
    return workflowId;
  }
}
