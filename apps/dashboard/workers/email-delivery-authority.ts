import { createEmailDeliveryPersistence } from "@holon/db/identity/server";
import { WorkerEntrypoint } from "cloudflare:workers";
export class EmailDeliveryAuthority extends WorkerEntrypoint<{
  IDENTITY_DB: D1Database;
}> {
  claim(input: unknown) {
    return createEmailDeliveryPersistence(this.env.IDENTITY_DB).claim(input);
  }
  start(input: unknown) {
    return createEmailDeliveryPersistence(this.env.IDENTITY_DB).start(input);
  }
  record(input: unknown) {
    return createEmailDeliveryPersistence(this.env.IDENTITY_DB).record(input);
  }
  override fetch(): Response {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
