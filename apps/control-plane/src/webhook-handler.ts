import { identificationRevocationSchema } from "@holon/contracts";
import { type HealthCheckReport, pullRequestActions } from "@holon/contracts";
import { followUpMessageSchema } from "@holon/contracts";
import {
  mapPullRequestWebhook,
  mapReviewCommentWebhook,
  mapReviewThreadWebhook,
  verifyWebhookSignature,
} from "@holon/github";
import { consoleErrorReporter, reportError } from "@holon/observability";
import { Hono } from "hono";

import { repositorySchemaResponse } from "./repository-schema-route.js";
const maximumWebhookBytes = 2_000_000;

export class PayloadTooLargeError extends Error {
  public constructor() {
    super("Webhook payload exceeds the configured byte limit");
    this.name = "PayloadTooLargeError";
  }
}

export async function readBoundedRequestBody(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes)
    throw new PayloadTooLargeError();
  const reader = request.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    totalBytes += result.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function createWebhookApp() {
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  app.onError((error, context) => {
    reportError(consoleErrorReporter, "webhook.unhandled_error", error, {
      component: "control-plane",
      operation: "http.webhook",
    });
    return context.json({ error: "internal_error" }, 500);
  });

  app.get("/schemas/holon.schema.json", (context) =>
    repositorySchemaResponse(context.req.raw),
  );
  app.all(
    "/schemas/holon.schema.json",
    () => new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } }),
  );

  app.get("/health", (context) => context.json({ status: "ok" }));
  app.get("/healthz", (context) => {
    const checks = {
      aiGateway: Boolean(
        context.env?.AI_GATEWAY_ACCOUNT_ID &&
        context.env?.AI_GATEWAY_API_TOKEN &&
        context.env?.AI_GATEWAY_ID,
      ),
      database: Boolean(
        context.env?.REVIEW_LEDGERS ||
        (context.env as unknown as { REVIEW_LEDGER?: unknown })?.REVIEW_LEDGER,
      ),
      executor: Boolean(
        (
          context.env as unknown as {
            REPOSITORY_EXECUTOR?: unknown;
            REPOSITORY_EXECUTORS?: unknown;
            SANDBOX?: unknown;
          }
        )?.SANDBOX ||
        (
          context.env as unknown as {
            REPOSITORY_EXECUTOR?: unknown;
            REPOSITORY_EXECUTORS?: unknown;
          }
        )?.REPOSITORY_EXECUTOR ||
        (
          context.env as unknown as {
            REPOSITORY_EXECUTOR?: unknown;
            REPOSITORY_EXECUTORS?: unknown;
          }
        )?.REPOSITORY_EXECUTORS,
      ),
    };
    const allHealthy = Object.values(checks).every(Boolean);
    const report: HealthCheckReport = {
      checks,
      status: allHealthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
    };
    return context.json(report, allHealthy ? 200 : 503);
  });
  app.post("/webhooks/github", async (context) => {
    const signature = context.req.header("x-hub-signature-256") ?? "";
    const delivery = context.req.header("x-github-delivery") ?? "";
    const event = context.req.header("x-github-event") ?? "";
    const reject = (code: string, status: 400 | 401 | 413) => {
      reportError(
        consoleErrorReporter,
        "webhook.rejected",
        {
          name: "WebhookRejection",
          code,
        },
        {
          component: "control-plane",
          operation: "webhook.validate",
          deliveryId: delivery,
        },
      );
      return context.json({ error: code }, status);
    };
    let rawBytes: Uint8Array;
    try {
      rawBytes = await readBoundedRequestBody(
        context.req.raw,
        maximumWebhookBytes,
      );
    } catch (error) {
      if (!(error instanceof PayloadTooLargeError)) throw error;
      return reject("payload_too_large", 413);
    }
    if (
      !(await verifyWebhookSignature(
        context.env.GITHUB_WEBHOOK_SECRET,
        rawBytes,
        signature,
      ))
    ) {
      return reject("invalid_signature", 401);
    }
    if (event === "installation" || event === "installation_repositories") {
      let eventPayload: unknown;
      try {
        eventPayload = JSON.parse(new TextDecoder().decode(rawBytes));
      } catch {
        return reject("invalid_json", 400);
      }
      const decoded = identificationRevocationSchema.safeParse(eventPayload);
      if (!decoded.success) return reject("invalid_installation_event", 400);
      const payload = decoded.data;
      if (
        (event === "installation" &&
          (payload.action === "deleted" || payload.action === "suspend")) ||
        (event === "installation_repositories" && payload.action === "removed")
      ) {
        await context.env.PROJECT_IDENTIFICATION_REGISTRY.getByName(
          String(payload.installation.id),
        ).revoke(
          payload.installation.id,
          event === "installation"
            ? null
            : (payload.repositories_removed ?? []).map((repo) => repo.id),
        );
      }
      if (event === "installation" && payload.action === "unsuspend")
        await context.env.PROJECT_IDENTIFICATION_REGISTRY.getByName(
          String(payload.installation.id),
        ).restore(payload.installation.id, null);
      if (event === "installation_repositories" && payload.action === "added")
        await context.env.PROJECT_IDENTIFICATION_REGISTRY.getByName(
          String(payload.installation.id),
        ).restore(
          payload.installation.id,
          (payload.repositories_added ?? []).map((repo) => repo.id),
        );
      return context.json({ accepted: true }, 202);
    }
    if (
      event !== "pull_request" &&
      event !== "workflow_run" &&
      event !== "pull_request_review_comment" &&
      event !== "pull_request_review_thread"
    )
      return context.json({ accepted: true, ignored: true }, 202);

    const rawBody = new TextDecoder().decode(rawBytes);
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return reject("invalid_json", 400);
    }

    if (event === "workflow_run") {
      if (
        typeof payload === "object" &&
        payload !== null &&
        "action" in payload &&
        payload.action === "completed" &&
        "workflow_run" in payload &&
        typeof payload.workflow_run === "object" &&
        payload.workflow_run !== null
      ) {
        const run = payload.workflow_run as Record<string, unknown>;
        const headSha =
          typeof run.head_sha === "string" ? run.head_sha : undefined;
        const workflowRunId = typeof run.id === "number" ? run.id : undefined;
        const workflowName =
          typeof run.name === "string" ? run.name : undefined;
        const pullRequests = Array.isArray(run.pull_requests)
          ? run.pull_requests
          : [];
        const repository =
          typeof (payload as Record<string, unknown>).repository === "object" &&
          (payload as Record<string, unknown>).repository !== null
            ? ((payload as Record<string, unknown>).repository as Record<
                string,
                unknown
              >)
            : undefined;
        const repoId =
          typeof repository?.id === "number" ? repository.id : undefined;
        const repoName =
          typeof repository?.name === "string" ? repository.name : undefined;
        const repoOwnerObj =
          typeof repository?.owner === "object" && repository.owner !== null
            ? (repository.owner as Record<string, unknown>)
            : undefined;
        const repoOwner =
          typeof repoOwnerObj?.login === "string"
            ? repoOwnerObj.login
            : undefined;
        const installationId =
          typeof (
            (payload as Record<string, unknown>).installation as
              | Record<string, unknown>
              | undefined
          )?.id === "number"
            ? (
                (payload as Record<string, unknown>).installation as Record<
                  string,
                  number
                >
              ).id
            : undefined;

        if (
          headSha &&
          workflowRunId &&
          pullRequests.length > 0 &&
          repoId &&
          repoName &&
          repoOwner &&
          installationId
        ) {
          const prNumber = (pullRequests[0] as Record<string, unknown>)?.number;
          if (typeof prNumber === "number") {
            const followUp = followUpMessageSchema.parse({
              event: "ci_enrichment",
              payload: {
                deliveryId: delivery,
                headSha,
                installationId,
                pullRequestNumber: prNumber,
                repository: { id: repoId, name: repoName, owner: repoOwner },
                workflowName,
                workflowRunId,
                workflowRunAttempt:
                  typeof run.run_attempt === "number" ? run.run_attempt : 1,
              },
            });
            await context.env.REVIEW_QUEUE.send(followUp, {
              contentType: "json",
            });
            return context.json(
              { accepted: true, deliveryId: delivery, enriched: true },
              202,
            );
          }
        }
      }
      return context.json({ accepted: true, ignored: true }, 202);
    }

    if (event === "pull_request_review_comment") {
      try {
        const commentEvent = mapReviewCommentWebhook(payload, delivery);
        if (commentEvent.action !== "created") {
          return context.json({ accepted: true, ignored: true }, 202);
        }
        await context.env.REVIEW_QUEUE.send(
          followUpMessageSchema.parse({
            event: "feedback_comment",
            payload: commentEvent,
          }),
          { contentType: "json" },
        );
        return context.json(
          { accepted: true, deliveryId: delivery, feedback: true },
          202,
        );
      } catch (error) {
        if (
          !(error instanceof TypeError) &&
          !(error instanceof Error && error.name === "ZodError")
        )
          throw error;
        return reject("invalid_payload", 400);
      }
    }

    if (event === "pull_request_review_thread") {
      try {
        const threadEvent = mapReviewThreadWebhook(payload, delivery);
        if (threadEvent.action !== "resolved") {
          return context.json({ accepted: true, ignored: true }, 202);
        }
        await context.env.REVIEW_QUEUE.send(
          followUpMessageSchema.parse({
            event: "feedback_thread",
            payload: threadEvent,
          }),
          { contentType: "json" },
        );
        return context.json(
          { accepted: true, deliveryId: delivery, feedback: true },
          202,
        );
      } catch (error) {
        if (
          !(error instanceof TypeError) &&
          !(error instanceof Error && error.name === "ZodError")
        )
          throw error;
        return reject("invalid_payload", 400);
      }
    }

    if (
      typeof payload === "object" &&
      payload !== null &&
      "action" in payload &&
      typeof payload.action === "string" &&
      !(pullRequestActions as readonly string[]).includes(payload.action)
    ) {
      return context.json({ accepted: true, ignored: true }, 202);
    }
    let envelope;
    try {
      envelope = mapPullRequestWebhook(
        payload,
        delivery,
        new Date().toISOString(),
      );
    } catch {
      return reject("invalid_payload", 400);
    }
    try {
      await context.env.REVIEW_QUEUE.send(envelope, { contentType: "json" });
    } catch (error) {
      reportError(consoleErrorReporter, "webhook.queue_send_failed", error, {
        component: "control-plane",
        operation: "webhook.queue_send",
        repositoryId: envelope.repository.id,
        pullRequestNumber: envelope.pullRequest.number,
        deliveryId: delivery,
      });
      return context.json({ error: "queue_unavailable" }, 503);
    }
    return context.json(
      { accepted: true, deliveryId: envelope.deliveryId },
      202,
    );
  });

  app.notFound((context) => context.json({ error: "not_found" }, 404));
  return app;
}
