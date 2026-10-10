import {
  deliveryWakeSchema,
  type DeliveryWakeResult,
} from "@holon/contracts/dashboard";
import {
  emailJobSchema,
  emailClaimSchema,
  emailReceiptSchema,
  emailContextSchema,
  type EmailDeliveryAuthorityPort,
  type EmailResult,
} from "@holon/contracts/email-delivery";
import { WorkerEntrypoint } from "cloudflare:workers";

import { sendInvitation } from "./provider.js";
import { invitationMessage } from "./template.js";
interface DeliveryBindings {
  EMAIL_JOBS: Queue;
  EMAIL_AUTHORITY: EmailDeliveryAuthorityPort;
  EMAIL: SendEmail;
  APP_ORIGIN: string;
  EMAIL_FROM: string;
  EMAIL_SEND_ENABLED?: string;
}
async function persistResult(
  authority: EmailDeliveryAuthorityPort,
  result: EmailResult,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const receipt = emailReceiptSchema.parse(await authority.record(result));
      if (!receipt.recorded) throw new Error("result_unrecorded");
      return;
    } catch {
      /* Retry only persistence of this same causal result, never the provider. */
    }
  }
  throw new Error("result_unrecorded");
}
export default class EmailDelivery extends WorkerEntrypoint<DeliveryBindings> {
  override fetch(): Response {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  async wake(input: unknown): Promise<DeliveryWakeResult> {
    const parsed = deliveryWakeSchema.safeParse(input);
    if (!parsed.success) throw new Error("invalid_request");
    if (this.env.EMAIL_SEND_ENABLED !== "true")
      return { status: "unavailable" };
    try {
      await this.env.EMAIL_JOBS.send({ jobId: parsed.data.operationId });
      return { status: "accepted" };
    } catch {
      return { status: "unavailable" };
    }
  }
  override async queue(batch: MessageBatch<unknown>): Promise<void> {
    if (
      batch.queue.endsWith("-dlq") ||
      batch.queue.endsWith("-dlq-local") ||
      batch.queue.endsWith("-dlq-preview")
    )
      console.warn(
        JSON.stringify({
          event: "email_dlq",
          messages: Math.min(batch.messages.length, 10),
        }),
      );
    for (const message of batch.messages) {
      const parsed = emailJobSchema.safeParse(message.body);
      if (!parsed.success) {
        message.ack();
        continue;
      }
      if (this.env.EMAIL_SEND_ENABLED !== "true") {
        message.retry({ delaySeconds: 60 });
        continue;
      }
      try {
        const raw = await this.env.EMAIL_AUTHORITY.claim(parsed.data);
        if (raw === null) {
          message.ack();
          continue;
        }
        const claim = emailClaimSchema.parse(raw);
        if (claim.jobId !== parsed.data.jobId) throw new Error("invalid_claim");
        const attempt = {
          jobId: claim.jobId,
          attemptId: claim.attemptId,
          generation: claim.generation,
        };
        const context = await this.env.EMAIL_AUTHORITY.start(attempt);
        if (context === null) {
          message.ack();
          continue;
        }
        let payload: EmailMessageBuilder;
        try {
          if (emailContextSchema.parse(context).jobId !== attempt.jobId)
            throw new Error("invalid_context");
          payload = invitationMessage(
            emailContextSchema.parse(context),
            this.env.APP_ORIGIN,
            this.env.EMAIL_FROM,
          );
        } catch {
          await persistResult(this.env.EMAIL_AUTHORITY, {
            ...attempt,
            outcome: "permanent",
          });
          message.ack();
          continue;
        }
        const sending = sendInvitation(this.env.EMAIL, payload);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const outcome = await Promise.race([
          sending,
          new Promise<"unknown">((resolve) => {
            timer = setTimeout(() => resolve("unknown"), 15000);
          }),
        ]);
        clearTimeout(timer);
        // Timeout does not cancel the provider. Preserve legitimate late success.
        if (outcome === "unknown")
          this.ctx.waitUntil(
            sending
              .then(async (late) => {
                if (late === "accepted")
                  await persistResult(this.env.EMAIL_AUTHORITY, {
                    ...attempt,
                    outcome: late,
                  });
                return;
              })
              .catch(() => {}),
          );
        await persistResult(this.env.EMAIL_AUTHORITY, { ...attempt, outcome });
        message.ack();
      } catch {
        message.retry({ delaySeconds: 60 });
      }
    }
  }
}
