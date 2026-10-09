import {
  clarificationMarker,
  requireConclusivePublicationLookup,
  renderClarificationReply,
} from "@holon/application";
import type { ClarificationRecord } from "@holon/contracts";
import { parseFindingQuestion } from "@holon/domain";
import {
  createInstallationSessionWithKeyring,
  GitHubReviewPublisher,
  GitHubRequestError,
  type GitHubInstallationSession,
} from "@holon/github";

import { resolveControlPlaneKeyring } from "../github/github-credentials.js";
import { executeGitHubOperation } from "../github/github-operations.js";

export function clarificationSession(
  env: Cloudflare.Env,
  record: Pick<ClarificationRecord, "event">,
): Promise<GitHubInstallationSession> {
  return executeGitHubOperation(() =>
    createInstallationSessionWithKeyring(
      resolveControlPlaneKeyring(env),
      record.event.installationId,
      record.event.repository.id,
    ),
  );
}

/** Revalidate the live thread and PR; event text never grants repository or publication authority. */
export async function validateQuestion(
  session: GitHubInstallationSession,
  event: ClarificationRecord["event"],
  appSlug: string,
) {
  if (!event.inReplyToId || event.authorLogin.endsWith("[bot]"))
    return undefined;
  try {
    const reader = session.discussionReader(
      event.repository.owner,
      event.repository.name,
    );
    const [question, root, pr] = await Promise.all([
      reader.comment(event.commentId),
      reader.comment(event.inReplyToId),
      reader.pullRequest(event.pullRequestNumber),
    ]);
    const url = `https://api.github.com/repos/${event.repository.fullName}/pulls/${event.pullRequestNumber}`;
    if (
      question.pull_request_url !== url ||
      root.pull_request_url !== url ||
      question.in_reply_to_id !== root.id ||
      root.in_reply_to_id !== undefined ||
      root.user.type !== "Bot" ||
      root.user.login !== session.expectedAuthorLogin ||
      question.user.type !== "User" ||
      question.user.login !== event.authorLogin ||
      question.body !== event.body ||
      pr.state !== "open"
    )
      return undefined;
    const text = parseFindingQuestion(question.body, appSlug);
    if (!text) return undefined;
    if (event.authorLogin !== pr.user.login) {
      const permission = await session.repositoryPermission?.(
        event.repository.owner,
        event.repository.name,
        event.authorLogin,
      );
      if (
        !["write", "maintain", "admin"].includes(
          permission?.toLowerCase() ?? "",
        )
      )
        return undefined;
    }
    return { question: text, headSha: pr.head.sha, baseSha: pr.base.sha, root };
  } catch (error) {
    if (error instanceof GitHubRequestError && error.statusCode === 404)
      return undefined;
    throw error;
  }
}

export async function publishClarification(
  env: Cloudflare.Env,
  record: ClarificationRecord,
  session: GitHubInstallationSession,
): Promise<void> {
  const ledger = env.REVIEW_LEDGERS.getByName(record.prKey);
  if (record.state === "published" || record.state === "obsolete") return;
  const github = session;
  const publisher = new GitHubReviewPublisher(github.api, {
    expectedAuthorLogin: github.expectedAuthorLogin,
    headSha: record.headSha,
    owner: record.event.repository.owner,
    repo: record.event.repository.name,
    pullNumber: record.event.pullRequestNumber,
  });
  const marker = clarificationMarker(record.id);
  // Reconciliation first also handles a successful POST followed by an ambiguous timeout.
  const existing = requireConclusivePublicationLookup(
    await publisher.findCommentByMarker(marker, "inline"),
  );
  if (existing.status === "found") {
    await ledger.completeClarification(record.id, existing.id);
    return;
  }
  const current = await validateQuestion(
    github,
    record.event,
    env.GITHUB_APP_SLUG,
  );
  if (
    !current ||
    current.headSha !== record.headSha ||
    current.baseSha !== record.baseSha ||
    !(await ledger.canPublishClarification(record.id))
  ) {
    await ledger.completeClarification(record.id);
    return;
  }
  if (record.correctionApplied) {
    const decision = await ledger.loadLatestReviewDecision(
      record.finding.prKey,
    );
    if (decision?.runId !== record.runId) {
      await ledger.completeClarification(record.id);
      return;
    }
    if (decision.checkRunId !== undefined)
      await ledger.reconcileCheckRun(record.runId);
  }

  // Head and authority are checked again immediately before the reply mutation.
  const refs = await github.currentPullRequestRefs(
    record.event.repository.owner,
    record.event.repository.name,
    record.event.pullRequestNumber,
  );
  if (
    refs.headSha !== record.headSha ||
    refs.baseSha !== record.baseSha ||
    !(await ledger.canPublishClarification(record.id))
  ) {
    await ledger.completeClarification(record.id);
    return;
  }
  const id = await publisher.replyToComment(
    record.finding.githubCommentId!,
    renderClarificationReply(record),
  );
  await ledger.completeClarification(record.id, id);
}
