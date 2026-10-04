import {
  parseMemoryCommand,
  memoryScopeMatches,
  type ProcessFeedbackCommentResult,
  type ReviewPublisher,
} from "@holon/application";
import {
  memoryLimits,
  memoryRunIdentitySchema,
  type MemoryObservation,
} from "@holon/contracts";
import { createPrKey, redactSecrets } from "@holon/domain";
import type {
  GitHubInstallationSession,
  ReviewCommentWebhookEvent,
} from "@holon/github";

import { createMemoryRule, memoryDigest } from "./memory-content.js";

export async function handleMemoryComment(
  env: Cloudflare.Env,
  event: ReviewCommentWebhookEvent,
  session: GitHubInstallationSession,
  publisher: ReviewPublisher,
): Promise<ProcessFeedbackCommentResult> {
  const command = parseMemoryCommand(event.body);
  if (!command || !event.inReplyToId || event.authorLogin.endsWith("[bot]"))
    return { actionTaken: "ignored" };
  if (!session.repositoryPermission)
    throw new Error("Memory approval permission lookup unavailable");
  const permission = await session.repositoryPermission(
    event.repository.owner,
    event.repository.name,
    event.authorLogin,
  );
  if (!["write", "maintain", "admin"].includes(permission.toLowerCase()))
    return { actionTaken: "unauthorized" };
  const prKey = createPrKey({
    provider: "github",
    repositoryId: event.repository.id,
    pullRequestNumber: event.pullRequestNumber,
  });
  const finding = await env.REVIEW_LEDGERS.getByName(
    prKey,
  ).findFindingByCommentId(prKey, event.inReplyToId);
  if (!finding) return { actionTaken: "ignored" };
  const identity = {
    installationId: event.installationId,
    repositoryId: event.repository.id,
  };
  const registry = env.PROJECT_IDENTIFICATION_REGISTRY.getByName(
    String(identity.installationId),
  );
  const memoryName = await registry.register(
    identity.installationId,
    identity.repositoryId,
  );
  if (!memoryName) return { actionTaken: "unauthorized" };
  const memory = env.REPOSITORY_MEMORIES.getByName(memoryName);
  let response: string;
  let actionTaken: "recorded" | "ignored" = "recorded";
  try {
    if (command.action === "list") {
      const rules = await memory.list(identity);
      response = rules.length
        ? rules
            .map(
              (rule) =>
                `- ${rule.state}: ${rule.id} (digest ${rule.digest}, scope ${rule.root})`,
            )
            .join("\n")
        : "No repository memory proposals or rules.";
    } else if (command.action === "propose") {
      if (!memoryScopeMatches(command.root, finding.filePath))
        throw new Error("Proposal scope does not contain source finding");
      const source = memoryRunIdentitySchema.parse({
        ...identity,
        pullRequestNumber: event.pullRequestNumber,
        runId: finding.lastSeenRunId,
        headSha: finding.lastSeenHeadSha,
        baseSha: finding.lastSeenRunId.split(":base:")[1],
      });
      const createdAt = event.createdAt;
      const evidence: MemoryObservation = {
        id: `proposal-comment:${event.commentId}`,
        kind: "finding",
        source,
        path: finding.filePath,
        summary: redactSecrets(finding.diagnostic).slice(0, 1500),
        createdAt,
        authorLogin: event.authorLogin,
        commentId: event.commentId,
        fingerprint: finding.fingerprint,
      };
      const rule = await createMemoryRule({
        root: command.root,
        guidance: command.guidance,
        topic: await memoryDigest([
          command.root,
          command.guidance,
          command.supersedes ?? null,
        ]),
        evidence: [evidence],
        createdAt,
        expiresAt: new Date(
          Date.parse(createdAt) + memoryLimits.ruleDays * 86_400_000,
        ).toISOString(),
        ...(command.supersedes ? { supersedes: command.supersedes } : {}),
      });
      const proposed = await memory.propose(identity, rule);
      response = `Memory proposal (${proposed.state})\n\nScope: ${proposed.root}\nGuidance: ${proposed.guidance}\nExpires: ${proposed.expiresAt}\n\nApprove the exact proposal:\n\`/holon memory approve ${proposed.id} ${proposed.digest}\``;
    } else {
      if (command.action === "inspect") {
        const rule = (await memory.list(identity)).find(
          (item) => item.id === command.id && item.digest === command.digest,
        );
        if (!rule) throw new Error("Memory rule not found");
        response = JSON.stringify(rule, null, 2);
      } else {
        const rule = await memory.decide(identity, {
          deliveryId: event.deliveryId,
          action: command.action,
          id: command.id,
          digest: command.digest,
          authorLogin: event.authorLogin,
        });
        response = `Repository memory rule ${rule.id}: ${rule.state}. Applies to future review snapshots only; evidence and host policies remain mandatory.`;
      }
    }
  } catch (error) {
    const rejected = [
      "Proposal scope does not contain source finding",
      "Replacement target is not active",
      "Replacement target changed",
      "Memory rule not found",
      "Memory rule digest mismatch",
      "Memory rule transition rejected",
      "Repository memory rule limit",
    ];
    if (!(error instanceof Error) || !rejected.includes(error.message))
      throw error;
    response = `Memory command rejected: ${error.message}. Inspect the proposal and its current state before retrying.`;
    actionTaken = "ignored";
  }
  // Revalidate installation generation after external permission lookup and RPC work.
  if (
    (await registry.register(
      identity.installationId,
      identity.repositoryId,
    )) !== memoryName
  )
    throw new Error("Repository memory generation changed");
  if (!publisher.replyToComment)
    throw new Error("Memory reply publisher unavailable");
  const marker = `<!-- holon;memory=${encodeURIComponent(event.deliveryId)} -->`;
  const existing = await publisher.findCommentByMarker(marker, "inline");
  if (!existing)
    await publisher.replyToComment(
      event.commentId,
      `${redactSecrets(response).replaceAll("<!--", "&lt;!--")}\n\n${marker}`,
    );
  return { actionTaken, replyPosted: existing === undefined };
}
