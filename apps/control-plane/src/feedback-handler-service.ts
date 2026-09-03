import type {
  FeedbackLedger,
  ProcessFeedbackCommentResult,
  ProcessThreadResolvedResult,
  ReviewPublisher,
} from "@holon/application";
import {
  processFeedbackComment,
  processThreadResolved,
} from "@holon/application";
import { createPrKey } from "@holon/domain";
import {
  createInstallationSessionWithKeyring,
  GitHubReviewPublisher,
  type GitHubAppCredentials,
  type GitHubAppKeyring,
  type GitHubInstallationSession,
  type KeyringOperationOptions,
  type ReviewCommentWebhookEvent,
  type ReviewThreadWebhookEvent,
} from "@holon/github";

import {
  createKeyringTelemetryOptions,
  resolveControlPlaneKeyring,
} from "./github-credentials.js";
import {
  consoleLogger,
  errorKind,
  type StructuredLogger,
} from "./observability.js";

export interface FeedbackHandlerDependencies {
  readonly authorizeThreadResolver?: (
    session: GitHubInstallationSession,
    event: ReviewThreadWebhookEvent,
  ) => Promise<boolean>;
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
    credentialsOrKeyring: GitHubAppCredentials | GitHubAppKeyring,
    installationId: number,
    repositoryId: number,
    options?: KeyringOperationOptions,
  ) => Promise<GitHubInstallationSession>;
  readonly ledger?: FeedbackLedger;
  readonly logger?: StructuredLogger;
  readonly publisher?: ReviewPublisher;
}

type FeedbackEvent = ReviewCommentWebhookEvent | ReviewThreadWebhookEvent;

function resolveLedger(
  env: Cloudflare.Env,
  event: FeedbackEvent,
  dependencies: FeedbackHandlerDependencies,
  logger: StructuredLogger,
) {
  const prKey = createPrKey({
    provider: "github",
    pullRequestNumber: event.pullRequestNumber,
    repositoryId: event.repository.id,
  });
  const ledger = dependencies.ledger ?? env.REVIEW_LEDGERS?.getByName(prKey);
  if (ledger === undefined) {
    logger.emit("feedback_handler_ledger_unavailable", { prKey });
    return undefined;
  }
  return { ledger, prKey };
}

async function createSession(
  env: Cloudflare.Env,
  event: FeedbackEvent,
  dependencies: FeedbackHandlerDependencies,
  logger?: StructuredLogger,
): Promise<GitHubInstallationSession> {
  const factory =
    dependencies.createSession ?? createInstallationSessionWithKeyring;
  const keyring = resolveControlPlaneKeyring(env);
  const keyringOptions = createKeyringTelemetryOptions(logger, {
    installationId: event.installationId,
    pullRequestNumber: event.pullRequestNumber,
  });
  const credentials = {
    ...keyring,
    privateKey: keyring.currentPrivateKey,
  };
  return await factory(
    credentials,
    event.installationId,
    event.repository.id,
    keyringOptions,
  );
}

async function resolvePublisher(
  event: FeedbackEvent,
  headSha: string,
  dependencies: FeedbackHandlerDependencies,
  session?: GitHubInstallationSession,
): Promise<ReviewPublisher> {
  if (dependencies.publisher !== undefined) return dependencies.publisher;
  if (session === undefined) {
    throw new TypeError("GitHub session is required to create a publisher");
  }
  const factory =
    dependencies.createPublisher ??
    ((api, target) => new GitHubReviewPublisher(api, target));
  return factory(session.api, {
    expectedAuthorLogin: session.expectedAuthorLogin,
    headSha,
    owner: event.repository.owner,
    pullNumber: event.pullRequestNumber,
    repo: event.repository.name,
  });
}

function sessionFailure(
  logger: StructuredLogger,
  event: FeedbackEvent,
  error: unknown,
): void {
  logger.emit("feedback_handler_session_failed", {
    errorKind: errorKind(error),
    installationId: event.installationId,
    pullRequestNumber: event.pullRequestNumber,
  });
}

export async function handleFeedbackCommentWebhook(
  env: Cloudflare.Env,
  event: ReviewCommentWebhookEvent,
  dependencies: FeedbackHandlerDependencies = {},
): Promise<ProcessFeedbackCommentResult> {
  const logger = dependencies.logger ?? consoleLogger;
  const resolved = resolveLedger(env, event, dependencies, logger);
  if (resolved === undefined) return { actionTaken: "ignored" };

  try {
    const decision = await resolved.ledger.loadLatestReviewDecision(
      resolved.prKey,
    );
    if (decision === undefined) return { actionTaken: "ignored" };
    const session =
      dependencies.publisher === undefined
        ? await createSession(env, event, dependencies, logger)
        : undefined;
    const publisher = await resolvePublisher(
      event,
      decision.headSha,
      dependencies,
      session,
    );
    return await processFeedbackComment(
      {
        authorAssociation: event.authorAssociation,
        authorLogin: event.authorLogin,
        body: event.body,
        commentId: event.commentId,
        createdAt: event.createdAt,
        deliveryId: event.deliveryId,
        inReplyToCommentId: event.inReplyToId,
        prKey: resolved.prKey,
        pullRequestNumber: event.pullRequestNumber,
      },
      resolved.ledger,
      publisher,
    );
  } catch (error) {
    sessionFailure(logger, event, error);
    return { actionTaken: "ignored" };
  }
}

export async function handleThreadResolvedWebhook(
  env: Cloudflare.Env,
  event: ReviewThreadWebhookEvent,
  dependencies: FeedbackHandlerDependencies = {},
): Promise<ProcessThreadResolvedResult> {
  const logger = dependencies.logger ?? consoleLogger;
  const resolved = resolveLedger(env, event, dependencies, logger);
  if (resolved === undefined) return { actionTaken: "ignored" };

  try {
    const decision = await resolved.ledger.loadLatestReviewDecision(
      resolved.prKey,
    );
    if (decision === undefined) return { actionTaken: "ignored" };
    const session = await createSession(env, event, dependencies, logger);
    const authorize =
      dependencies.authorizeThreadResolver ??
      (async (currentSession, currentEvent) => {
        if (currentSession.repositoryPermission === undefined) {
          throw new TypeError(
            "GitHub session does not support repository permission lookup",
          );
        }
        const permission = await currentSession.repositoryPermission(
          currentEvent.repository.owner,
          currentEvent.repository.name,
          currentEvent.authorLogin,
        );
        return ["admin", "maintain", "write"].includes(
          permission.toLowerCase(),
        );
      });
    const authorized = await authorize(session, event);
    const publisher = await resolvePublisher(
      event,
      decision.headSha,
      dependencies,
      session,
    );
    return await processThreadResolved(
      {
        authorLogin: event.authorLogin,
        authorized,
        deliveryId: event.deliveryId,
        prKey: resolved.prKey,
        pullRequestNumber: event.pullRequestNumber,
        rootCommentId: event.rootCommentId,
      },
      resolved.ledger,
      publisher,
    );
  } catch (error) {
    sessionFailure(logger, event, error);
    return { actionTaken: "ignored" };
  }
}
