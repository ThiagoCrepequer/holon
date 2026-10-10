import { createProjectionPersistence } from "@holon/db/projection/server";
import { WorkerEntrypoint } from "cloudflare:workers";

import { recoveryMode } from "./recovery-mode.js";
/** Private producer binding; no public recovery or projection-write HTTP route. */
export class ReviewProjectionWriter extends WorkerEntrypoint<{
  PROJECTION_DB: D1Database;
  DASHBOARD_RECOVERY_MODE?: string;
}> {
  write(raw: unknown) {
    if (recoveryMode(this.env.DASHBOARD_RECOVERY_MODE) === "closed")
      throw new Error("projection_paused");
    return createProjectionPersistence(this.env.PROJECTION_DB).write(raw);
  }
  beginRecovery(raw: unknown) {
    return createProjectionPersistence(this.env.PROJECTION_DB).beginRecovery(
      raw,
    );
  }
  activateRecovery(raw: unknown) {
    return createProjectionPersistence(this.env.PROJECTION_DB).activateRecovery(
      raw,
    );
  }
}
