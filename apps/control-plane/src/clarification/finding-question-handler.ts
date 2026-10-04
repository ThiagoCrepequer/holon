import { compileRepositoryConfiguration } from "@holon/application";
import {
  clarificationAdmissionSchema,
  feedbackCommentEventSchema,
} from "@holon/contracts";
import { createPrKey, parseFindingQuestion } from "@holon/domain";
import type {
  GitHubInstallationSession,
  ReviewCommentWebhookEvent,
} from "@holon/github";
import { parseRepositoryConfigurationYaml } from "@holon/repository-config";
import { getAgentByName } from "agents";

import {
  clarificationSession,
  validateQuestion,
} from "./clarification-services.js";

export interface FindingQuestionDependencies {
  createSession?: () => Promise<GitHubInstallationSession>;
  start?: (prKey: string, id: number) => Promise<void>;
}
export async function handleFindingQuestionWebhook(
  env: Cloudflare.Env,
  raw: ReviewCommentWebhookEvent,
  dependencies: FindingQuestionDependencies = {},
): Promise<boolean> {
  if (!parseFindingQuestion(raw.body, env.GITHUB_APP_SLUG)) return false;
  const event = feedbackCommentEventSchema.parse(raw);
  if (!event.inReplyToId || event.authorLogin.endsWith("[bot]")) return true;
  const prKey = createPrKey({
    provider: "github",
    repositoryId: event.repository.id,
    pullRequestNumber: event.pullRequestNumber,
  });
  const ledger = env.REVIEW_LEDGERS.getByName(prKey);
  const start =
    dependencies.start ??
    (async (key, id) => {
      const agent = await getAgentByName(
        env.FINDING_CLARIFICATION_AGENTS,
        `${key}:question:${id}`,
      );
      await agent.startClarification({ prKey: key, questionId: id });
    });
  const existing = await ledger.loadClarification(event.commentId);
  if (existing) {
    if (existing.state === "pending" || existing.state === "answered")
      await start(prKey, existing.id);
    return true;
  }
  const decision = await ledger.loadLatestReviewDecision(prKey);
  const finding = await ledger.findFindingByCommentId(prKey, event.inReplyToId);
  if (!decision || !finding || finding.lastSeenRunId !== decision.runId)
    return true;
  const session = await (dependencies.createSession?.() ??
    clarificationSession(env, { event }));
  const current = await validateQuestion(session, event, env.GITHUB_APP_SLUG);
  if (!current || current.headSha !== decision.headSha) return true;
  const ref = await ledger.findRunConfiguration(decision.runId);
  if (!ref) return true;
  if (
    ref.identity.installationId !== event.installationId ||
    ref.identity.repositoryId !== event.repository.id ||
    ref.identity.pullRequestNumber !== event.pullRequestNumber ||
    ref.identity.baseSha !== current.baseSha
  )
    return true;
  const config = await compileRepositoryConfiguration(
    ref.identity,
    session.configurationReader(
      event.repository.owner,
      event.repository.name,
      current.baseSha,
    ),
    parseRepositoryConfigurationYaml,
  );
  if (
    config.configDigest !== ref.configDigest ||
    config.scopeDigest !== ref.scopeDigest
  )
    return true;
  const record = await ledger.admitClarification(
    clarificationAdmissionSchema.parse({
      event,
      question: current.question,
      headSha: current.headSha,
      baseSha: current.baseSha,
      additionalExcludes: config.config.additionalExcludes,
    }),
  );
  if (record) await start(prKey, record.id);
  return true;
}
