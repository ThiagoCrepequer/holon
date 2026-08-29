import { pullRequestActions } from "@holon/contracts";
import { mapPullRequestWebhook, verifyWebhookSignature } from "@holon/github";
import { Hono } from "hono";

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

  app.get("/health", (context) => context.json({ status: "ok" }));
  app.post("/webhooks/github", async (context) => {
    const signature = context.req.header("x-hub-signature-256") ?? "";
    const delivery = context.req.header("x-github-delivery") ?? "";
    const event = context.req.header("x-github-event") ?? "";
    let rawBytes: Uint8Array;
    try {
      rawBytes = await readBoundedRequestBody(
        context.req.raw,
        maximumWebhookBytes,
      );
    } catch (error) {
      if (!(error instanceof PayloadTooLargeError)) throw error;
      return context.json({ error: "payload_too_large" }, 413);
    }
    if (
      !(await verifyWebhookSignature(
        context.env.GITHUB_WEBHOOK_SECRET,
        rawBytes,
        signature,
      ))
    ) {
      return context.json({ error: "invalid_signature" }, 401);
    }
    if (event !== "pull_request")
      return context.json({ accepted: true, ignored: true }, 202);

    const rawBody = new TextDecoder().decode(rawBytes);
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return context.json({ error: "invalid_json" }, 400);
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
      return context.json({ error: "invalid_payload" }, 400);
    }
    try {
      await context.env.REVIEW_QUEUE.send(envelope, { contentType: "json" });
    } catch {
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
