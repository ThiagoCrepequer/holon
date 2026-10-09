import type { ModelReviewer, ReviewContext } from "@holon/application";
import {
  applyCausalVerification,
  prepareCausalCandidates,
  withholdUnverifiedFindings,
} from "@holon/application";
import {
  modelReviewOutputSchema,
  validateReviewEvidencePack,
  type ReviewJob,
} from "@holon/contracts";
import { createPrKey } from "@holon/domain";
import {
  buildReviewPromptResult,
  buildCausalVerificationPrompt,
  outputLanguageInstructions,
  preflightReviewPrompt,
  redactModelReviewOutput,
  serializedRepositoryGuidance,
} from "@holon/model";
import { getAgentByName } from "agents";

import {
  reviewFailureReasonSchema,
  type ReviewFailureReason,
} from "./review-failure.js";

export class ThinkReviewFailure extends Error {
  constructor(
    public readonly reason:
      | "agent_workflow_failed"
      | "agent_workflow_terminated"
      | ReviewFailureReason,
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
    const reviewPrompt = `${prompt.prompt}\n${guidance}\n${outputLanguageInstructions(context.repositoryGuidance?.output)}`;
    const deadlineAt = context.deadlineAt ?? Date.now() + 20 * 60_000;
    const boundedContext = { ...context, deadlineAt };
    const investigation = await this.execute(
      job,
      boundedContext,
      reviewPrompt,
      "investigation",
    );
    const draft = modelReviewOutputSchema.parse(
      redactModelReviewOutput(modelReviewOutputSchema.parse(investigation.raw)),
    );
    const { candidates, rejections } = prepareCausalCandidates(draft, context);
    const language = context.repositoryGuidance?.output.language ?? "en";
    let output = candidates;
    if (candidates.findings.length) {
      try {
        const raw = await this.execute(
          job,
          boundedContext,
          buildCausalVerificationPrompt(
            prompt.verificationContext,
            candidates,
            investigation.evidence,
          ),
          "causal_verification",
        );
        output = applyCausalVerification(
          candidates,
          raw.raw,
          language,
          [...investigation.evidence, ...raw.evidence].map(
            (item) => item.receipt,
          ),
        );
      } catch {
        // A cancelled parent must not persist or publish a degraded result.
        context.abortSignal?.throwIfAborted();
        output = withholdUnverifiedFindings(candidates, language);
      }
    } else if (rejections.length) {
      output = withholdUnverifiedFindings(candidates, language);
    }
    return {
      output: modelReviewOutputSchema.parse(redactModelReviewOutput(output)),
      promptTruncated: prompt.truncated,
      ...(prompt.omittedSections.length
        ? { promptOmissions: prompt.omittedSections }
        : {}),
    };
  }

  private async execute(
    job: ReviewJob,
    context: ReviewContext,
    prompt: string,
    phase: "investigation" | "causal_verification",
  ) {
    context.abortSignal?.throwIfAborted();
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
      `${job.runId}:${this.shardIndex}${phase === "causal_verification" ? ":causal" : ""}`,
    );
    const workflowId = await agent.startReview({
      deadlineAt,
      prKey,
      prompt,
      phase,
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
            const evidence =
              Date.now() >= deadlineAt
                ? []
                : await validateReviewEvidencePack(
                    await this.env.REPOSITORY_EXECUTOR.getEvidencePack(
                      job.runId,
                      Math.min(deadlineAt, Date.now() + 90_000),
                    ),
                    job.runId,
                  );
            return { raw: state.output, evidence };
          }
          if (state.status === "errored" || state.status === "terminated")
            throw new ThinkReviewFailure(
              state.status === "errored"
                ? (reviewFailureReasonSchema
                    .nullable()
                    .parse(await agent.getReviewFailure()) ??
                    "agent_workflow_failed")
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
