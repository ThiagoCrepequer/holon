import type { ModelReviewer, ReviewContext } from "@holon/application";
import { modelReviewOutputSchema, type ReviewJob } from "@holon/contracts";
import { createPrKey } from "@holon/domain";
import {
  buildReviewPromptResult,
  outputLanguageInstructions,
  preflightReviewPrompt,
  redactModelReviewOutput,
  serializedRepositoryGuidance,
} from "@holon/model";
import { getAgentByName } from "agents";

export class ThinkReviewFailure extends Error {
  constructor(
    public readonly reason:
      | "agent_workflow_failed"
      | "agent_workflow_terminated"
      | "agent_deadline_exceeded",
  ) {
    super(reason);
    this.name = "ThinkReviewFailure";
  }
}

/** Adapts the durable Think shard workflow to the existing review application port. */
export class ThinkReviewModelReviewer implements ModelReviewer {
  constructor(
    private readonly env: Cloudflare.Env,
    private readonly shardIndex: number,
    private readonly totalShards: number,
    private readonly wait: (milliseconds: number) => Promise<void> = (
      milliseconds,
    ) => scheduler.wait(milliseconds),
  ) {}

  async review(job: ReviewJob, context: ReviewContext) {
    context.abortSignal?.throwIfAborted();
    preflightReviewPrompt(job, context);
    const prompt = buildReviewPromptResult(job, context);
    const guidance = serializedRepositoryGuidance(context.repositoryGuidance);
    const deadlineAt = context.deadlineAt ?? Date.now() + 20 * 60_000;
    if (Date.now() >= deadlineAt)
      throw new ThinkReviewFailure("agent_deadline_exceeded");
    const prKey = createPrKey({
      provider: "github",
      pullRequestNumber: job.envelope.pullRequest.number,
      repositoryId: job.envelope.repository.id,
    });
    const agent = await getAgentByName(
      this.env.REVIEW_AGENTS,
      `${job.runId}:${this.shardIndex}`,
    );
    const workflowId = await agent.startReview({
      deadlineAt,
      prKey,
      prompt: `${prompt.prompt}\n${guidance}\n${outputLanguageInstructions(context.repositoryGuidance?.output)}`,
      runId: job.runId,
      shardIndex: this.shardIndex,
      totalShards: this.totalShards,
    });
    try {
      context.abortSignal?.throwIfAborted();
      const workflow = await this.env.REVIEW_SHARD_WORKFLOW.get(workflowId);
      try {
        while (Date.now() < deadlineAt) {
          context.abortSignal?.throwIfAborted();
          const state = await workflow.status();
          context.abortSignal?.throwIfAborted();
          if (state.status === "complete") {
            const output = modelReviewOutputSchema.parse(state.output);
            return {
              output: modelReviewOutputSchema.parse(
                redactModelReviewOutput(output),
              ),
              promptTruncated: prompt.truncated,
              ...(prompt.omittedSections.length
                ? { promptOmissions: prompt.omittedSections }
                : {}),
            };
          }
          if (state.status === "errored" || state.status === "terminated")
            throw new ThinkReviewFailure(
              state.status === "errored"
                ? "agent_workflow_failed"
                : "agent_workflow_terminated",
            );
          await this.wait(
            Math.min(5_000, Math.max(1, deadlineAt - Date.now())),
          );
        }
        throw new ThinkReviewFailure("agent_deadline_exceeded");
      } catch (error) {
        if (context.abortSignal?.aborted || Date.now() >= deadlineAt) {
          try {
            await workflow.terminate();
          } catch {
            /* Already terminal. */
          }
        }
        throw error;
      }
    } catch (error) {
      try {
        await agent.cancelReview();
      } catch {
        /* Preserve the original shard failure. */
      }
      throw error;
    }
  }
}
