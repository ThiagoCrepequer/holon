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
  if (metrics)
    console.info(JSON.stringify({ event: "email_backlog", ...metrics }));
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
      /* The durable publication lease remains due in at most one minute. */
    }
  }
}
