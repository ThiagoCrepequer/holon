import type {
  ProcessFeedbackCommentResult,
  ProcessThreadResolvedResult,
  ReviewLedger,
  ReviewPublisher,
} from "@holon/application";
import {
  processFeedbackComment,
  processThreadResolved,
} from "@holon/application";
import { createPrKey } from "@holon/domain";
import {
  createInstallationSession,
  GitHubReviewPublisher,
  type GitHubInstallationSession,
  type ReviewCommentWebhookEvent,
  type ReviewThreadWebhookEvent,
} from "@holon/github";

import { parseAppId } from "./credential-broker.js";
import { consoleLogger, type StructuredLogger } from "./observability.js";

export interface FeedbackHandlerDependencies {
  readonly createPublisher?: (
    api: GitHubInstallationSession["api"],
    target: {
      expectedAuthorLogin: string;
      headSha: string;
      owner: string;
      pullNumber: number;
      repo: string;
    },
  ) => ReviewPublisher;
  readonly createSession?: (
    credentials: { appId: number; appSlug: string; privateKey: string },
    installationId: number,
    repositoryId: number,
  ) => Promise<GitHubInstallationSession>;
  readonly ledger?: ReviewLedger;
  readonly logger?: StructuredLogger;
  readonly publisher?: ReviewPublisher;
}

export async function handleFeedbackCommentWebhook(
  env: Cloudflare.Env,
  event: ReviewCommentWebhookEvent,
  dependencies: FeedbackHandlerDependencies = {},
): Promise<ProcessFeedbackCommentResult> {
  const logger = dependencies.logger ?? consoleLogger;
  const prKey = createPrKey({
    provider: "github",
    pullRequestNumber: event.pullRequestNumber,
    repositoryId: event.repository.id,
  });
  const ledger = dependencies.ledger ?? env.REVIEW_LEDGERS?.getByName(prKey);
  if (!ledger) {
    logger.emit("feedback_handler_ledger_unavailable", { prKey });
    return { actionTaken: "ignored" };
  }

  let publisher = dependencies.publisher;
  if (!publisher) {
    try {
      const credentials = {
        appId: parseAppId(env.GITHUB_APP_ID),
        appSlug: env.GITHUB_APP_SLUG,
        privateKey: env.GITHUB_APP_PRIVATE_KEY,
      };
      const sessionFactory =
        dependencies.createSession ?? createInstallationSession;
      const session = await sessionFactory(
        credentials,
        event.installationId,
        event.repository.id,
      );
      const publisherFactory =
        dependencies.createPublisher ??
        ((api, target) => new GitHubReviewPublisher(api, target));
      publisher = publisherFactory(session.api, {
        expectedAuthorLogin: session.expectedAuthorLogin,
        headSha: "",
        owner: event.repository.owner,
        pullNumber: event.pullRequestNumber,
        repo: event.repository.name,
      });
    } catch (error) {
      logger.emit("feedback_handler_session_failed", {
        error: error instanceof Error ? error.message : String(error),
        installationId: event.installationId,
        pullRequestNumber: event.pullRequestNumber,
      });
      return { actionTaken: "ignored" };
    }
  }

  return processFeedbackComment(
    {
      authorAssociation: event.authorAssociation,
      authorLogin: event.authorLogin,
      body: event.body,
      commentId: event.commentId,
      createdAt: event.createdAt,
      inReplyToCommentId: event.inReplyToId,
      prKey,
      pullRequestNumber: event.pullRequestNumber,
    },
    ledger,
    publisher,
  );
}

export async function handleThreadResolvedWebhook(
  env: Cloudflare.Env,
  event: ReviewThreadWebhookEvent,
  dependencies: FeedbackHandlerDependencies = {},
): Promise<ProcessThreadResolvedResult> {
  const logger = dependencies.logger ?? consoleLogger;
  const prKey = createPrKey({
    provider: "github",
    pullRequestNumber: event.pullRequestNumber,
    repositoryId: event.repository.id,
  });
  const ledger = dependencies.ledger ?? env.REVIEW_LEDGERS?.getByName(prKey);
  if (!ledger) {
    logger.emit("feedback_handler_ledger_unavailable", { prKey });
    return { actionTaken: "ignored" };
  }

  let publisher = dependencies.publisher;
  if (!publisher) {
    try {
      const credentials = {
        appId: parseAppId(env.GITHUB_APP_ID),
        appSlug: env.GITHUB_APP_SLUG,
        privateKey: env.GITHUB_APP_PRIVATE_KEY,
      };
      const sessionFactory =
        dependencies.createSession ?? createInstallationSession;
      const session = await sessionFactory(
        credentials,
        event.installationId,
        event.repository.id,
      );
      const publisherFactory =
        dependencies.createPublisher ??
        ((api, target) => new GitHubReviewPublisher(api, target));
      publisher = publisherFactory(session.api, {
        expectedAuthorLogin: session.expectedAuthorLogin,
        headSha: "",
        owner: event.repository.owner,
        pullNumber: event.pullRequestNumber,
        repo: event.repository.name,
      });
    } catch (error) {
      logger.emit("feedback_handler_session_failed", {
        error: error instanceof Error ? error.message : String(error),
        installationId: event.installationId,
        pullRequestNumber: event.pullRequestNumber,
      });
      return { actionTaken: "ignored" };
    }
  }

  return processThreadResolved(
    {
      authorAssociation: event.authorAssociation,
      authorLogin: event.authorLogin,
      prKey,
      pullRequestNumber: event.pullRequestNumber,
      rootCommentId: event.rootCommentId,
    },
    ledger,
    publisher,
  );
}
