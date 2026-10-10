import { createEmailDeliveryPersistence } from "@holon/db/identity/server";
import { WorkerEntrypoint } from "cloudflare:workers";

import { recoveryMode } from "./recovery-mode.js";
export class EmailDeliveryAuthority extends WorkerEntrypoint<{
  IDENTITY_DB: D1Database;
  DASHBOARD_RECOVERY_MODE?: string;
}> {
  claim(input: unknown) {
    if (recoveryMode(this.env.DASHBOARD_RECOVERY_MODE) !== "active")
      return null;
    return createEmailDeliveryPersistence(this.env.IDENTITY_DB).claim(input);
  }
  start(input: unknown) {
    if (recoveryMode(this.env.DASHBOARD_RECOVERY_MODE) !== "active")
      return null;
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
