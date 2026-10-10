import {
  deliveryWakeResultSchema,
  type DeliveryWakeResult,
} from "@holon/contracts/dashboard";
import { createEmailDeliveryPersistence } from "@holon/db/identity/server";
interface DeliveryTransport {
  wake(input: unknown): Promise<DeliveryWakeResult>;
}
export async function publishDueEmail(
  database: D1Database,
  transport: DeliveryTransport,
) {
  const jobs = createEmailDeliveryPersistence(database);
  const metrics = await jobs.metrics();
  if (metrics) {
    console.info(JSON.stringify({ event: "email_backlog", ...metrics }));
    // Five missed one-minute publisher windows, or any unknown external result.
    console.info(
      JSON.stringify({
        event: "email_health",
        code: metrics.overdue_ms > 300000 ? 2 : metrics.unknown > 0 ? 1 : 0,
      }),
    );
  }
  for (const jobId of await jobs.due()) {
    const publication = await jobs.reservePublication(jobId);
    if (!publication) continue;
    try {
      const result = deliveryWakeResultSchema.parse(
        await transport.wake({ operationId: jobId }),
      );
      if (result.status === "accepted")
        await jobs.published(jobId, publication);
    } catch {
      console.warn(
        JSON.stringify({ event: "email_publication_retry", code: 1 }),
      );
      /* The durable publication lease remains due in at most one minute. */
    }
  }
}
